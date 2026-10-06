import { describe, expect, it } from 'vitest';
import { evaluateTargets, percentile, summarise, TARGETS } from '../../src/core/stats.js';

describe('Given a list of timings in milliseconds', () => {
  const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

  it('When the 95th percentile is taken, then it is the nearest-rank value', () => {
    expect(percentile(samples, 95)).toBe(95);
    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 100)).toBe(100);
  });

  it('When the samples are unsorted, then the result is the same', () => {
    expect(percentile([...samples].reverse(), 95)).toBe(95);
  });

  it('When there are no samples, then the percentile is refused', () => {
    expect(() => percentile([], 95)).toThrow(/no samples/);
  });

  it('When samples are summarised, then count, p50, p95 and max are reported', () => {
    expect(summarise(samples)).toEqual({ count: 100, p50: 50, p95: 95, max: 100 });
  });
});

describe('Given the performance targets', () => {
  it('When reads are within p95 1 s and max 5 s, then the read targets pass', () => {
    const result = evaluateTargets('read', { count: 100, p50: 5, p95: 1000, max: 5000 });
    expect(result).toEqual([]);
  });

  it('When p95 is just over 1 s or the max is just over 5 s, then each miss is reported', () => {
    const misses = evaluateTargets('read', { count: 100, p50: 5, p95: 1000.1, max: 5000.1 });
    expect(misses).toHaveLength(2);
    expect(misses[0]).toMatch(/p95/);
    expect(misses[1]).toMatch(/max/);
  });

  it('When guardrail overhead p95 is over 50 ms, then it is reported; at 50 ms it passes', () => {
    expect(evaluateTargets('overhead', { count: 1000, p50: 1, p95: 50, max: 90 })).toEqual([]);
    expect(evaluateTargets('overhead', { count: 1000, p50: 1, p95: 50.5, max: 90 })).toHaveLength(
      1,
    );
  });

  it('When the targets are read, then they are the documented ones', () => {
    expect(TARGETS).toEqual({ readP95Ms: 1000, maxMs: 5000, overheadP95Ms: 50 });
  });
});
