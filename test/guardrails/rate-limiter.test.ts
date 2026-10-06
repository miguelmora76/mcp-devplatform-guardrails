import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/guardrails/rate-limiter.js';
import { FakeClock, FakeScheduler } from '../support/fakes.js';

function setup() {
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const limiter = new RateLimiter({ clock, scheduler });
  return { clock, scheduler, limiter };
}

describe('Given the rate limiter allows 30 reads and 3 writes per client per 60 seconds', () => {
  describe('When one client makes reads', () => {
    it('Then the 30th passes and the 31st is rejected with a retry time', () => {
      const { limiter, clock } = setup();
      for (let i = 0; i < 30; i += 1) {
        expect(limiter.check('a', 'read')).toEqual({ allowed: true });
      }
      clock.tick(15_000);
      expect(limiter.check('a', 'read')).toEqual({ allowed: false, retryAfterMs: 45_000 });
    });
  });

  describe('When one client makes writes', () => {
    it('Then the 3rd passes and the 4th is rejected', () => {
      const { limiter } = setup();
      for (let i = 0; i < 3; i += 1) {
        expect(limiter.check('a', 'write').allowed).toBe(true);
      }
      expect(limiter.check('a', 'write')).toEqual({ allowed: false, retryAfterMs: 60_000 });
    });

    it('Then reads and writes are counted separately', () => {
      const { limiter } = setup();
      for (let i = 0; i < 3; i += 1) limiter.check('a', 'write');
      expect(limiter.check('a', 'read').allowed).toBe(true);
      for (let i = 0; i < 29; i += 1) limiter.check('a', 'read');
      expect(limiter.check('a', 'write').allowed).toBe(false);
    });
  });

  describe('When the 60-second window passes', () => {
    it('Then the counters reset exactly at the window end, not before', () => {
      const { limiter, clock } = setup();
      for (let i = 0; i < 3; i += 1) limiter.check('a', 'write');
      clock.tick(59_999);
      expect(limiter.check('a', 'write').allowed).toBe(false);
      clock.tick(1);
      expect(limiter.check('a', 'write').allowed).toBe(true);
    });
  });

  describe('When two clients call', () => {
    it('Then one client reaching its limit does not affect the other', () => {
      const { limiter } = setup();
      for (let i = 0; i < 3; i += 1) limiter.check('a', 'write');
      expect(limiter.check('a', 'write').allowed).toBe(false);
      expect(limiter.check('b', 'write').allowed).toBe(true);
    });
  });

  describe('When rejected calls keep coming', () => {
    it('Then they do not extend the window or use up later allowance', () => {
      const { limiter, clock } = setup();
      for (let i = 0; i < 3; i += 1) limiter.check('a', 'write');
      for (let i = 0; i < 50; i += 1) limiter.check('a', 'write');
      clock.tick(60_000);
      for (let i = 0; i < 3; i += 1) expect(limiter.check('a', 'write').allowed).toBe(true);
    });
  });

  describe('When clients go idle', () => {
    it('Then the sweep run by the scheduler drops entries whose window has passed', async () => {
      const { limiter, scheduler } = setup();
      limiter.check('a', 'read');
      limiter.check('b', 'read');
      expect(limiter.trackedClients).toBe(2);

      await scheduler.advance(59_000);
      expect(limiter.trackedClients).toBe(2);
      await scheduler.advance(61_000);
      expect(limiter.trackedClients).toBe(0);
    });

    it('Then a client with a live window survives the sweep', async () => {
      const { limiter, scheduler } = setup();
      await scheduler.advance(50_000);
      limiter.check('a', 'read');
      await scheduler.advance(10_000);
      expect(limiter.trackedClients).toBe(1);
    });

    it('Then stopping the limiter cancels the sweep', () => {
      const { limiter, scheduler } = setup();
      limiter.stop();
      expect(scheduler.pendingCount).toBe(0);
    });
  });
});
