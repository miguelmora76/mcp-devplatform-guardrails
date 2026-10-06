import { afterEach, describe, expect, it } from 'vitest';
import { FakeNet, flushMicrotasks } from '../support/fakes.js';
import { startHarness, type Harness } from '../support/harness.js';

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const run = {
  id: 123,
  name: 'CI',
  head_branch: 'main',
  head_sha: 'abcdef1234567',
  created_at: '2026-10-01T10:00:00Z',
  conclusion: 'failure',
};
const jobs = {
  jobs: [
    {
      id: 9,
      name: 'test',
      conclusion: 'failure',
      steps: [
        { name: 'Install', conclusion: 'success' },
        { name: 'Run tests', conclusion: 'failure' },
      ],
    },
  ],
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function start(live: boolean, net: FakeNet): Promise<Harness> {
  harness = await startHarness(
    () => Promise.resolve<Record<string, string>>(live ? { GUARDRAILS_LIVE: '1' } : {}),
    {
      net,
    },
  );
  return harness;
}

/** Runs a tool call while moving fake time forward, so retries and timeouts can finish. */
async function callWithTime(h: Harness, args: Record<string, unknown>, name = 'triage_ci_failure') {
  let settled = false;
  const call = h.client.callTool({ name, arguments: args }).finally(() => {
    settled = true;
  });
  for (let i = 0; i < 400 && !settled; i += 1) {
    await h.scheduler.advance(250);
    await flushMicrotasks();
  }
  return call;
}

describe('Given live reading is off, which is the default', () => {
  it('When every tool is used, including with owner/name references, then no network request is made', async () => {
    const net = new FakeNet();
    const h = await start(false, net);
    const triage = await h.client.callTool({
      name: 'triage_ci_failure',
      arguments: { repo: 'octo/hello', runId: '123' },
    });
    const plan = await h.client.callTool({
      name: 'plan_dependency_upgrades',
      arguments: { repo: 'octo/hello' },
    });
    await h.client.callTool({
      name: 'triage_ci_failure',
      arguments: { repo: 'sample-node-api', runId: 'run-1001' },
    });
    await h.client.callTool({
      name: 'plan_dependency_upgrades',
      arguments: { repo: 'sample-cli-tool' },
    });
    await h.client.callTool({
      name: 'get_ci_job',
      arguments: { repo: 'sample-node-api', jobId: 'job-1001-1' },
    });
    expect(triage.structuredContent).toMatchObject({ code: 'not_found' });
    expect(plan.structuredContent).toMatchObject({ code: 'not_found' });
    expect(net.requests).toHaveLength(0);
  });
});

describe('Given live reading is switched on', () => {
  it('When a public run is triaged, then it is read without credentials and reported with a note that logs are unavailable', async () => {
    const net = new FakeNet();
    net.enqueue(json(run), json(jobs));
    const h = await start(true, net);
    const result = await callWithTime(h, { repo: 'octo/hello', runId: '123' });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      repo: 'octo/hello',
      runId: '123',
      category: 'unclassified',
      failingStep: 'Run tests',
      repeatedFailure: false,
    });
    expect((result.structuredContent as { suspectedCause: string }).suspectedCause).toMatch(
      /no log lines/,
    );
    expect(net.requests).toHaveLength(2);
    for (const request of net.requests) {
      expect(new Headers(request.init?.headers).has('authorization')).toBe(false);
    }
    expect(await h.auditRecords()).toMatchObject([
      { tool: 'triage_ci_failure', outcome: 'allowed' },
    ]);
  });

  it('When a repository is unknown to GitHub, then the defined not-found error is returned', async () => {
    const net = new FakeNet();
    net.enqueue(new Response('{}', { status: 404 }));
    const h = await start(true, net);
    const result = await callWithTime(h, { repo: 'octo/private-or-missing', runId: '1' });
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
  });

  it('When GitHub keeps failing, then a defined error is returned, nothing is written, and the server keeps serving', async () => {
    const net = new FakeNet();
    net.enqueue(
      new Response('{}', { status: 503 }),
      new Response('{}', { status: 503 }),
      new Response('{}', { status: 503 }),
      new Response('{}', { status: 503 }),
    );
    const h = await start(true, net);
    const failed = await callWithTime(h, { repo: 'octo/hello', runId: '123' });
    expect(failed.structuredContent).toMatchObject({ code: 'live_unavailable' });
    expect(h.app.approvals.listPending()).toEqual([]);
    expect(h.app.ci.snapshot().every((job) => job.attempt === 1)).toBe(true);
    const later = await h.client.callTool({
      name: 'triage_ci_failure',
      arguments: { repo: 'sample-node-api', runId: 'run-1001' },
    });
    expect(later.structuredContent).toMatchObject({ category: 'test_failure' });
  });

  it('When the run ID is not a number or the tool is upgrade planning, then no request is made', async () => {
    const net = new FakeNet();
    const h = await start(true, net);
    const bad = await h.client.callTool({
      name: 'triage_ci_failure',
      arguments: { repo: 'octo/hello', runId: 'abc' },
    });
    const plan = await h.client.callTool({
      name: 'plan_dependency_upgrades',
      arguments: { repo: 'octo/hello' },
    });
    expect(bad.structuredContent).toMatchObject({ code: 'invalid_input' });
    expect(plan.structuredContent).toMatchObject({ code: 'not_found' });
    expect(net.requests).toHaveLength(0);
  });
});
