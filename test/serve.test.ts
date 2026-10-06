import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serve, type ServeDeps } from '../src/serve.js';
import { until } from './support/http-harness.js';
import { FakeClock, FakeRng, FakeScheduler } from './support/fakes.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gr-serve-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function setup(argv: string[] = [], env: Record<string, string> = {}) {
  const clock = new FakeClock();
  const logLines: string[] = [];
  const exits: number[] = [];
  const handlers = new Map<string, () => void>();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const deps: ServeDeps = {
    argv,
    env: {
      GUARDRAILS_AUDIT_PATH: join(directory, 'audit.jsonl'),
      GUARDRAILS_SOCKET_DIR: join(directory, 'run'),
      GUARDRAILS_HTTP_PORT: '0',
      ...env,
    },
    clock,
    scheduler: new FakeScheduler(clock),
    rng: new FakeRng(),
    logSink: (line) => logLines.push(line),
    exit: (code) => exits.push(code),
    onSignal: (signal, handler) => {
      handlers.set(signal, handler);
    },
    stdin,
    stdout,
  };
  return { deps, logLines, exits, handlers, stdin, stdout };
}

const token = `mgt_TEST${'a'.repeat(40)}`;

describe('Given the server process starts in stdio mode', () => {
  it('When it starts, then it serves the protocol on the given streams and listens for SIGINT and SIGTERM', async () => {
    const { deps, handlers, stdin, stdout, exits } = setup();
    expect(await serve(deps)).toBeUndefined();
    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);

    const reply = new Promise<string>((resolve) =>
      stdout.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8'))),
    );
    stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })}\n`,
    );
    expect(await reply).toContain('mcp-devplatform-guardrails');

    handlers.get('SIGTERM')?.();
    await until(() => exits.length > 0);
    expect(exits).toEqual([0]);
  });

  it('When the agent closes the input, then the server shuts down by itself', async () => {
    const { deps, stdin, exits } = setup();
    await serve(deps);
    stdin.end();
    await new Promise((resolve) => stdin.once('close', resolve));
    await until(() => exits.length > 0);
    expect(exits).toEqual([0]);
  });
});

describe('Given the server process starts in HTTP mode', () => {
  it('When tokens are configured, then it listens and shuts down on a signal', async () => {
    const { deps, handlers, exits, logLines } = setup(['--http'], {
      GUARDRAILS_TOKENS: `alice=${token}`,
    });
    expect(await serve(deps)).toBeUndefined();
    expect(logLines.join('\n')).toContain('"mode":"http"');
    handlers.get('SIGINT')?.();
    await until(() => exits.length > 0);
    expect(exits).toEqual([0]);
  });

  it('When no token is configured, then startup is refused with a clear message and nothing is left behind', async () => {
    const { deps, logLines } = setup(['--http']);
    expect(await serve(deps)).toBe(1);
    expect(logLines.join('\n')).toContain('HTTP mode needs GUARDRAILS_TOKENS');
    const again = setup(['--http'], { GUARDRAILS_TOKENS: `alice=${token}` });
    // Same folder and audit file: they were released by the failed start.
    expect(
      await serve({
        ...again.deps,
        env: {
          ...again.deps.env,
          GUARDRAILS_AUDIT_PATH: join(directory, 'audit.jsonl'),
          GUARDRAILS_SOCKET_DIR: join(directory, 'run'),
        },
      }),
    ).toBeUndefined();
    again.handlers.get('SIGTERM')?.();
    await until(() => again.exits.length > 0);
  });

  it('When the port is already taken, then startup fails with a generic message and the audit lock is released', async () => {
    const busy = createServer();
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
    const address = busy.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const { deps, logLines } = setup(['--http'], {
        GUARDRAILS_TOKENS: `alice=${token}`,
        GUARDRAILS_HTTP_PORT: String(port),
      });
      expect(await serve(deps)).toBe(1);
      expect(logLines.join('\n')).toContain('The server failed to start.');
      const retry = setup(['--http'], { GUARDRAILS_TOKENS: `alice=${token}` });
      expect(await serve(retry.deps)).toBeUndefined();
      retry.handlers.get('SIGTERM')?.();
      await until(() => retry.exits.length > 0);
    } finally {
      busy.close();
    }
  });
});

describe('Given the server cannot start', () => {
  it('When the configuration is invalid, then it says which setting is wrong and exits with 1', async () => {
    const { deps, logLines } = setup([], { GUARDRAILS_LOG_LEVEL: 'chatty' });
    expect(await serve(deps)).toBe(1);
    expect(logLines.join('\n')).toContain('GUARDRAILS_LOG_LEVEL');
  });

  it('When another server holds the audit file, then startup is refused with that reason', async () => {
    const first = setup();
    await serve(first.deps);
    const second = setup(['--http'], {
      GUARDRAILS_TOKENS: `alice=${token}`,
      GUARDRAILS_SOCKET_DIR: join(directory, 'run2'),
    });
    expect(await serve(second.deps)).toBe(1);
    expect(second.logLines.join('\n')).toContain('locked by another running process');
    first.handlers.get('SIGTERM')?.();
    await until(() => first.exits.length > 0);
  });

  it('When the socket folder is unsafe, then startup is refused with that reason', async () => {
    const { mkdir, chmod } = await import('node:fs/promises');
    await mkdir(join(directory, 'run'), { recursive: true });
    await chmod(join(directory, 'run'), 0o755);
    const { deps, logLines } = setup();
    expect(await serve(deps)).toBe(1);
    expect(logLines.join('\n')).toContain('must not be accessible');
  });
});
