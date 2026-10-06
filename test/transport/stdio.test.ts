import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_QUEUED_BYTES,
  MAX_QUEUED_MESSAGES,
  MAX_STDIO_MESSAGE_BYTES,
  guardMessages,
  type OversizeEvent,
} from '../../src/transport/stdio.js';
import { flushMicrotasks } from '../support/fakes.js';
import { until } from '../support/http-harness.js';
import { startHarness, type Harness } from '../support/harness.js';

const ping = (id: number, pad = '') =>
  `${JSON.stringify({ jsonrpc: '2.0', id, method: 'ping', params: { pad } })}\n`;

/** A request line of exactly `bytes` bytes (including nothing after it; the newline is extra). */
function lineOfSize(id: number, bytes: number): string {
  const base = JSON.stringify({ jsonrpc: '2.0', id, method: 'ping', params: { pad: '' } });
  return base.replace('"pad":""', `"pad":"${'x'.repeat(bytes - base.length)}"`);
}

describe('Given the stdio size limit of 64 KiB per message', () => {
  it('When the constant is read, then it is 64 KiB', () => {
    expect(MAX_STDIO_MESSAGE_BYTES).toBe(64 * 1024);
  });
});

describe('Given a stream guard in front of the protocol reader', () => {
  function guarded() {
    const input = new PassThrough();
    const events: OversizeEvent[] = [];
    const output = guardMessages(input, {
      maxBytes: MAX_STDIO_MESSAGE_BYTES,
      onOversize: (event) => {
        events.push(event);
      },
    });
    const lines: string[] = [];
    let buffered = '';
    output.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      for (let nl = buffered.indexOf('\n'); nl >= 0; nl = buffered.indexOf('\n')) {
        lines.push(buffered.slice(0, nl));
        buffered = buffered.slice(nl + 1);
      }
    });
    return { input, output, events, lines };
  }

  it('When a message is exactly 64 KiB, then it is passed on untouched', async () => {
    const { input, events, lines } = guarded();
    const exact = lineOfSize(1, MAX_STDIO_MESSAGE_BYTES);
    expect(Buffer.byteLength(exact)).toBe(MAX_STDIO_MESSAGE_BYTES);
    input.write(`${exact}\n`);
    await flushMicrotasks();
    expect(lines).toEqual([exact]);
    expect(events).toEqual([]);
  });

  it('When a message is one byte over, then it is dropped and reported once with its id and size', async () => {
    const { input, events, lines } = guarded();
    input.write(`${lineOfSize(41, MAX_STDIO_MESSAGE_BYTES + 1)}\n`);
    await flushMicrotasks();
    expect(lines).toEqual([]);
    expect(events).toEqual([{ id: 41, bytes: MAX_STDIO_MESSAGE_BYTES + 1 }]);
  });

  it('When an oversize message arrives in small pieces, then it is still one event and the next message is intact', async () => {
    const { input, events, lines } = guarded();
    const big = lineOfSize(7, MAX_STDIO_MESSAGE_BYTES * 2);
    for (let i = 0; i < big.length; i += 1000) input.write(big.slice(i, i + 1000));
    input.write(`\n${ping(8)}`);
    await flushMicrotasks();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 7 });
    expect(lines).toEqual([ping(8).trimEnd()]);
  });

  it('When handling an oversize message fails, then later messages still pass', async () => {
    const input = new PassThrough();
    const output = guardMessages(input, {
      maxBytes: 100,
      onOversize: () => Promise.reject(new Error('reply failed')),
    });
    const seen: string[] = [];
    output.on('data', (chunk: Buffer) => seen.push(chunk.toString('utf8')));
    input.write(`${'x'.repeat(200)}\n${ping(3)}`);
    await flushMicrotasks();
    expect(seen).toEqual([ping(3)]);
  });

  it('When many small messages arrive in one big chunk, then all of them pass', async () => {
    const { input, events, lines } = guarded();
    input.write(Array.from({ length: 3000 }, (_, i) => ping(i)).join(''));
    await flushMicrotasks();
    expect(lines).toHaveLength(3000);
    expect(events).toEqual([]);
  });

  it('When the id of an oversize message is a string, cannot be found or is hidden, then the id is a string or null', async () => {
    const { input, events } = guarded();
    const filler = 'x'.repeat(MAX_STDIO_MESSAGE_BYTES);
    input.write(`{"jsonrpc":"2.0","id":"abc-1","method":"ping","params":{"pad":"${filler}"}}\n`);
    input.write(`{"jsonrpc":"2.0","method":"notifications/x","params":{"pad":"${filler}"}}\n`);
    input.write(`${filler}${filler}\n`);
    await flushMicrotasks();
    expect(events.map((e) => e.id)).toEqual(['abc-1', null, null]);
  });

  it('When the input ends, then the guarded stream ends too; a half message without a newline is not passed on', async () => {
    const { input, output, lines } = guarded();
    let ended = false;
    output.on('end', () => {
      ended = true;
    });
    input.write('{"half":');
    input.end();
    await new Promise((resolve) => output.once('close', resolve));
    expect(ended).toBe(true);
    expect(lines).toEqual([]);
  });

  it('When the input fails, then the guarded stream fails with it', async () => {
    const { input, output } = guarded();
    const failure = new Promise((resolve) => output.once('error', resolve));
    input.destroy(new Error('pipe broke'));
    expect(await failure).toMatchObject({ message: 'pipe broke' });
  });

  it('When text chunks are written instead of bytes, then they are handled the same', async () => {
    const { input, lines } = guarded();
    input.setEncoding('utf8');
    input.write(ping(5));
    await flushMicrotasks();
    expect(lines).toHaveLength(1);
  });
});

