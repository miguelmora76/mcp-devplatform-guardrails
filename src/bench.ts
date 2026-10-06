import { join } from 'node:path';
import { z } from 'zod';
import { createIdSource } from './core/identity.js';
import { createLogger } from './core/logger.js';
import type { Clock, Rng, Scheduler } from './core/ports.js';
import { createRedactor } from './core/redactor.js';
import { evaluateTargets, summarise, type Summary } from './core/stats.js';
import { defineTool } from './core/tool-types.js';
import { SimulatedCi, type SimulatedJob } from './data/simulated-ci.js';
import { SnapshotStore } from './data/snapshot-store.js';
import { ApprovalService } from './guardrails/approval.js';
import { AuditWriter, FileAuditSink } from './guardrails/audit.js';
import { RateLimiter } from './guardrails/rate-limiter.js';
import { GuardrailWrapper } from './guardrails/wrapper.js';
import { createGetCiJobTool, createRerunCiJobTool } from './tools/ci-jobs.js';
import { createPlanDependencyUpgradesTool } from './tools/plan-dependency-upgrades.js';
import { ToolRegistry } from './tools/registry.js';
import { createTriageCiFailureTool } from './tools/triage-ci-failure.js';

/**
 * The benchmark behind `npm run bench` (NFR8.1-NFR8.3). The real command passes real
 * timers; specs pass fake ports and a counting `now` with small call counts. It runs in
 * process through the real guardrail wrapper and a real audit file, against the bundled
 * snapshots only, and makes no network call.
 */

export interface BenchOptions {
  /** A scratch folder for the benchmark's own audit file. */
  readonly directory: string;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly rng: Rng;
  /** High-resolution milliseconds (performance.now in the real command). */
  readonly now: () => number;
  readonly readCalls: number;
  readonly writeIterations: number;
  readonly overheadCalls: number;
}

export interface BenchRow {
  readonly name: string;
  readonly kind: 'read' | 'overhead';
  readonly summary: Summary;
}

