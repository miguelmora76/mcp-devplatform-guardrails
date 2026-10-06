import { describe, expect, it } from 'vitest';
import { FailedLoginQueue } from '../../src/transport/failed-login-queue.js';
import { FakeClock, FakeScheduler } from '../support/fakes.js';

function setup() {
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  return { scheduler, queue: new FailedLoginQueue(scheduler) };
}

describe('Given failed logins go through one serialised queue costing 200 ms each', () => {
  it('When one failure is queued, then it is answered after 200 ms', async () => {
    const { queue, scheduler } = setup();
    let done = false;
    void queue.fail().then(() => {
      done = true;
    });
    await scheduler.advance(199);
    expect(done).toBe(false);
    await scheduler.advance(1);
    expect(done).toBe(true);
  });

  it('When several failures arrive together, then they are served one every 200 ms, in order', async () => {
    const { queue, scheduler } = setup();
    const served: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      void queue.fail().then(() => served.push(i));
    }
    expect(queue.waiting).toBe(3);
    await scheduler.advance(200);
    expect(served).toEqual([0]);
    await scheduler.advance(400);
    expect(served).toEqual([0, 1, 2]);
    expect(queue.waiting).toBe(0);
  });

  it('When 20 failures wait, then the 21st is turned away at once and the others are still served', async () => {
    const { queue, scheduler } = setup();
    const outcomes: boolean[] = [];
    for (let i = 0; i < 21; i += 1) {
      void queue.fail().then((accepted) => outcomes.push(accepted));
    }
    await Promise.resolve();
    expect(outcomes).toEqual([false]);
    expect(queue.waiting).toBe(20);
    await scheduler.advance(20 * 200);
    expect(outcomes.filter(Boolean)).toHaveLength(20);
    expect(queue.waiting).toBe(0);
  });

  it('When the queue has drained, then new failures are accepted again', async () => {
    const { queue, scheduler } = setup();
    for (let i = 0; i < 20; i += 1) void queue.fail();
    await scheduler.advance(20 * 200);
    let accepted: boolean | undefined;
    void queue.fail().then((value) => {
      accepted = value;
    });
    await scheduler.advance(200);
    expect(accepted).toBe(true);
  });
});
