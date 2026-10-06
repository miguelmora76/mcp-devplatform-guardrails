import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';

let harness: Harness;
beforeEach(async () => {
  harness = await startHarness();
});
afterEach(async () => {
  await harness.close();
});

describe('Given the CI tools are offered to the agent', () => {
  it('When the tools are listed, then get_ci_job is read-only and rerun_ci_job is the only state-changing tool', async () => {
    const { tools } = await harness.client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(byName.get_ci_job?.annotations?.readOnlyHint).toBe(true);
    expect(byName.rerun_ci_job?.annotations?.readOnlyHint).toBe(false);
    expect(tools.filter((tool) => tool.annotations?.readOnlyHint === false)).toHaveLength(1);
    expect(JSON.stringify(byName.rerun_ci_job?.inputSchema)).toContain('approvalRequestId');
  });

  it('When get_ci_job is called for a known job, then it reports status and attempt without changing anything', async () => {
    const result = await harness.client.callTool({
      name: 'get_ci_job',
      arguments: { repo: 'sample-node-api', jobId: 'job-1001-1' },
    });
    expect(result.structuredContent).toMatchObject({
      status: 'failed',
      attempt: 1,
      runId: 'run-1001',
    });
  });

  it('When rerun_ci_job is called with an unknown field or a control character, then it is refused as invalid', async () => {
    const extra = await harness.client.callTool({
      name: 'rerun_ci_job',
      arguments: { repo: 'sample-node-api', jobId: 'job-1001-1', force: true },
    });
    const control = await harness.client.callTool({
      name: 'rerun_ci_job',
      arguments: { repo: 'sample-node-api', jobId: 'job\u001b[2J' },
    });
    expect(extra.structuredContent).toMatchObject({ code: 'invalid_input' });
    expect(control.structuredContent).toMatchObject({ code: 'invalid_input' });
    expect(harness.app.approvals.listPending()).toEqual([]);
  });
});
