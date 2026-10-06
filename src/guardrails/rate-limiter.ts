import type { Clock, Scheduler, TimerHandle } from '../core/ports.js';
import type { ToolKind } from '../core/tool-types.js';

/**
 * Rate limiter (LC-06): a fixed window per client, 30 reads and 3 writes every 60 seconds.
 * The window starts at the client's first call and the counters reset when it ends. Reads
 * and writes are counted separately, a rejected call is not counted, and entries whose
 * window has passed are swept every 60 seconds so the table stays at most one entry per
 * client (FR7.1, FR7.2, NFR1.8, NFR1.17).
 */

export const WINDOW_MS = 60_000;
export const READ_LIMIT = 30;
export const WRITE_LIMIT = 3;

export type RateDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterMs: number };

interface Entry {
  windowStart: number;
  reads: number;
  writes: number;
}

export interface RateLimiterOptions {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
}

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly sweeper: TimerHandle;

  constructor(private readonly options: RateLimiterOptions) {
    this.sweeper = options.scheduler.every(WINDOW_MS, () => {
      this.sweep();
    });
  }

  get trackedClients(): number {
    return this.entries.size;
  }

  /** Counts one call by this client if the limit allows it. */
  check(client: string, kind: ToolKind): RateDecision {
    const now = this.options.clock.now();
    let entry = this.entries.get(client);
    if (entry === undefined || now >= entry.windowStart + WINDOW_MS) {
      entry = { windowStart: now, reads: 0, writes: 0 };
      this.entries.set(client, entry);
    }
    const used = kind === 'write' ? entry.writes : entry.reads;
    const limit = kind === 'write' ? WRITE_LIMIT : READ_LIMIT;
    if (used >= limit) {
      return { allowed: false, retryAfterMs: entry.windowStart + WINDOW_MS - now };
    }
    if (kind === 'write') entry.writes += 1;
    else entry.reads += 1;
    return { allowed: true };
  }

  /** Cancels the periodic sweep. */
  stop(): void {
    this.sweeper.cancel();
  }

  private sweep(): void {
    const now = this.options.clock.now();
    for (const [client, entry] of this.entries) {
      if (now >= entry.windowStart + WINDOW_MS) this.entries.delete(client);
    }
  }
}