/** A request written the way the SDK client writes it: the id comes last. */
function idLastLine(id: number | string, bytes: number, nested = ''): string {
  const idText = JSON.stringify(id);
  const base = `{"method":"ping","params":{"pad":"",${nested}},"jsonrpc":"2.0","id":${idText}}`;
  return base.replace('"pad":""', `"pad":"${'x'.repeat(bytes - base.length)}"`);
}

describe('Given the id of an oversize message', () => {
  function events() {
    const input = new PassThrough();
    const seen: OversizeEvent[] = [];
    guardMessages(input, {
      maxBytes: MAX_STDIO_MESSAGE_BYTES,
      onOversize: (event) => {
        seen.push(event);
      },
    }).resume();
    return { input, seen };
  }
  const over = MAX_STDIO_MESSAGE_BYTES + 5000;

  it('When the id is written last, as the SDK client does, then the error carries that id', async () => {
    const { input, seen } = events();
    input.write(`${idLastLine(41, over)}\n${idLastLine('req-7', over)}\n`);
    await flushMicrotasks();
    expect(seen.map((e) => e.id)).toEqual([41, 'req-7']);
  });

  it('When a nested id sits inside params, then it is never used', async () => {
    const { input, seen } = events();
    input.write(`${idLastLine(5, over, '"id":99,"deep":{"id":98}')}\n`);
    input.write(`${`{"params":{"id":99,"pad":"${'x'.repeat(over)}"},"jsonrpc":"2.0"}`}\n`);
    await flushMicrotasks();
    expect(seen.map((e) => e.id)).toEqual([5, null]);
  });

  it('When an id appears inside a string value, then it is ignored', async () => {
    const { input, seen } = events();
    input.write(
      `{"params":{"pad":"${'x'.repeat(over)}","note":"\\"id\\":77"},"note2":"\"id\": 66","jsonrpc":"2.0","id":12}\n`,
    );
    await flushMicrotasks();
    expect(seen.map((e) => e.id)).toEqual([12]);
  });

  it('When the id is not a string or a number, then the id is null', async () => {
    const { input, seen } = events();
    input.write(
      `{"pad":"${'x'.repeat(over)}","id":{"a":1}}\n{"pad":"${'x'.repeat(over)}","id":true}\n`,
    );
    await flushMicrotasks();
    expect(seen.map((e) => e.id)).toEqual([null, null]);
  });

  it('When the message arrives in odd-sized pieces, then the id is still found', async () => {
    const { input, seen } = events();
    const line = `${idLastLine(321, over)}\n`;
    for (let i = 0; i < line.length; i += 777) input.write(line.slice(i, i + 777));
    await flushMicrotasks();
    expect(seen.map((e) => e.id)).toEqual([321]);
  });
});

