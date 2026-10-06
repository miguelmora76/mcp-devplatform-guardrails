import { describe, expect, it } from 'vitest';
import { GuardrailError } from '../../src/core/errors.js';
import { loadSimulatedCi, SimulatedCi } from '../../src/data/simulated-ci.js';
import { SnapshotStore } from '../../src/data/snapshot-store.js';

describe('Given the simulated CI system built from the bundled snapshots', () => {
  const load = () => loadSimulatedCi(new SnapshotStore());

  it('When it is loaded, then every snapshot job is present with its starting status and first attempt', async () => {
    const ci = await load();
    expect(ci.get('sample-node-api', 'job-1001-1')).toEqual({
      repo: 'sample-node-api',
      jobId: 'job-1001-1',
      name: 'test',
      runId: 'run-1001',
      status: 'failed',
      attempt: 1,
    });
    expect(ci.get('sample-node-api', 'job-1000-1')?.status).toBe('success');
  });

  it('When a failed job is re-run, then it is queued as the next attempt and only that job changes', async () => {
    const ci = await load();
    const before = ci.snapshot();
    const job = ci.rerun('sample-node-api', 'job-1001-1');
    expect(job).toMatchObject({ status: 'queued', attempt: 2 });
    const after = ci.snapshot();
    expect(after.filter((j, i) => JSON.stringify(j) !== JSON.stringify(before[i]))).toEqual([job]);
  });

  it('When the same job is re-run again, then it is refused because it is no longer failed', async () => {
    const ci = await load();
    ci.rerun('sample-node-api', 'job-1001-1');
    expect(() => ci.rerun('sample-node-api', 'job-1001-1')).toThrow(GuardrailError);
  });

  it('When a successful job is re-run, then it is refused with a defined error and nothing changes', async () => {
    const ci = await load();
    const before = JSON.stringify(ci.snapshot());
    expect(() => ci.rerun('sample-node-api', 'job-1000-1')).toThrow(/failed job/);
    expect(JSON.stringify(ci.snapshot())).toBe(before);
  });

  it('When a job does not exist, then reading and re-running both say not found', async () => {
    const ci = await load();
    expect(ci.get('sample-node-api', 'nope')).toBeUndefined();
    expect(() => ci.rerun('sample-node-api', 'nope')).toThrow(/not found/i);
  });

  it('When the precondition is checked, then it passes only for an existing failed job and changes nothing', async () => {
    const ci = await load();
    const before = JSON.stringify(ci.snapshot());
    expect(() => {
      ci.assertRerunnable('sample-node-api', 'job-1001-1');
    }).not.toThrow();
    expect(() => {
      ci.assertRerunnable('sample-node-api', 'job-1000-1');
    }).toThrow(/failed job/);
    expect(() => {
      ci.assertRerunnable('sample-node-api', 'nope');
    }).toThrow(/not found/i);
    expect(JSON.stringify(ci.snapshot())).toBe(before);
  });

  it('When a copy returned by get is changed, then the system itself is unchanged', async () => {
    const ci = await load();
    const copy = ci.get('sample-node-api', 'job-1001-1');
    if (copy === undefined) throw new Error('job missing');
    (copy as { status: string }).status = 'success';
    expect(ci.get('sample-node-api', 'job-1001-1')?.status).toBe('failed');
  });

  it('When it is built empty, then it has no jobs', () => {
    expect(new SimulatedCi([]).snapshot()).toEqual([]);
  });
});
