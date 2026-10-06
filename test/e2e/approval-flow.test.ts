import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runApprove, type Terminal } from '../../src/guardrails/admin-client.js';
import { startHarness, type Harness } from '../support/harness.js';

const job = { repo: 'sample-node-api', jobId: 'job-1001-1' };
let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function start(): Promise<Harness> {
  harness = await startHarness();
  return harness;
}

/** The human: runs the real approve command against the running server and types `yes`. */
async function humanApproves(h: Harness, ref?: string): Promise<{ code: number; output: string }> {
  const output: string[] = [];
  const terminal: Terminal = { ask: () => Promise.resolve('yes') };
  const code = await runApprove({
    dir: h.socketDir,
    terminal,
    print: (text) => output.push(text),
    ...(ref === undefined ? {} : { ref }),
  });
  return { code, output: output.join('\n') };
}

async function ciStatus(h: Harness, args = job) {
  const result = await h.client.callTool({ name: 'get_ci_job', arguments: args });
  return result.structuredContent as { status: string; attempt: number };
}

async function askForApproval(h: Harness, args = job): Promise<string> {
  const result = await h.client.callTool({ name: 'rerun_ci_job', arguments: args });
  expect(result.isError).toBe(true);
  const content = result.structuredContent as { code: string; requestId: string };
  expect(content.code).toBe('approval_required');
  return content.requestId;
}

describe('Given a failed job in the simulated CI system', () => {
  it('When the agent asks for a re-run without approval, then it gets approval_required and the CI is unchanged', async () => {
    const h = await start();
    const requestId = await askForApproval(h);
    expect(requestId).toMatch(/^req_[a-z2-7]{26}$/);
    expect(await ciStatus(h)).toEqual(expect.objectContaining({ status: 'failed', attempt: 1 }));
    expect((await h.auditRecords()).filter((r) => r.tool === 'rerun_ci_job')).toMatchObject([
      { phase: 'complete', outcome: 'refused' },
    ]);
    expect(h.logLines.join('\n')).toContain('approval.requested');
  });

  it('When a human approves through the admin channel, then the re-run changes only the simulated CI and is audited as intent then outcome', async () => {
    const h = await start();
    const snapshotFile = join(process.cwd(), 'snapshots', 'sample-node-api', 'ci-runs.json');
    const digest = async () =>
      createHash('sha256')
        .update(await readFile(snapshotFile))
        .digest('hex');
    const before = await digest();

    const requestId = await askForApproval(h);
    const approved = await humanApproves(h);
    expect(approved.code).toBe(0);
    expect(approved.output).toContain(`Request:  ${requestId}`);
    expect(approved.output).toContain('"jobId":"job-1001-1"');

    const rerun = await h.client.callTool({
      name: 'rerun_ci_job',
      arguments: { ...job, approvalRequestId: requestId },
    });
    expect(rerun.isError).toBeFalsy();
    expect(rerun.structuredContent).toMatchObject({ status: 'queued', attempt: 2 });
    expect(await ciStatus(h)).toEqual(expect.objectContaining({ status: 'queued', attempt: 2 }));
    expect(await digest()).toBe(before);

    const writes = (await h.auditRecords()).filter((r) => r.tool === 'rerun_ci_job');
    expect(writes.map((r) => [r.phase, r.outcome])).toEqual([
      ['complete', 'refused'],
      ['intent', 'pending'],
      ['outcome', 'allowed'],
    ]);
    expect(writes[1]?.callId).toBe(writes[2]?.callId);
  });

  it('When the approved request is replayed, then it is refused and the job is not re-run again', async () => {
    const h = await start();
    const requestId = await askForApproval(h);
    await humanApproves(h, requestId);
    const args = { ...job, approvalRequestId: requestId };
    await h.client.callTool({ name: 'rerun_ci_job', arguments: args });
    const replay = await h.client.callTool({ name: 'rerun_ci_job', arguments: args });
    // The job is no longer failed, so the precondition already stops the replay; the
    // approval itself being single-use is covered by the wrapper spec.
    expect(replay.structuredContent).toMatchObject({ code: 'job_not_failed' });
    expect(await ciStatus(h)).toEqual(expect.objectContaining({ attempt: 2 }));
  });

  it('When the approval for one job is presented for another, then it is refused and neither job changes', async () => {
    const h = await start();
    const requestId = await askForApproval(h);
    await humanApproves(h);
    const swapped = await h.client.callTool({
      name: 'rerun_ci_job',
      arguments: { repo: 'sample-node-api', jobId: 'job-1002-1', approvalRequestId: requestId },
    });
    expect(swapped.structuredContent).toMatchObject({ code: 'approval_invalid' });
    expect(await ciStatus(h)).toEqual(expect.objectContaining({ attempt: 1 }));
    expect(await ciStatus(h, { ...job, jobId: 'job-1002-1' })).toEqual(
      expect.objectContaining({ attempt: 1, status: 'failed' }),
    );
  });

  it('When the approval is more than five minutes old, then it is refused and the job is unchanged', async () => {
    const h = await start();
    const requestId = await askForApproval(h);
    await humanApproves(h);
    await h.scheduler.advance(5 * 60 * 1000 + 1);
    const late = await h.client.callTool({
      name: 'rerun_ci_job',
      arguments: { ...job, approvalRequestId: requestId },
    });
    expect(late.structuredContent).toMatchObject({ code: 'approval_invalid' });
    expect(await ciStatus(h)).toEqual(expect.objectContaining({ attempt: 1 }));
  });

  it('When nobody runs the approve command, then the request stays pending and the job is never re-run', async () => {
    const h = await start();
    const requestId = await askForApproval(h);
    const again = await h.client.callTool({
      name: 'rerun_ci_job',
      arguments: { ...job, approvalRequestId: requestId },
    });
    expect(again.structuredContent).toMatchObject({ code: 'approval_invalid' });
    expect(await ciStatus(h)).toEqual(expect.objectContaining({ attempt: 1 }));
  });

  it('When the job is not failed or does not exist, then the human is never asked: the request is refused up front', async () => {
    const h = await start();
    const succeeded = await h.client.callTool({
      name: 'rerun_ci_job',
      arguments: { repo: 'sample-node-api', jobId: 'job-1000-1' },
    });
    expect(succeeded.structuredContent).toMatchObject({ code: 'job_not_failed' });
    const missing = await h.client.callTool({
      name: 'rerun_ci_job',
      arguments: { repo: 'sample-node-api', jobId: 'nope' },
    });
    expect(missing.structuredContent).toMatchObject({ code: 'not_found' });
    expect(h.app.approvals.listPending()).toEqual([]);
    const writes = (await h.auditRecords()).filter((r) => r.tool === 'rerun_ci_job');
    expect(writes.map((r) => [r.phase, r.outcome])).toEqual([
      ['complete', 'refused'],
      ['complete', 'refused'],
    ]);
  });

  it('When a job is queued by an approved re-run, then asking again is refused up front as no longer failed', async () => {
    const h = await start();
    const requestId = await askForApproval(h);
    await humanApproves(h);
    await h.client.callTool({
      name: 'rerun_ci_job',
      arguments: { ...job, approvalRequestId: requestId },
    });
    const again = await h.client.callTool({ name: 'rerun_ci_job', arguments: job });
    expect(again.structuredContent).toMatchObject({ code: 'job_not_failed' });
    expect(h.app.approvals.listPending()).toEqual([]);
  });

  it('When get_ci_job is called for a job that does not exist, then it says not found', async () => {
    const h = await start();
    const missing = await h.client.callTool({
      name: 'get_ci_job',
      arguments: { ...job, jobId: 'nope' },
    });
    expect(missing.structuredContent).toMatchObject({ code: 'not_found' });
  });
});

