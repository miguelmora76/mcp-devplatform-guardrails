import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatReport, runBench, type BenchRow } from '../src/bench.js';
import { FakeClock, FakeRng, FakeScheduler } from './support/fakes.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gr-benchspec-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('Given the benchmark runs with fake ports and a counting timer', () => {
  it('When it runs, then every documented case is measured with the requested number of calls', async () => {
    const clock = new FakeClock();
    let ticks = 0;
    const rows = await runBench({
      directory,
      clock,
      scheduler: new FakeScheduler(clock),
      rng: new FakeRng(),
      now: () => (ticks += 1),
      readCalls: 4,
      writeIterations: 3,
      overheadCalls: 10,
    });
    expect(rows.map((row) => [row.name, row.summary.count])).toEqual([
      ['triage_ci_failure (read)', 4],
      ['plan_dependency_upgrades (read)', 4],
      ['get_ci_job (read)', 4],
      ['rerun_ci_job (write path, 2 calls each)', 6],
      ['noop through the wrapper (guardrail overhead)', 10],
    ]);
    // The counting timer advances by one per reading, so each call "takes" 1 ms.
    expect(rows.every((row) => row.summary.p95 === 1)).toBe(true);
  });
});

describe('Given benchmark results', () => {
  const row = (name: string, kind: BenchRow['kind'], p95: number, max: number): BenchRow => ({
    name,
    kind,
    summary: { count: 10, p50: 1, p95, max },
  });

  it('When every target is met, then the report lists the cases and no misses', () => {
    const { text, misses } = formatReport([row('a', 'read', 2, 3), row('b', 'overhead', 1, 2)]);
    expect(misses).toEqual([]);
    expect(text).toContain('a');
    expect(text).toContain('Targets: reads and writes p95 <= 1000 ms');
  });

  it('When a target is missed, then the miss names the case', () => {
    const { misses } = formatReport([
      row('slow read', 'read', 1500, 6000),
      row('b', 'overhead', 60, 70),
    ]);
    expect(misses).toHaveLength(3);
    expect(misses[0]).toContain('slow read');
  });
});
