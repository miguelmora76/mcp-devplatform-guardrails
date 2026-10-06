import { mkdir, mkdtemp, readdir, readFile, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/core/config.js';
import { Lifecycle, DRAIN_TIMEOUT_MS } from '../../src/core/lifecycle.js';
import { createLogger } from '../../src/core/logger.js';
import { createRedactor } from '../../src/core/redactor.js';
import { UnsafeSocketDirectoryError } from '../../src/guardrails/admin-channel.js';
import { until } from '../support/http-harness.js';
import { startStdioTransport } from '../../src/transport/stdio.js';
import {
  FakeClock,
  FakeIdSource,
  FakeRng,
  FakeScheduler,
  flushMicrotasks,
} from '../support/fakes.js';
import { alice, createWrapperFixture } from '../support/wrapper-fixture.js';

function setup(overrides: { closeFails?: boolean; stopFails?: boolean } = {}) {
  const fx = createWrapperFixture();
  const order: string[] = [];
  const exits: number[] = [];
  const logLines: string[] = [];
  const lifecycle = new Lifecycle({
    wrapper: fx.wrapper,
    scheduler: fx.scheduler,
    logger: createLogger({
      sink: (line) => logLines.push(line),
      clock: fx.clock,
      redactor: createRedactor(),
      level: 'debug',
      component: 'Lifecycle',
    }),
    transports: [
      {
        stopAccepting: () => {
          order.push('stopAccepting');
          return overrides.stopFails === true ? Promise.reject(new Error('x')) : Promise.resolve();
        },
      },
    ],
    close: () => {
      order.push('close');
      return overrides.closeFails === true
        ? Promise.reject(new Error('close failed'))
        : Promise.resolve();
    },
    exit: (code) => {
      order.push('exit');
      exits.push(code);
    },
  });
  return { fx, lifecycle, order, exits, logLines };
}

describe('Given the server receives SIGINT or SIGTERM', () => {
  it('When nothing is in flight, then it stops accepting, closes everything and exits cleanly, in that order', async () => {
    const { lifecycle, order, exits, logLines } = setup();
    await lifecycle.handleSignal('SIGTERM');
    expect(order).toEqual(['stopAccepting', 'close', 'exit']);
    expect(exits).toEqual([0]);
    expect(logLines.join('\n')).toContain('server.stop');
  });

  it('When a call is in flight, then its audit record is written before anything is closed', async () => {
    const { fx, lifecycle, order, exits } = setup();
    const call = fx.wrapper.call(alice, 'slow_read', {});
    await flushMicrotasks();
    const shutdown = lifecycle.handleSignal('SIGINT');
    await flushMicrotasks();
    expect(order).toEqual(['stopAccepting']);
    expect(fx.sink.records()).toHaveLength(0);

    fx.gate.open();
    await call;
    await shutdown;
    expect(fx.sink.records()).toMatchObject([{ tool: 'slow_read', outcome: 'allowed' }]);
    expect(order).toEqual(['stopAccepting', 'close', 'exit']);
    expect(exits).toEqual([0]);
  });

  it('When a new call arrives after the signal, then it is refused and recorded, not started', async () => {
    const { fx, lifecycle } = setup();
    const held = fx.wrapper.call(alice, 'slow_read', {});
    await flushMicrotasks();
    const shutdown = lifecycle.handleSignal('SIGTERM');
    await flushMicrotasks();
    const late = await fx.wrapper.call(alice, 'echo_read', { text: 'late' });
    expect(!late.ok && late.error.code).toBe('shutting_down');
    fx.gate.open();
    await held;
    await shutdown;
    expect(fx.calls.read).toBe(0);
  });

  it('When a call never finishes, then shutdown continues after 5 seconds and says so', async () => {
    const { fx, lifecycle, exits, logLines } = setup();
    void fx.wrapper.call(alice, 'slow_read', {});
    await flushMicrotasks();
    const shutdown = lifecycle.handleSignal('SIGTERM');
    await flushMicrotasks();
    await fx.scheduler.advance(DRAIN_TIMEOUT_MS - 1);
    expect(exits).toEqual([]);
    await fx.scheduler.advance(1);
    await shutdown;
    expect(exits).toEqual([0]);
    expect(logLines.join('\n')).toContain('server.drain_timeout');
  });

  it('When a second signal arrives while draining, then it exits at once', async () => {
    const { fx, lifecycle, exits } = setup();
    void fx.wrapper.call(alice, 'slow_read', {});
    await flushMicrotasks();
    void lifecycle.handleSignal('SIGINT');
    await flushMicrotasks();
    await lifecycle.handleSignal('SIGINT');
    expect(exits).toEqual([1]);
  });

  it('When closing fails, then the failure is logged and the exit code says so', async () => {
    const { lifecycle, exits, logLines } = setup({ closeFails: true });
    await lifecycle.handleSignal('SIGTERM');
    expect(exits).toEqual([1]);
    expect(logLines.join('\n')).toContain('close failed');
  });

  it('When a transport cannot stop cleanly, then shutdown still continues to close and exit', async () => {
    const { lifecycle, exits, order } = setup({ stopFails: true });
    await lifecycle.handleSignal('SIGTERM');
    expect(order).toEqual(['stopAccepting', 'close', 'exit']);
    expect(exits).toEqual([0]);
  });
});

describe('Given a real server is started and then stopped', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory !== undefined) {
      await chmod(directory, 0o700).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function build(socketDirName = 'run') {
    directory = await mkdtemp(join(tmpdir(), 'gr-life-'));
    const clock = new FakeClock();
    const scheduler = new FakeScheduler(clock);
    const auditPath = join(directory, 'audit.jsonl');
    const config = loadConfig({
      GUARDRAILS_AUDIT_PATH: auditPath,
      GUARDRAILS_SOCKET_DIR: join(directory, socketDirName),
    });
    const make = () =>
      createApp({
        config,
        clock,
        scheduler,
        ids: new FakeIdSource(),
        rng: new FakeRng(),
        mode: 'stdio',
        logSink: () => undefined,
      });
    return { config, auditPath, make, clock, scheduler };
  }

  it('When it shuts down on a signal, then the audit file is flushed and the lock and socket are removed', async () => {
    const { make, auditPath, scheduler, config } = await build();
    const app = await make();
    const input = new PassThrough();
    const transport = await startStdioTransport(app, { stdin: input, stdout: new PassThrough() });
    await app.wrapper.call({ name: transport.client }, 'get_ci_job', {
      repo: 'sample-node-api',
      jobId: 'job-1001-1',
    });
    expect(await readdir(config.socketDir)).toHaveLength(1);
    const exits: number[] = [];
    await new Lifecycle({
      wrapper: app.wrapper,
      scheduler,
      logger: app.logger,
      transports: [transport],
      close: () => app.close(),
      exit: (code) => exits.push(code),
    }).handleSignal('SIGTERM');

    expect(exits).toEqual([0]);
    expect((await readFile(auditPath, 'utf8')).trim().split('\n')).toHaveLength(1);
    await expect(stat(`${auditPath}.lock`)).rejects.toThrow();
    expect(await readdir(config.socketDir)).toEqual([]);
  });

  it('When the socket folder is unsafe, then startup is refused and the audit lock is not left behind', async () => {
    const { make, auditPath, config } = await build();
    await mkdir(config.socketDir, { recursive: true });
    await chmod(config.socketDir, 0o755);
    await expect(make()).rejects.toBeInstanceOf(UnsafeSocketDirectoryError);
    await expect(stat(`${auditPath}.lock`)).rejects.toThrow();

    await chmod(config.socketDir, 0o700);
    const app = await make();
    await app.close();
  });

  it('When the agent closes the input stream, then the disconnect callback runs once', async () => {
    const { make } = await build();
    const app = await make();
    const input = new PassThrough();
    let disconnects = 0;
    const transport = await startStdioTransport(app, {
      stdin: input,
      stdout: new PassThrough(),
      onDisconnect: () => {
        disconnects += 1;
      },
    });
    input.end();
    await until(() => disconnects > 0);
    expect(disconnects).toBe(1);
    await transport.close();
    await app.close();
  });
});