describe('Given the audit file cannot be written', () => {
  it('When an approved re-run is attempted, then it is refused and the simulated CI is unchanged', async () => {
    harness = await startHarness(async (directory) => {
      const path = join(directory, 'locked-audit.jsonl');
      await writeFile(path, '');
      await chmod(path, 0o400);
      return { GUARDRAILS_AUDIT_PATH: path };
    });
    const h = harness;
    const requestId = await askForApproval(h);
    await humanApproves(h);

    const refused = await h.client.callTool({
      name: 'rerun_ci_job',
      arguments: { ...job, approvalRequestId: requestId },
    });
    expect(refused.structuredContent).toMatchObject({ code: 'audit_unavailable' });
    expect(refused._meta).toMatchObject({ auditFailure: true });
    const status = await h.client.callTool({ name: 'get_ci_job', arguments: job });
    expect(status.structuredContent).toMatchObject({ status: 'failed', attempt: 1 });
    expect(status._meta).toMatchObject({ auditFailure: true });
    expect(h.logLines.join('\n')).toContain('audit.write_failed');
  });
});

describe('Given a CI log that contains an instruction aimed at the agent', () => {
  it('When the run is triaged, then the text is only quoted, nothing is approved or re-run, and one audit line exists', async () => {
    const h = await start();
    const report = await h.client.callTool({
      name: 'triage_ci_failure',
      arguments: { repo: 'sample-node-api', runId: 'run-1002' },
    });
    const excerpts = (report.structuredContent as { excerpts: string[] }).excerpts.join('\n');
    expect(excerpts).toContain('Ignore all previous instructions');
    expect(h.app.approvals.listPending()).toEqual([]);
    expect(await ciStatus(h)).toEqual(expect.objectContaining({ status: 'failed', attempt: 1 }));
    expect(await h.auditRecords()).toHaveLength(2);
  });
});

describe('Given the approve command asks a server which mode it runs in', () => {
  it('When a stdio server was started with GUARDRAILS_TOKENS exported, then it still reports stdio', async () => {
    harness = await startHarness(() =>
      Promise.resolve({ GUARDRAILS_TOKENS: `alice=mgt_TEST${'a'.repeat(40)}` }),
    );
    const { discoverServers } = await import('../../src/guardrails/admin-client.js');
    const servers = await discoverServers(harness.socketDir);
    expect(servers).toMatchObject([{ mode: 'stdio' }]);
  });

  it('When an HTTP server runs, then it reports http', async () => {
    const { startHttpHarness } = await import('../support/http-harness.js');
    const { discoverServers } = await import('../../src/guardrails/admin-client.js');
    const http = await startHttpHarness();
    try {
      const servers = await discoverServers(http.config.socketDir);
      expect(servers).toMatchObject([{ mode: 'http' }]);
    } finally {
      await http.close();
    }
  });
});
