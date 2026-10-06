import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdSource } from '../../src/core/identity.js';
import { runWalkthrough, type WalkthroughResult } from '../../src/walkthrough.js';
import { FakeClock, FakeRng, FakeScheduler } from '../support/fakes.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gr-walk-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function run(): Promise<{ result: WalkthroughResult; output: string }> {
  const clock = new FakeClock();
  const rng = new FakeRng();
  const lines: string[] = [];
  const result = await runWalkthrough({
    directory,
    clock,
    scheduler: new FakeScheduler(clock),
    rng,
    ids: createIdSource(rng),
    print: (text) => lines.push(text),
  });
  return { result, output: lines.join('\n') };
}

describe('Given the documented walkthrough, run offline and without a terminal', () => {
  it('When it runs, then it prints the five documented outputs in order', async () => {
    const { output } = await run();
    const headings = [
      '1. Dependency-upgrade plan',
      '2. CI failure triage',
      '3. A write is refused without approval',
      '4. A call is rate-limited',
      '5. The audit record',
    ].map((heading) => output.indexOf(heading));
    expect(headings.every((position) => position >= 0)).toBe(true);
    expect([...headings].sort((a, b) => a - b)).toEqual(headings);
  });

  it('When the upgrade plan is shown, then it lists the outdated dependencies with ratings and an order', async () => {
    const { result, output } = await run();
    expect(result.plan.outdatedCount).toBe(4);
    expect(output).toContain('sample-http-kit');
    expect(output).toMatch(/3\.2\.1 -> 3\.2\.4\s+patch/);
    expect(output).toContain('SYN-2026-0001');
  });

  it('When the triage is shown, then it names the category, failing step and quoted log lines', async () => {
    const { result, output } = await run();
    expect(result.triage).toMatchObject({ category: 'test_failure', failingStep: 'Run tests' });
    expect(output).toContain('AssertionError: expected 94.5 to be 90');
  });

  it('When the write is attempted, then it is refused for lack of approval and the simulated CI is unchanged', async () => {
    const { result, output } = await run();
    expect(result.refusedWrite).toMatchObject({ code: 'approval_required' });
    expect(result.ciAfterRefusal).toMatchObject({ status: 'failed', attempt: 1 });
    expect(output).toContain('approval_required');
    expect(output).toContain('status failed, attempt 1');
  });

  it('When a client calls too often, then the 31st read is rate-limited', async () => {
    const { result, output } = await run();
    expect(result.rateLimited).toMatchObject({ code: 'rate_limited' });
    expect(output).toContain('rate_limited');
    expect(output).toMatch(/30 reads were allowed/);
  });

  it('When the audit record is shown, then the refused write and the rate-limited call each have one line', async () => {
    const { result, output } = await run();
    expect(
      result.auditLines.some((l) => l.outcome === 'refused' && l.tool === 'rerun_ci_job'),
    ).toBe(true);
    expect(result.auditLines.some((l) => l.outcome === 'rate-limited')).toBe(true);
    expect(output).toContain('"outcome":"rate-limited"');
    const ids = result.auditLines.map((line) => line.callId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('When it has run, then it needed no network, no terminal and left only its own temp folder', async () => {
    // The suite's offline guard throws on any outside connection, so passing proves it.
    await run();
    expect((await readdir(directory)).sort()).toEqual(['audit.jsonl', 'run']);
  });
});