describe('Given work piles up behind a pending oversize reply', () => {
  function pending(options: { maxQueuedMessages?: number; maxQueuedBytes?: number }) {
    const input = new PassThrough();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivered: string[] = [];
    let overflows = 0;
    const output = guardMessages(input, {
      maxBytes: 100,
      onOversize: () => gate,
      onQueueOverflow: () => {
        overflows += 1;
      },
      ...options,
    });
    output.on('data', (chunk: Buffer) => delivered.push(chunk.toString('utf8')));
    return { input, delivered, release, overflows: () => overflows };
  }
  const big = `${'x'.repeat(200)}\n`;

  it('When more messages wait than the cap, then the overflow is reported once and reading stops', async () => {
    const { input, delivered, release, overflows } = pending({ maxQueuedMessages: 3 });
    input.write(`${big}a\nb\n`);
    await flushMicrotasks();
    expect(overflows()).toBe(0);
    input.write('c\nd\ne\n');
    await flushMicrotasks();
    expect(overflows()).toBe(1);
    release();
    await flushMicrotasks();
    // What was queued before the overflow is still delivered, in order; nothing after it is.
    expect(delivered.join('')).toBe('a\nb\n');
  });

  it('When the waiting messages add up to more than the byte cap, then the overflow is reported', async () => {
    const { input, release, overflows } = pending({ maxQueuedBytes: 50 });
    input.write(`${big}${'a'.repeat(30)}\n${'b'.repeat(30)}\n`);
    await flushMicrotasks();
    expect(overflows()).toBe(1);
    release();
  });

  it('When oversize messages themselves pile up past the cap, then the overflow is reported', async () => {
    const { input, release, overflows } = pending({ maxQueuedMessages: 2 });
    input.write(`${big}${big}${big}`);
    await flushMicrotasks();
    expect(overflows()).toBe(1);
    release();
  });

  it('When the cap is not configured, then it is 1000 messages or 1 MiB', () => {
    expect(MAX_QUEUED_MESSAGES).toBe(1000);
    expect(MAX_QUEUED_BYTES).toBe(1024 * 1024);
  });
});

describe('Given a consumer that reads slowly', () => {
  it('When the guarded stream is full, then the input is paused until the consumer drains it', async () => {
    const input = new PassThrough();
    const output = guardMessages(input, { maxBytes: 20_000, onOversize: () => undefined });
    const line = `${'m'.repeat(10_000)}\n`;
    for (let i = 0; i < 8; i += 1) input.write(line);
    await until(() => input.isPaused());
    expect(input.isPaused()).toBe(true);

    let received = 0;
    output.on('data', (chunk: Buffer) => {
      received += chunk.length;
    });
    await until(() => received > 0 && !input.isPaused());
    expect(received).toBeGreaterThan(0);
    expect(input.isPaused()).toBe(false);
  });

  it('When messages wait behind a pending reply and the consumer is slow, then the queue waits for the drain', async () => {
    const input = new PassThrough();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const output = guardMessages(input, { maxBytes: 20_000, onOversize: () => gate });
    input.write(`${'x'.repeat(30_000)}\n`);
    const line = `${'m'.repeat(10_000)}\n`;
    input.write(line.repeat(6));
    await flushMicrotasks();
    release();
    await flushMicrotasks();
    let received = 0;
    output.on('data', (chunk: Buffer) => {
      received += chunk.length;
    });
    await new Promise((resolve) => output.once('drain', resolve).once('readable', resolve));
    await until(() => received >= line.length * 6);
    expect(received).toBe(line.length * 6);
  });
});

describe('Given a final oversize message that never gets a newline', () => {
  it('When the input ends, then it is reported once with its id', async () => {
    const input = new PassThrough();
    const seen: OversizeEvent[] = [];
    const output = guardMessages(input, {
      maxBytes: MAX_STDIO_MESSAGE_BYTES,
      onOversize: (event) => {
        seen.push(event);
      },
    });
    output.resume();
    input.write(idLastLine(8, MAX_STDIO_MESSAGE_BYTES + 10));
    input.end();
    await new Promise((resolve) => output.once('close', resolve));
    expect(seen).toEqual([{ id: 8, bytes: MAX_STDIO_MESSAGE_BYTES + 10 }]);
  });
});

