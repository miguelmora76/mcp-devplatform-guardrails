import { describe, expect, it } from 'vitest';
import { FakeClock, FakeScheduler } from './support/fakes.js';

describe('Given the test runner is configured', () => {
  it('When a fake clock is advanced by the fake scheduler, then due timers fire in order', async () => {
    const clock = new FakeClock(1_000);
    const scheduler = new FakeScheduler(clock);
    const fired: string[] = [];
    scheduler.after(200, () => fired.push('second'));
    scheduler.after(100, () => fired.push('first'));

    await scheduler.advance(150);
    expect(fired).toEqual(['first']);
    expect(clock.now()).toBe(1_150);

    await scheduler.advance(100);
    expect(fired).toEqual(['first', 'second']);
  });

  it('When code opens a connection to a non-local address, then the offline guard throws', async () => {
    const net = await import('node:net');
    expect(() => net.connect({ host: '203.0.113.7', port: 80 })).toThrow(/Offline guard/);
  });

  it('When code calls the global fetch, then the offline guard throws', () => {
    // eslint-disable-next-line no-restricted-globals
    expect(() => fetch('https://example.invalid/')).toThrow(/Offline guard/);
  });
});