export async function runBench(options: BenchOptions): Promise<BenchRow[]> {
  const { clock, scheduler, rng, now } = options;
  const sink = await FileAuditSink.open(join(options.directory, 'audit.jsonl'));
  const redactor = createRedactor();
  const logger = createLogger({
    sink: () => undefined,
    clock: clock,
    redactor,
    level: 'error',
    component: 'Bench',
  });
  const ids = createIdSource(rng);
  const snapshots = new SnapshotStore();

  // Synthetic failed jobs so each timed re-run has something to re-run.
  const jobs: SimulatedJob[] = Array.from({ length: options.writeIterations }, (_, i) => ({
    repo: 'sample-node-api',
    jobId: `bench-job-${i}`,
    name: 'test',
    runId: 'run-bench',
    status: 'failed',
    attempt: 1,
  }));
  const ci = new SimulatedCi(jobs);
  const approvals = new ApprovalService({
    clock: clock,
    scheduler: scheduler,
    ids,
    logger,
  });
  const rateLimiter = new RateLimiter({ clock: clock, scheduler: scheduler });
  const noop = defineTool({
    name: 'noop',
    description: 'Does nothing; measures the guardrail overhead.',
    kind: 'read',
    shape: { n: z.number().int() },
    handler: () => Promise.resolve({}),
  });
  const wrapper = new GuardrailWrapper({
    registry: new ToolRegistry([
      createTriageCiFailureTool(snapshots),
      createPlanDependencyUpgradesTool(snapshots),
      createGetCiJobTool(ci),
      createRerunCiJobTool(ci),
      noop,
    ]),
    audit: new AuditWriter({ sink, clock: clock, redactor }),
    rateLimiter,
    approvals,
    ids,
    logger,
  });

  /** Times one call; every call uses its own client name so the rate limit never interferes. */
  let clientCounter = 0;
  const timed = async (tool: string, args: object, client?: string): Promise<number> => {
    const name = client ?? `bench-${(clientCounter += 1)}`;
    const start = now();
    const result = await wrapper.call({ name }, tool, args);
    const elapsed = now() - start;
    if (!result.ok && result.error.code !== 'approval_required') {
      throw new Error(`${tool} failed: ${result.error.code}`);
    }
    return elapsed;
  };
  const repeat = async (times: number, run: () => Promise<number>): Promise<number[]> => {
    const samples: number[] = [];
    for (let i = 0; i < times; i += 1) samples.push(await run());
    return samples;
  };

  const rows: { name: string; kind: 'read' | 'overhead'; summary: Summary }[] = [];
  const add = (name: string, kind: 'read' | 'overhead', samples: number[]): void => {
    rows.push({ name, kind, summary: summarise(samples) });
  };

  // Warm-up so the first cold read is not the only thing measured.
  await timed('noop', { n: 0 });
  await timed('triage_ci_failure', { repo: 'sample-node-api', runId: 'run-1001' });

  add(
    'triage_ci_failure (read)',
    'read',
    await repeat(options.readCalls, () =>
      timed('triage_ci_failure', { repo: 'sample-node-api', runId: 'run-1001' }),
    ),
  );
  add(
    'plan_dependency_upgrades (read)',
    'read',
    await repeat(options.readCalls, () =>
      timed('plan_dependency_upgrades', { repo: 'sample-node-api' }),
    ),
  );
  add(
    'get_ci_job (read)',
    'read',
    await repeat(options.readCalls, () =>
      timed('get_ci_job', { repo: 'sample-node-api', jobId: 'bench-job-0' }),
    ),
  );

  // Write path: request, (pre-issued) approval, approved execution. Each step is timed.
  const writeSamples: number[] = [];
  for (let i = 0; i < options.writeIterations; i += 1) {
    const client = `bench-writer-${i}`;
    const args = { repo: 'sample-node-api', jobId: `bench-job-${i}` };
    const requestStart = now();
    const asked = await wrapper.call({ name: client }, 'rerun_ci_job', args);
    writeSamples.push(now() - requestStart);
    if (asked.ok || asked.error.requestId === undefined)
      throw new Error('expected approval_required');
    approvals.approve(asked.error.requestId);
    writeSamples.push(
      await timed('rerun_ci_job', { ...args, approvalRequestId: asked.error.requestId }, client),
    );
  }
  add('rerun_ci_job (write path, 2 calls each)', 'read', writeSamples);

  add(
    'noop through the wrapper (guardrail overhead)',
    'overhead',
    await repeat(options.overheadCalls, () => timed('noop', { n: 1 })),
  );

  rateLimiter.stop();
  approvals.stop();
  await sink.close();
  return rows;
}

/** The printable report, and the targets that were missed (empty when all are met). */
export function formatReport(rows: readonly BenchRow[]): { text: string; misses: string[] } {
  const lines = [
    'Benchmark (real timers, bundled snapshots, no network)\n',
    `${'case'.padEnd(46)} ${'n'.padStart(5)} ${'p50 ms'.padStart(9)} ${'p95 ms'.padStart(9)} ${'max ms'.padStart(9)}`,
  ];
  const misses: string[] = [];
  for (const row of rows) {
    const { count, p50, p95, max } = row.summary;
    lines.push(
      `${row.name.padEnd(46)} ${String(count).padStart(5)} ${p50.toFixed(2).padStart(9)} ${p95.toFixed(2).padStart(9)} ${max.toFixed(2).padStart(9)}`,
    );
    for (const miss of evaluateTargets(row.kind, row.summary)) misses.push(`${row.name}: ${miss}`);
  }
  lines.push(
    '\nTargets: reads and writes p95 <= 1000 ms and max <= 5000 ms; guardrail overhead p95 <= 50 ms.',
  );
  return { text: lines.join('\n'), misses };
}