describe('Given a running stdio server and a message over the limit', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  const serverMessages = () =>
    h.stdout
      .join('')
      .split('\n')
      .filter((line) => line !== '')
      .map(
        (line) =>
          JSON.parse(line) as { id?: unknown; error?: { code: number; data?: { code: string } } },
      );

  it('When the message is too large, then the sender gets a defined error with its id instead of silence', async () => {
    h.rawInput.write(`${lineOfSize(9001, MAX_STDIO_MESSAGE_BYTES + 100)}\n`);
    await h.client.ping();
    const reply = serverMessages().find((m) => m.id === 9001);
    expect(reply?.error?.code).toBe(-32600);
    expect(reply?.error?.data?.code).toBe('message_too_large');
  });

  it('When the id cannot be read, then the error response carries a null id', async () => {
    h.rawInput.write(`${'y'.repeat(MAX_STDIO_MESSAGE_BYTES + 100)}\n`);
    await h.client.ping();
    expect(
      serverMessages().some((m) => m.id === null && m.error?.data?.code === 'message_too_large'),
    ).toBe(true);
  });

  it('When it happens, then there is one operational log line and one audit record with outcome invalid', async () => {
    h.rawInput.write(`${lineOfSize(9002, MAX_STDIO_MESSAGE_BYTES + 100)}\n`);
    await h.client.ping();
    expect(h.logLines.filter((line) => line.includes('stdio.oversize'))).toHaveLength(1);
    const records = (await h.auditRecords()).filter((r) => r.tool === '(oversized message)');
    expect(records).toMatchObject([{ outcome: 'invalid', phase: 'complete' }]);
  });

  it('When it has happened, then the server keeps serving normal calls', async () => {
    h.rawInput.write(`${lineOfSize(9003, MAX_STDIO_MESSAGE_BYTES * 3)}\n`);
    const result = await h.client.callTool({
      name: 'get_ci_job',
      arguments: { repo: 'sample-node-api', jobId: 'job-1001-1' },
    });
    expect(result.structuredContent).toMatchObject({ status: 'failed' });
  });

  it('When a normal message is exactly at the limit, then it is answered normally', async () => {
    h.rawInput.write(`${lineOfSize(9004, MAX_STDIO_MESSAGE_BYTES)}\n`);
    await h.client.ping();
    const reply = serverMessages().find((m) => m.id === 9004);
    expect(reply).toBeDefined();
    expect(reply).not.toHaveProperty('error');
  });

  it('When a real SDK client sends an oversize request, then it is rejected with its own id instead of timing out', async () => {
    // The SDK client writes the id last, and its schema accepts our error's shape.
    await expect(
      h.client.callTool(
        {
          name: 'get_ci_job',
          arguments: { repo: 'x'.repeat(MAX_STDIO_MESSAGE_BYTES), jobId: 'j' },
        },
        undefined,
        { timeout: 2000 },
      ),
    ).rejects.toMatchObject({
      code: -32600,
      message: expect.stringContaining('larger than') as unknown,
    });
    const records = (await h.auditRecords()).filter((r) => r.tool === '(oversized message)');
    expect(records).toHaveLength(1);
  });

  it('When an oversize request is the last thing the agent sends and has no newline, then it still gets a log line and an invalid record', async () => {
    h.rawInput.write(idLastLine(9005, MAX_STDIO_MESSAGE_BYTES + 100));
    h.rawInput.end();
    await until(() => h.logLines.some((line) => line.includes('stdio.oversize')));
    await until(() => serverMessages().some((m) => m.id === 9005));
    expect((await h.auditRecords()).filter((r) => r.tool === '(oversized message)')).toMatchObject([
      { outcome: 'invalid' },
    ]);
  });

  it('When more messages pile up behind an oversize one than the cap allows, then the transport is closed with one log line', async () => {
    const pings = Array.from({ length: MAX_QUEUED_MESSAGES + 5 }, (_, i) => ping(i)).join('');
    h.rawInput.write(`${lineOfSize(9006, MAX_STDIO_MESSAGE_BYTES + 100)}\n${pings}`);
    await until(() => h.logLines.some((line) => line.includes('stdio.queue_overflow')));
    expect(h.logLines.filter((line) => line.includes('stdio.queue_overflow'))).toHaveLength(1);
  });
});
