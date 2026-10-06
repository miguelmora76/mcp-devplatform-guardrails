import type { Logger } from './logger.js';
import type { Scheduler, TimerHandle } from './ports.js';

/**
 * Lifecycle (LC-18): orderly shutdown on SIGINT or SIGTERM (NFR1.15). The first signal
 * stops new connections and calls, lets calls in flight finish and write their audit
 * records (up to 5 s), then closes the audit file, the admin socket and the lock, and
 * exits. A second signal exits at once.
 */

export const DRAIN_TIMEOUT_MS = 5000;

export interface DrainingWrapper {
  beginShutdown(): void;
  drain(): Promise<void>;
  readonly inFlight: number;
}

export interface StoppableTransport {
  stopAccepting(): Promise<void>;
}

export interface LifecycleOptions {
  readonly wrapper: DrainingWrapper;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  readonly transports: readonly StoppableTransport[];
  /** Flushes the audit file and removes the lock and socket. */
  readonly close: () => Promise<void>;
  readonly exit: (code: number) => void;
}

export class Lifecycle {
  private stopping = false;

  constructor(private readonly options: LifecycleOptions) {}

  async handleSignal(signal: string): Promise<void> {
    const { wrapper, scheduler, logger, transports, close, exit } = this.options;
    if (this.stopping) {
      logger.warn('server.stop', { signal, reason: 'second signal, exiting now' });
      exit(1);
      return;
    }
    this.stopping = true;
    logger.info('server.stop', { signal });

    wrapper.beginShutdown();
    for (const transport of transports) {
      try {
        await transport.stopAccepting();
      } catch (error) {
        logger.warn('server.stop', { reason: errorText(error) });
      }
    }

    const pending: { timer?: TimerHandle } = {};
    const timedOut = new Promise<'timeout'>((resolve) => {
      pending.timer = scheduler.after(DRAIN_TIMEOUT_MS, () => {
        resolve('timeout');
      });
    });
    const result = await Promise.race([wrapper.drain().then(() => 'drained' as const), timedOut]);
    pending.timer?.cancel();
    if (result === 'timeout') {
      logger.warn('server.drain_timeout', { inFlight: wrapper.inFlight });
    }

    try {
      await close();
      exit(0);
    } catch (error) {
      logger.error('server.stop', { reason: errorText(error) });
      exit(1);
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
