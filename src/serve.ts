import type { Readable, Writable } from 'node:stream';
import { createApp } from './app.js';
import { ConfigError, loadConfig, type Environment } from './core/config.js';
import { createIdSource } from './core/identity.js';
import { Lifecycle, type StoppableTransport } from './core/lifecycle.js';
import type { Clock, Rng, Scheduler } from './core/ports.js';
import { UnsafeSocketDirectoryError } from './guardrails/admin-channel.js';
import { AuditLockedError } from './guardrails/audit.js';
import { startHttpTransport } from './transport/http.js';
import { startStdioTransport } from './transport/stdio.js';

/**
 * The server process, minus the process globals: chooses stdio or HTTP mode, starts the
 * app and its transport, and wires orderly shutdown. `src/bin/server.ts` passes in the
 * real arguments, environment, signals and exit.
 */

export interface ServeDeps {
  readonly argv: readonly string[];
  readonly env: Environment;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly rng: Rng;
  /** Receives one operational-log line (standard error). */
  readonly logSink: (line: string) => void;
  readonly exit: (code: number) => void;
  readonly onSignal: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => void;
  readonly stdin?: Readable;
  readonly stdout?: Writable;
}

/** Returns an exit code if the server could not start, or undefined once it is running. */
export async function serve(deps: ServeDeps): Promise<number | undefined> {
  try {
    const httpMode = deps.argv.includes('--http');
    const config = loadConfig(deps.env);
    const app = await createApp({
      config,
      mode: httpMode ? 'http' : 'stdio',
      clock: deps.clock,
      scheduler: deps.scheduler,
      ids: createIdSource(deps.rng),
      rng: deps.rng,
      logSink: deps.logSink,
    });

    const transports: StoppableTransport[] = [];
    const lifecycle = new Lifecycle({
      wrapper: app.wrapper,
      scheduler: deps.scheduler,
      logger: app.logger,
      transports,
      close: () => app.close(),
      exit: deps.exit,
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      deps.onSignal(signal, () => {
        void lifecycle.handleSignal(signal);
      });
    }

    try {
      transports.push(
        httpMode
          ? await startHttpTransport(app, { config, scheduler: deps.scheduler })
          : await startStdioTransport(app, {
              ...(deps.stdin === undefined ? {} : { stdin: deps.stdin }),
              ...(deps.stdout === undefined ? {} : { stdout: deps.stdout }),
              onDisconnect: () => {
                void lifecycle.handleSignal('stdin closed');
              },
            }),
      );
    } catch (error) {
      await app.close();
      throw error;
    }
    return undefined;
  } catch (error) {
    const message =
      error instanceof ConfigError ||
      error instanceof AuditLockedError ||
      error instanceof UnsafeSocketDirectoryError
        ? error.message
        : 'The server failed to start.';
    deps.logSink(JSON.stringify({ level: 'error', msg: 'server.start_failed', err: message }));
    return 1;
  }
}
