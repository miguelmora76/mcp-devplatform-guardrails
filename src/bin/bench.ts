#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runBench, formatReport } from '../bench.js';
import { systemClock, systemRng, systemScheduler } from '../core/ports.js';

/**
 * `npm run bench`: runs the benchmark with REAL timers and exits with 1 when a target is
 * missed (locally). CI runs it as an informational job. It makes no network call.
 */
const directory = await mkdtemp(join(tmpdir(), 'gr-bench-'));
try {
  const rows = await runBench({
    directory,
    clock: systemClock,
    scheduler: systemScheduler,
    rng: systemRng,
    now: () => performance.now(),
    readCalls: 100,
    writeIterations: 100,
    overheadCalls: 1000,
  });
  const report = formatReport(rows);
  console.log(report.text);
  if (report.misses.length > 0) {
    console.error(`\nTARGETS MISSED:\n${report.misses.map((miss) => `  - ${miss}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('All targets met.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'bench failed');
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
