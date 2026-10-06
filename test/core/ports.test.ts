import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  disabledNet,
  systemClock,
  systemNet,
  systemRng,
  systemScheduler,
} from '../../src/core/ports.js';
import { FakeClock, FakeRng, FakeScheduler } from '../support/fakes.js';

describe('Given the injected ports', () => {
  describe('And the fake clock, scheduler and randomness used by every other spec', () => {
    it('When the scheduler is advanced, then periodic timers fire once per period and can be cancelled', async () => {
      const clock = new FakeClock(0);
      const scheduler = new FakeScheduler(clock);
      let sweeps = 0;
      const handle = scheduler.every(60_000, () => {
        sweeps += 1;
      });

      await scheduler.advance(180_000);
      expect(sweeps).toBe(3);

      handle.cancel();
      await scheduler.advance(120_000);
      expect(sweeps).toBe(3);
    });

    it('When a delay is awaited, then it resolves only when the fake clock reaches it', async () => {
      const clock = new FakeClock(0);
      const scheduler = new FakeScheduler(clock);
      let resolved = false;
      void scheduler.delay(200).then(() => {
        resolved = true;
      });

      await scheduler.advance(199);
      expect(resolved).toBe(false);
      await scheduler.advance(1);
      expect(resolved).toBe(true);
    });

    it('When two fake random sources are built, then they produce identical sequences', () => {
      const a = new FakeRng();
      const b = new FakeRng();
      expect(Array.from(a.bytes(4))).toEqual(Array.from(b.bytes(4)));
      expect(a.float()).toBe(b.float());
    });
  });

  // The adapters below are the one place real time, randomness and timers are allowed
  // (src/core/ports.ts), so this is the one spec that touches them. Nothing here sleeps
  // for a meaningful time: timers are cancelled or use a zero delay.
  describe('And the real adapters used only by the running server', () => {
    it('When the system clock and randomness are read, then they return plausible values', () => {
      expect(systemClock.now()).toBeGreaterThan(Date.UTC(2026, 0, 1));
      expect(systemRng.bytes(16)).toHaveLength(16);
      const value = systemRng.float();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it('When a system timer is scheduled and cancelled, then its callback never runs', async () => {
      let ran = false;
      systemScheduler
        .after(0, () => {
          ran = true;
        })
        .cancel();
      systemScheduler
        .every(1_000_000, () => {
          ran = true;
        })
        .cancel();
      await systemScheduler.delay(0);
      expect(ran).toBe(false);
    });

    it('When a system timer is left to fire, then its callback runs once', async () => {
      await new Promise<void>((resolve) => {
        systemScheduler.after(0, resolve);
      });
    });

    it('When the network is used without live mode, then the disabled port refuses', async () => {
      await expect(disabledNet.fetch('https://api.github.com/')).rejects.toThrow(/disabled/);
    });

    it('When the system network port is used inside the suite, then the offline guard blocks it', () => {
      expect(() => systemNet.fetch('https://api.github.com/')).toThrow(/Offline guard/);
    });
  });

  describe('And the lint rules that keep time and randomness inside the ports', () => {
    const eslint = new ESLint();
    const violations = [
      'export const a = Date.now();',
      'export const b = Math.random();',
      'export const c = new Date();',
      'export const d = setTimeout(() => undefined, 1);',
      "export const e = fetch('https://example.invalid/');",
    ];

    it.each(violations)(
      'When ordinary code contains %s, then lint reports a port violation',
      async (source) => {
        const [result] = await eslint.lintText(source, { filePath: 'src/core/config.ts' });
        const ruleIds = result?.messages.map((message) => message.ruleId) ?? [];
        expect(ruleIds.some((id) => id !== null && id.startsWith('no-restricted-'))).toBe(true);
      },
      60_000,
    );

    it('When the ports module contains the same calls, then lint allows them', async () => {
      const [result] = await eslint.lintText(violations.join('\n'), {
        filePath: 'src/core/ports.ts',
      });
      const restricted = result?.messages.filter((m) => m.ruleId?.startsWith('no-restricted-'));
      expect(restricted).toEqual([]);
    }, 60_000);
  });
});
