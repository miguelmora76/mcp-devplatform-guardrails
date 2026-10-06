import { once } from 'node:events';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { App } from '../app.js';
import { sessionClient } from '../core/identity.js';
import { IdScanner } from './id-scanner.js';
import { createMcpServer } from './mcp-server.js';

/**
 * Stdio transport (LC-01): MCP over standard input and output for a local process started
 * by one agent. The client is a random session ID. Standard output carries protocol
 * messages only; operational logs go to standard error.
 *
 * Messages are limited to 64 KiB each (NFR1.1). The SDK's own reader cannot enforce that
 * per message (it counts bytes buffered across messages and closes the transport when
 * exceeded), so a guard in front of it splits the input into lines itself. A message over
 * the limit is never parsed: it gets a JSON-RPC error response, one log line and one audit
 * record, and the server keeps serving.
 */

/** Largest single protocol message accepted on stdio (64 KiB, NFR1.1). */
export const MAX_STDIO_MESSAGE_BYTES = 64 * 1024;

const JSON_RPC_INVALID_REQUEST = -32600;
const NEWLINE = Buffer.from('\n');

/** Messages that may wait behind a pending oversize reply, and their total size. */
export const MAX_QUEUED_MESSAGES = 1000;
export const MAX_QUEUED_BYTES = 1024 * 1024;

export interface OversizeEvent {
  /** The message's own top-level request id (a string or whole number), or null. */
  readonly id: string | number | null;
  /** The size of the whole message in bytes, not counting the newline. */
  readonly bytes: number;
}

export interface GuardOptions {
  readonly maxBytes: number;
  /** Called for each dropped message; later messages wait for it, so replies stay in order. */
  readonly onOversize: (event: OversizeEvent) => void | Promise<void>;
  /** Called once if too many messages pile up behind a pending reply; the guard then stops reading. */
  readonly onQueueOverflow?: () => void;
  readonly maxQueuedMessages?: number;
  readonly maxQueuedBytes?: number;
}

/**
 * Passes complete lines of at most `maxBytes` on to the returned stream and reports the
 * others to `onOversize`. It never holds more than `maxBytes` of a message: an oversize
 * message is scanned for its own request id as it streams past and then forgotten. Lines
 * that arrive while a reply is pending wait (at most `maxQueuedMessages` / `maxQueuedBytes`
 * of them), and a slow consumer pauses the input instead of letting memory grow. A final
 * oversize message that ends without a newline is reported too; a short unterminated
 * fragment is dropped, as the protocol reader would never use it.
 */
export function guardMessages(input: Readable, options: GuardOptions): Readable {
  // Buffers about one maximum-size message, so a slow consumer pauses the input quickly.
  const output = new PassThrough({ highWaterMark: options.maxBytes });
  const maxMessages = options.maxQueuedMessages ?? MAX_QUEUED_MESSAGES;
  const maxQueuedBytes = options.maxQueuedBytes ?? MAX_QUEUED_BYTES;
  let parts: Buffer[] = [];
  let size = 0;
  let scanner: IdScanner | undefined;
  let chain: Promise<void> = Promise.resolve();
  let waiting = 0;
  let queuedBytes = 0;
  let stopped = false;

  const add = (piece: Buffer): void => {
    size += piece.length;
    if (scanner !== undefined) {
      scanner.feed(piece);
    } else if (size <= options.maxBytes) {
      parts.push(piece);
    } else {
      scanner = new IdScanner();
      for (const part of parts) scanner.feed(part);
      scanner.feed(piece);
      parts = [];
    }
  };

  /** Runs `task` after everything queued before it; false if the queue is already full. */
  const enqueue = (task: () => Promise<void> | void, bytes: number): boolean => {
    if (waiting >= maxMessages || queuedBytes + bytes > maxQueuedBytes) return false;
    waiting += 1;
    queuedBytes += bytes;
    chain = chain.then(async () => {
      try {
        await task();
      } catch {
        // A failed reply (for example the transport already closed) must not stop the stream.
      }
      waiting -= 1;
      queuedBytes -= bytes;
    });
    return true;
  };

  const overflow = (): void => {
    stopped = true;
    input.off('data', onData);
    input.pause();
    options.onQueueOverflow?.();
  };

  const finishLine = (): void => {
    const found = scanner;
    const bytes = size;
    const line = found === undefined ? Buffer.concat([...parts, NEWLINE]) : undefined;
    parts = [];
    size = 0;
    scanner = undefined;

    if (found !== undefined) {
      if (!enqueue(() => options.onOversize({ id: found.result(), bytes }), 0)) overflow();
    } else if (line !== undefined && waiting === 0) {
      // Nothing is pending: pass it straight on, pausing the input if the consumer is slow.
      if (!output.write(line)) {
        input.pause();
        output.once('drain', () => {
          input.resume();
        });
      }
    } else if (line !== undefined) {
      const queued = enqueue(async () => {
        if (!output.write(line)) await once(output, 'drain');
      }, line.length);
      if (!queued) overflow();
    }
  };

  function onData(chunk: Buffer | string): void {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    for (let start = 0; start < buffer.length && !stopped;) {
      const newline = buffer.indexOf(0x0a, start);
      add(buffer.subarray(start, newline === -1 ? buffer.length : newline));
      if (newline === -1) return;
      finishLine();
      start = newline + 1;
    }
  }

  input.on('data', onData);
  input.on('end', () => {
    if (!stopped && scanner !== undefined) finishLine();
    void chain.then(() => output.end());
  });
  input.on('error', (error) => {
    output.destroy(error);
  });
  return output;
}

export interface StdioOptions {
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  /** Called once when the agent closes its end (standard input ends). */
  readonly onDisconnect?: () => void;
}

export interface RunningTransport {
  readonly client: string;
  /** Stops reading new messages; responses for calls already running are still written. */
  stopAccepting(): Promise<void>;
  close(): Promise<void>;
}

export async function startStdioTransport(
  app: App,
  options: StdioOptions = {},
): Promise<RunningTransport> {
  const client = sessionClient(app.ids);
  const server = createMcpServer(app, client);
  const close = () => server.close();
  let disconnected = false;
  const disconnect = (): void => {
    if (disconnected) return;
    disconnected = true;
    options.onDisconnect?.();
  };
  const guarded = guardMessages(options.stdin ?? process.stdin, {
    maxBytes: MAX_STDIO_MESSAGE_BYTES,
    onOversize: async ({ id, bytes }) => {
      const result = await app.wrapper.rejectOversized(client, bytes);
      app.logger.warn('stdio.oversize', { client: client.name, bytes, callId: result.callId });
      await transport.send({
        jsonrpc: '2.0',
        id: id as number,
        error: {
          code: JSON_RPC_INVALID_REQUEST,
          message: `The message was larger than ${MAX_STDIO_MESSAGE_BYTES} bytes and was dropped.`,
          data: { code: 'message_too_large', callId: result.callId },
        },
      });
    },
    onQueueOverflow: () => {
      app.logger.warn('stdio.queue_overflow', { client: client.name });
      void close();
      disconnect();
    },
  });
  const transport = new StdioServerTransport(guarded, options.stdout);
  await server.connect(transport);
  // After the guard has passed on (and answered) everything the agent sent.
  guarded.once('end', disconnect);
  app.logger.info('server.start', { mode: 'stdio', client: client.name });
  return { client: client.name, stopAccepting: close, close };
}
