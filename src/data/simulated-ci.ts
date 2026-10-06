import { GuardrailError } from '../core/errors.js';
import { ciRunsDocumentSchema } from './ci-data.js';
import { SNAPSHOT_NAMES, type SnapshotStore } from './snapshot-store.js';

/**
 * Simulated CI (LC-15): an in-process stand-in for a CI system. It is the only state a
 * write can change; nothing here, or anywhere else, touches real GitHub or a real CI
 * service (FR4.1). It starts from the bundled snapshots on every run and keeps nothing
 * on disk.
 */

export type JobStatus = 'failed' | 'success' | 'queued';

export interface SimulatedJob {
  readonly repo: string;
  readonly jobId: string;
  readonly name: string;
  readonly runId: string;
  readonly status: JobStatus;
  /** Starts at 1; each re-run adds one. */
  readonly attempt: number;
}

export class SimulatedCi {
  private readonly jobs = new Map<string, SimulatedJob>();

  constructor(initial: readonly SimulatedJob[]) {
    for (const job of initial) this.jobs.set(key(job.repo, job.jobId), { ...job });
  }

  /** A copy of the job, or undefined. */
  get(repo: string, jobId: string): SimulatedJob | undefined {
    const job = this.jobs.get(key(repo, jobId));
    return job === undefined ? undefined : { ...job };
  }

  /** Throws a defined error unless the job exists and has failed. Changes nothing. */
  assertRerunnable(repo: string, jobId: string): SimulatedJob {
    const job = this.jobs.get(key(repo, jobId));
    if (job === undefined) throw new GuardrailError('not_found', 'The job was not found.');
    if (job.status !== 'failed') throw new GuardrailError('job_not_failed');
    return job;
  }

  /** Queues a new attempt of a failed job. */
  rerun(repo: string, jobId: string): SimulatedJob {
    const job = this.assertRerunnable(repo, jobId);
    const next: SimulatedJob = { ...job, status: 'queued', attempt: job.attempt + 1 };
    this.jobs.set(key(repo, jobId), next);
    return { ...next };
  }

  /** A copy of every job, for tests and the walkthrough. */
  snapshot(): SimulatedJob[] {
    return [...this.jobs.values()].map((job) => ({ ...job }));
  }
}

function key(repo: string, jobId: string): string {
  return `${repo}/${jobId}`;
}

/** Builds the starting state from every bundled snapshot's CI runs. */
export async function loadSimulatedCi(store: SnapshotStore): Promise<SimulatedCi> {
  const jobs: SimulatedJob[] = [];
  for (const repo of SNAPSHOT_NAMES) {
    const document = await store.readJson(repo, 'ci-runs.json', ciRunsDocumentSchema);
    for (const run of document.runs) {
      for (const job of run.jobs) {
        jobs.push({
          repo,
          jobId: job.jobId,
          name: job.name,
          runId: run.runId,
          status: job.conclusion === 'failure' ? 'failed' : 'success',
          attempt: 1,
        });
      }
    }
  }
  return new SimulatedCi(jobs);
}
