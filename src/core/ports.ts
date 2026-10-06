import { randomBytes } from 'node:crypto';

/**
 * Ports (LC-12): the only place real time, randomness, timers and the network are touched.
 * Every other module receives these through constructor arguments, so tests inject fakes
 * and stay deterministic and offline (NFR5.1-NFR5.3). ESLint forbids the real thing elsewhere.
 */

/** Wall-clock time as milliseconds since the Unix epoch. */
export interface Clock {
  now(): number;
}

/** Cryptographically strong randomness. */
export interface Rng {
  /** Returns `length` random bytes. */
  bytes(length: number): Uint8Array;
  /** Returns a float in [0, 1), used for retry jitter only (never for identifiers). */
  float(): number;
}

/** Handle to a scheduled callback. */
export interface TimerHandle {
  cancel(): void;
}

/** Timers. Callbacks of `every` do not keep the process alive. */
export interface Scheduler {
  /** Runs `callback` once after `ms` milliseconds. */
  after(ms: number, callback: () => void): TimerHandle;
  /** Runs `callback` every `ms` milliseconds until cancelled. */
  every(ms: number, callback: () => void): TimerHandle;
  /** Resolves after `ms` milliseconds. */
  delay(ms: number): Promise<void>;
}

/** Generates the identifiers the design needs (shapes are defined in identity.ts). */
export interface IdSource {
  /** `call_` followed by 26 base32 characters. */
  callId(): string;
  /** `req_` followed by 26 base32 characters. */
  requestId(): string;
  /** `sess_` followed by 26 base32 characters. */
  sessionId(): string;
}

/** Network access. The default mode wires a stub that throws, so no call can leave the process. */
export interface Net {
  fetch: typeof globalThis.fetch;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export const systemRng: Rng = {
  bytes: (length) => new Uint8Array(randomBytes(length)),
  float: () => Math.random(),
};

export const systemScheduler: Scheduler = {
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    return { cancel: () => clearTimeout(timer) };
  },
  every(ms, callback) {
    const timer = setInterval(callback, ms);
    timer.unref();
    return { cancel: () => clearInterval(timer) };
  },
  delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  },
};

export const systemNet: Net = {
  fetch: (input, init) => globalThis.fetch(input, init),
};

/** A Net whose fetch always fails; used whenever live mode is off (NFR4.6). */
export const disabledNet: Net = {
  fetch: () => Promise.reject(new Error('Network access is disabled (live mode is off)')),
};
