import type { Scheduler } from '../core/ports.js';

/**
 * Failed-login throttle (security-design.md, NFR1.16). A valid token never waits. Every
 * failed attempt goes through this one queue, which serves one failure every 200 ms, so
 * however many connections an attacker opens at most about 5 failures a second are
 * processed. At most 20 failures may wait; the next one is turned away at once (the
 * caller closes the connection). There is no per-source table, so nothing grows.
 */

export const FAILURE_COST_MS = 200;
export const MAX_WAITING_FAILURES = 20;

export class FailedLoginQueue {
  private tail: Promise<void> = Promise.resolve();
  private count = 0;

  constructor(private readonly scheduler: Scheduler) {}

  /** Failures currently waiting or being served. */
  get waiting(): number {
    return this.count;
  }

  /** Resolves true once this failure has had its turn, or false at once if the queue is full. */
  async fail(): Promise<boolean> {
    if (this.count >= MAX_WAITING_FAILURES) return false;
    // An idle queue starts its timer at once; a busy one starts it when the previous
    // failure has been served.
    const turn =
      this.count === 0
        ? this.scheduler.delay(FAILURE_COST_MS)
        : this.tail.then(() => this.scheduler.delay(FAILURE_COST_MS));
    this.count += 1;
    this.tail = turn;
    await turn;
    this.count -= 1;
    return true;
  }
}
