import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './core/config.js';
import type { ClientError } from './core/errors.js';
import type { Clock, IdSource, Rng, Scheduler } from './core/ports.js';
import type { SimulatedJob } from './data/simulated-ci.js';
import type { UpgradePlan } from './tools/plan-dependency-upgrades.js';
import type { TriageReport } from './tools/triage-ci-failure.js';

/**
 * The documented walkthrough (FR9.1, FR9.2): shows the five outputs against the bundled
 * synthetic snapshots, offline and without a terminal, by calling the real tools through
 * the real guardrail wrapper. It writes its audit file into the folder it is given.
 */

export interface WalkthroughDeps {
  /** A folder for the walkthrough's own audit file and admin socket. */
  readonly directory: string;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly rng: Rng;
  readonly ids: IdSource;
  readonly print: (text: string) => void;
}

export interface AuditLine {
  readonly callId: string;
  readonly phase: string;
  readonly tool: string;
  readonly client: string;
  readonly outcome: string;
}

export interface WalkthroughResult {
  readonly plan: UpgradePlan;
  readonly triage: TriageReport;
  readonly refusedWrite: ClientError;
  readonly ciAfterRefusal: SimulatedJob;
  readonly rateLimited: ClientError;
  readonly auditLines: readonly AuditLine[];
}

const REPO = 'sample-node-api';
const JOB = { repo: REPO, jobId: 'job-1001-1' };

export async function runWalkthrough(deps: WalkthroughDeps): Promise<WalkthroughResult> {
  const { print } = deps;
  const auditPath = join(deps.directory, 'audit.jsonl');
  const app = await createApp({
    config: loadConfig({
      GUARDRAILS_AUDIT_PATH: auditPath,
      GUARDRAILS_SOCKET_DIR: join(deps.directory, 'run'),
    }),
    mode: 'stdio',
    clock: deps.clock,
    scheduler: deps.scheduler,
    ids: deps.ids,
    rng: deps.rng,
    logSink: () => undefined,
  });

  /** Calls a tool as the named agent and returns its data or its error. */
  type Outcome =
    | { readonly ok: true; readonly data: unknown }
    | { readonly ok: false; readonly error: ClientError };
  const call = async (client: string, tool: string, args: object): Promise<Outcome> => {
    const result = await app.wrapper.call({ name: client }, tool, args);
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
  };
  const data = async <T>(client: string, tool: string, args: object): Promise<T> => {
    const outcome = await call(client, tool, args);
    if (!outcome.ok) throw new Error(`${tool} failed: ${outcome.error.code}`);
    return outcome.data as T;
  };

  try {
    print('MCP developer-platform guardrails: walkthrough');
    print('Bundled data is synthetic. No network and no terminal are used.\n');

    // 1. Upgrade plan.
    print('1. Dependency-upgrade plan (plan_dependency_upgrades, read-only)');
    const plan = await data<UpgradePlan>('agent-plan', 'plan_dependency_upgrades', { repo: REPO });
    print(`   ${plan.outdatedCount} outdated, ${plan.upToDate} up to date. Recommended order:`);
    for (const upgrade of plan.upgrades) {
      print(
        `   ${upgrade.order}. ${upgrade.name.padEnd(20)} ${upgrade.current} -> ${upgrade.target}  ${upgrade.rating.padEnd(6)} ${upgrade.orderReason}`,
      );
      for (const advisory of upgrade.advisories) {
        print(`      fixes ${advisory.id} (${advisory.severity}), fixed in ${advisory.fixedIn}`);
      }
    }

    // 2. Triage.
    print('\n2. CI failure triage (triage_ci_failure, read-only)');
    const triage = await data<TriageReport>('agent-triage', 'triage_ci_failure', {
      repo: REPO,
      runId: 'run-1001',
    });
    print(
      `   run ${triage.runId}: ${triage.category}, failing step "${triage.failingStep}" in job "${triage.failingJob}"`,
    );
    for (const line of triage.excerpts) print(`   | ${line}`);
    print(`   suspected cause: ${triage.suspectedCause}`);
    print(`   next action:     ${triage.suggestedNextAction}`);
    print(`   earlier occurrences: ${triage.earlierOccurrencesSummary}`);

    // 3. Refused write.
    print('\n3. A write is refused without approval (rerun_ci_job)');
    const refused = await call('agent-write', 'rerun_ci_job', JOB);
    if (refused.ok) throw new Error('the write was not refused');
    print(`   ${refused.error.code}: ${refused.error.message}`);
    print(`   request reference: ${refused.error.requestId ?? '(none)'}`);
    const ciAfterRefusal = await data<SimulatedJob>('agent-write', 'get_ci_job', JOB);
    print(
      `   simulated CI after the refusal: job ${ciAfterRefusal.jobId} status ${ciAfterRefusal.status}, attempt ${ciAfterRefusal.attempt}`,
    );
    print(
      '   A person approves in a terminal with `npm run approve`; only then can the agent retry.',
    );

    // 4. Rate limit.
    print('\n4. A call is rate-limited (30 reads per minute per client)');
    let allowed = 0;
    let rateLimited: ClientError | undefined;
    for (let i = 0; i < 31; i += 1) {
      const outcome = await call('agent-flood', 'get_ci_job', JOB);
      if (!outcome.ok) rateLimited = outcome.error;
      else allowed += 1;
    }
    if (rateLimited === undefined) throw new Error('the 31st read was not rate-limited');
    print(
      `   ${allowed} reads were allowed; the next one: ${rateLimited.code}: ${rateLimited.message}`,
    );

    // 5. Audit.
    const auditLines = (await readFile(auditPath, 'utf8'))
      .split('\n')
      .filter((line) => line !== '');
    const parsed = auditLines.map((line) => JSON.parse(line) as AuditLine);
    print(
      `\n5. The audit record (${auditLines.length} lines, one call ID per call; file: ${auditPath})`,
    );
    const show = (predicate: (line: AuditLine) => boolean): void => {
      const index = parsed.findIndex(predicate);
      print(`   ${auditLines[index] ?? ''}`);
    };
    show((line) => line.tool === 'plan_dependency_upgrades');
    show((line) => line.tool === 'rerun_ci_job');
    show((line) => line.outcome === 'rate-limited');
    print('   Inputs are redacted before they are written, and a line is never rewritten.');

    return {
      plan,
      triage,
      refusedWrite: refused.error,
      ciAfterRefusal,
      rateLimited,
      auditLines: parsed,
    };
  } finally {
    await app.close();
  }
}
