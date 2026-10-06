import type { Clock, IdSource, Net, Rng, Scheduler, TimerHandle } from '../../src/core/ports.js';
import type { AuditSink } from '../../src/guardrails/audit.js';

/** Lets promise continuations run, so awaited work finishes between fake-clock steps. */
export async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

/** A clock that only moves when the test says so. */
export class FakeClock implements Clock {
  constructor(private current = Date.UTC(2026, 9, 5, 12, 0, 0)) {}

  now(): number {
    return this.current;
  }

  set(epochMs: number): void {
    this.current = epochMs;
  }

  /** Moves time forward without firing timers; use FakeScheduler.advance for that. */
  tick(ms: number): void {
    this.current += ms;
  }
}

interface FakeTimer {
  id: number;
  due: number;
  period?: number;
  callback: () => void;
  cancelled: boolean;
}

/** A scheduler driven by a FakeClock. `advance` fires due timers in order. */
export class FakeScheduler implements Scheduler {
  private timers: FakeTimer[] = [];
  private nextId = 1;

  constructor(private readonly clock: FakeClock) {}

  get pendingCount(): number {
    return this.timers.filter((timer) => !timer.cancelled).length;
  }

  after(ms: number, callback: () => void): TimerHandle {
    return this.add(ms, callback);
  }

  every(ms: number, callback: () => void): TimerHandle {
    return this.add(ms, callback, ms);
  }

  delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.add(ms, resolve);
    });
  }

  /** Moves the clock forward, firing every timer that falls due, in order. */
  async advance(ms: number): Promise<void> {
    const target = this.clock.now() + ms;
    for (;;) {
      const next = this.timers
        .filter((timer) => !timer.cancelled && timer.due <= target)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (next === undefined) break;
      this.clock.set(Math.max(this.clock.now(), next.due));
      if (next.period === undefined) {
        next.cancelled = true;
      } else {
        next.due += next.period;
      }
      next.callback();
      await flushMicrotasks();
    }
    this.clock.set(target);
    this.timers = this.timers.filter((timer) => !timer.cancelled);
    await flushMicrotasks();
  }

  private add(ms: number, callback: () => void, period?: number): TimerHandle {
    const timer: FakeTimer = {
      id: this.nextId,
      due: this.clock.now() + ms,
      callback,
      cancelled: false,
      ...(period === undefined ? {} : { period }),
    };
    this.nextId += 1;
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }
}

/** Deterministic randomness: bytes count upwards, floats follow a fixed sequence. */
export class FakeRng implements Rng {
  private counter = 0;
  private floatState = 0.25;

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      out[i] = this.counter % 256;
      this.counter += 1;
    }
    return out;
  }

  float(): number {
    this.floatState = (this.floatState * 3.7 + 0.11) % 1;
    return this.floatState;
  }
}

const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567';

function sequentialId(prefix: string, counter: number): string {
  let rest = '';
  let value = counter;
  do {
    rest = (base32Alphabet[value % 32] ?? 'a') + rest;
    value = Math.floor(value / 32);
  } while (value > 0);
  return `${prefix}${rest.padStart(26, 'a')}`;
}

/** Readable sequential identifiers with the real shapes: call_aaaa...b, call_aaaa...c, ... */
export class FakeIdSource implements IdSource {
  private calls = 0;
  private requests = 0;
  private sessions = 0;

  callId(): string {
    this.calls += 1;
    return sequentialId('call_', this.calls);
  }

  requestId(): string {
    this.requests += 1;
    return sequentialId('req_', this.requests);
  }

  sessionId(): string {
    this.sessions += 1;
    return sequentialId('sess_', this.sessions);
  }
}

export interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

/** A Net that records every request and answers from a queue of canned responses. */
export class FakeNet implements Net {
  readonly requests: RecordedRequest[] = [];
  private readonly responses: (Response | Error)[] = [];

  enqueue(...responses: (Response | Error)[]): void {
    this.responses.push(...responses);
  }

  fetch: Net['fetch'] = (input, init) => {
    this.requests.push({ url: requestUrl(input), init });
    const next = this.responses.shift();
    if (next === undefined) return Promise.reject(new Error('FakeNet: no response queued'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
}

function requestUrl(input: Parameters<Net['fetch']>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** An in-memory audit file. It can be told to fail or to run out of room. */
export class MemoryAuditSink implements AuditSink {
  readonly lines: string[] = [];
  /** Whether each appended line asked for a durable (fsync) write. */
  readonly durableFlags: boolean[] = [];
  failWith: Error | undefined;
  /** When set, only lines for which this returns true fail (for example intent lines). */
  failWhen: ((line: string) => boolean) | undefined;
  closed = false;

  append(line: string, options?: { durable?: boolean }): Promise<void> {
    if (this.failWith !== undefined && (this.failWhen?.(line) ?? true)) {
      return Promise.reject(this.failWith);
    }
    this.lines.push(line);
    this.durableFlags.push(options?.durable === true);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  /** The parsed audit records, in order. */
  records(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}
