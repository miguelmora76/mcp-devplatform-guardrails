import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';

/**
 * Walking skeleton [FR2.1, FR2.2, FR6.1, FR8.1; LC-01, LC-04]: one real MCP client talks
 * over the real stdio framing to the real wrapper, tool, snapshot store and audit file.
 * Later slices harden each piece; this spec stays as the end-to-end regression.
 */
describe('Given a running server with a bundled failed-run snapshot', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('When the client lists tools, then triage_ci_failure is offered', async () => {
    const { tools } = await harness.client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('triage_ci_failure');
  });

  describe('When the client calls triage_ci_failure for a failed run', () => {
    const args = { repo: 'sample-node-api', runId: 'run-1001' };

    it('Then the report names a category and the failing step', async () => {
      const result = await harness.client.callTool({ name: 'triage_ci_failure', arguments: args });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        repo: 'sample-node-api',
        runId: 'run-1001',
        category: 'test_failure',
        failingJob: 'test',
        failingJobId: 'job-1001-1',
        failingStep: 'Run tests',
      });
      const report = result.structuredContent as { excerpts: string[]; suspectedCause: string };
      expect(report.excerpts.join('\n')).toContain('AssertionError');
      expect(report.suspectedCause).not.toBe('');
    });

    it('Then exactly one audit line exists for the call, with the documented fields', async () => {
      const result = await harness.client.callTool({ name: 'triage_ci_failure', arguments: args });

      const records = await harness.auditRecords();
      expect(records).toHaveLength(1);
      const [record] = records;
      expect(record).toEqual({
        ts: new Date(harness.clock.now()).toISOString(),
        callId: 'call_aaaaaaaaaaaaaaaaaaaaaaaaab',
        phase: 'complete',
        tool: 'triage_ci_failure',
        client: 'sess_aaaaaaaaaaaaaaaaaaaaaaaaab',
        inputs: args,
        outcome: 'allowed',
      });
      expect(result._meta).toMatchObject({ callId: 'call_aaaaaaaaaaaaaaaaaaaaaaaaab' });
    });

    it('Then standard output carries protocol messages only and no log line', async () => {
      await harness.client.callTool({ name: 'triage_ci_failure', arguments: args });

      for (const chunk of harness.stdout) {
        for (const line of chunk.split('\n').filter((l) => l !== '')) {
          expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0');
        }
      }
    });
  });

  describe('When the client sends input the tool does not accept', () => {
    it('Then the call is refused as invalid, one audit line records it, and the handler is not reached', async () => {
      const result = await harness.client.callTool({
        name: 'triage_ci_failure',
        arguments: { repo: 'sample-node-api', runId: 'run-1001', extra: 'x' },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code: 'invalid_input' });
      const records = await harness.auditRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ outcome: 'invalid', phase: 'complete' });
    });
  });
});
