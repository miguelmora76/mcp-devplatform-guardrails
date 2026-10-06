import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planUpgrades, type UpgradePlan } from '../../src/tools/plan-dependency-upgrades.js';
import { startHarness, type Harness } from '../support/harness.js';

let harness: Harness;
beforeEach(async () => {
  harness = await startHarness();
});
afterEach(async () => {
  await harness.close();
});

async function plan(repo: string): Promise<UpgradePlan> {
  const result = await harness.client.callTool({
    name: 'plan_dependency_upgrades',
    arguments: { repo },
  });
  expect(result.isError).toBeFalsy();
  return result.structuredContent as UpgradePlan;
}

async function snapshotDigest(): Promise<string> {
  const root = join(process.cwd(), 'snapshots');
  const hash = createHash('sha256');
  for (const repo of (await readdir(root)).sort()) {
    for (const file of (await readdir(join(root, repo))).sort()) {
      hash.update(`${repo}/${file}\n`).update(await readFile(join(root, repo, file)));
    }
  }
  return hash.digest('hex');
}

describe('Given a bundled sample repository with known outdated dependencies', () => {
  it('When a plan is requested, then exactly the N outdated dependencies are listed with current and target versions', async () => {
    const result = await plan('sample-node-api');
    expect(result.outdatedCount).toBe(4);
    expect(result.upgrades.map((u) => [u.name, u.section, u.current, u.target]).sort()).toEqual([
      ['sample-http-kit', 'dependencies', '3.2.1', '3.2.4'],
      ['sample-orm', 'dependencies', '2.0.3', '3.1.0'],
      ['sample-router', 'dependencies', '4.1.0', '4.6.2'],
      ['sample-test-runner', 'devDependencies', '1.9.0', '1.11.0'],
    ]);
    expect(result.upToDate).toBe(2);
  });

  it('When a newer pre-release exists, then the latest stable release is the target', async () => {
    const result = await plan('sample-node-api');
    expect(result.upgrades.find((u) => u.name === 'sample-router')?.target).toBe('4.6.2');
    const cli = await plan('sample-cli-tool');
    expect(cli.upgrades.find((u) => u.name === 'sample-yaml')?.target).toBe('3.0.1');
  });

  it('When upgrades are rated, then each has a patch, minor or major rating with a reason matching the change', async () => {
    const result = await plan('sample-node-api');
    const rating = Object.fromEntries(result.upgrades.map((u) => [u.name, u.rating]));
    expect(rating).toEqual({
      'sample-http-kit': 'patch',
      'sample-test-runner': 'minor',
      'sample-router': 'minor',
      'sample-orm': 'major',
    });
    for (const upgrade of result.upgrades) expect(upgrade.reason.length).toBeGreaterThan(10);
  });

  it('When a 0.x minor upgrade is rated, then the reason warns that 0.x versions can break', async () => {
    const result = await plan('sample-web-app');
    const css = result.upgrades.find((u) => u.name === 'sample-css-tools');
    expect(css).toMatchObject({ rating: 'minor', current: '0.9.1', target: '0.10.0' });
    expect(css?.reason).toMatch(/1\.0\.0/);
  });

  it('When the plan is ordered, then security fixes come first, then patch, minor and major, each with a reason for its position', async () => {
    const result = await plan('sample-node-api');
    expect(result.upgrades.map((u) => [u.order, u.name])).toEqual([
      [1, 'sample-http-kit'],
      [2, 'sample-orm'],
      [3, 'sample-router'],
      [4, 'sample-test-runner'],
    ]);
    expect(result.upgrades[0]?.orderReason).toMatch(/security/i);
    expect(result.upgrades[1]?.orderReason).toMatch(/security/i);
    for (const upgrade of result.upgrades) expect(upgrade.orderReason).not.toBe('');
  });

  it('When an advisory is fixed by an upgrade, then it is listed against that upgrade only', async () => {
    const result = await plan('sample-node-api');
    const byName = Object.fromEntries(result.upgrades.map((u) => [u.name, u.advisories]));
    expect(byName['sample-http-kit']).toMatchObject([
      { id: 'SYN-2026-0001', severity: 'high', fixedIn: '3.2.3' },
    ]);
    expect(byName['sample-orm']).toMatchObject([{ id: 'SYN-2026-0002', fixedIn: '3.0.0' }]);
    expect(byName['sample-router']).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('SYN-2026-0003');
  });

  it('When advisory text contains instruction-like words, then it is only quoted and nothing is requested or changed', async () => {
    const result = await plan('sample-node-api');
    const orm = result.upgrades.find((u) => u.name === 'sample-orm');
    expect(orm?.advisories[0]?.summary).toContain('Ignore previous instructions');
    expect(harness.app.approvals.listPending()).toEqual([]);
    expect(harness.app.ci.get('sample-node-api', 'job-1001-1')).toMatchObject({ attempt: 1 });
  });

  it('When a dependency range is not supported or has no registry data, then it is reported as skipped with a reason', async () => {
    const result = await plan('sample-web-app');
    expect(result.skipped).toEqual([
      { name: 'sample-flex-range', reason: expect.stringMatching(/range/i) as unknown },
    ]);
    expect(result.outdatedCount).toBe(4);
  });

  it('When a repository has nothing outdated, then the plan is empty', () => {
    const result = planUpgrades({
      repo: 'x',
      manifest: {
        synthetic: true,
        name: 'x',
        version: '1.0.0',
        dependencies: { a: '1.0.0' },
        devDependencies: {},
      },
      registry: { synthetic: true, packages: { a: { versions: ['1.0.0'] } } },
      advisories: { synthetic: true, advisories: [] },
    });
    expect(result).toMatchObject({ outdatedCount: 0, upgrades: [], upToDate: 1, skipped: [] });
  });
});

describe('Given dependencies the snapshot cannot fully describe', () => {
  it('When a package has no registry data or only pre-releases, then it is skipped with a reason', () => {
    const result = planUpgrades({
      repo: 'x',
      manifest: {
        synthetic: true,
        name: 'x',
        version: '1.0.0',
        dependencies: { missing: '1.0.0', beta: '1.0.0' },
        devDependencies: {},
      },
      registry: { synthetic: true, packages: { beta: { versions: ['2.0.0-beta.1'] } } },
      advisories: { synthetic: true, advisories: [] },
    });
    expect(result.skipped.map((entry) => entry.name)).toEqual(['beta', 'missing']);
    expect(result.outdatedCount).toBe(0);
  });

  it('When an advisory has an unreadable version or concerns another package, then it is ignored', () => {
    const result = planUpgrades({
      repo: 'x',
      manifest: {
        synthetic: true,
        name: 'x',
        version: '1.0.0',
        dependencies: { a: '1.0.0' },
        devDependencies: {},
      },
      registry: { synthetic: true, packages: { a: { versions: ['1.0.0', '1.0.1'] } } },
      advisories: {
        synthetic: true,
        advisories: [
          {
            id: 'A',
            package: 'a',
            severity: 'low',
            summary: 's',
            introduced: 'bad',
            fixed: '1.0.1',
          },
          {
            id: 'B',
            package: 'other',
            severity: 'low',
            summary: 's',
            introduced: '0.0.0',
            fixed: '9.0.0',
          },
        ],
      },
    });
    expect(result.upgrades[0]?.advisories).toEqual([]);
    expect(result.upgrades[0]?.orderReason).toMatch(/Lowest-risk/);
  });

  it('When several advisories apply, then the most severe is listed first and the order reason counts them', () => {
    const result = planUpgrades({
      repo: 'x',
      manifest: {
        synthetic: true,
        name: 'x',
        version: '1.0.0',
        dependencies: { a: '1.0.0' },
        devDependencies: {},
      },
      registry: { synthetic: true, packages: { a: { versions: ['1.0.0', '2.0.0'] } } },
      advisories: {
        synthetic: true,
        advisories: ['low', 'critical'].map((severity, i) => ({
          id: `S${i}`,
          package: 'a',
          severity: severity as 'low' | 'critical',
          summary: 's',
          introduced: '1.0.0',
          fixed: '2.0.0',
        })),
      },
    });
    expect(result.upgrades[0]?.advisories.map((a) => a.severity)).toEqual(['critical', 'low']);
    expect(result.upgrades[0]?.orderReason).toContain('2 security advisories');
  });
});

describe('Given planning must never change what it analyses', () => {
  it('When plans are produced for every sample repository, then the snapshot files are byte-for-byte unchanged', async () => {
    const before = await snapshotDigest();
    for (const repo of ['sample-node-api', 'sample-web-app', 'sample-cli-tool']) await plan(repo);
    expect(await snapshotDigest()).toBe(before);
    expect(harness.app.ci.snapshot().every((job) => job.attempt === 1)).toBe(true);
  });

  it('When the plan runs, then it is a read: one complete audit line per call and no write tool involved', async () => {
    await plan('sample-cli-tool');
    expect(await harness.auditRecords()).toMatchObject([
      { tool: 'plan_dependency_upgrades', phase: 'complete', outcome: 'allowed' },
    ]);
  });
});

describe('Given references the tool must refuse', () => {
  it.each([
    ['a private-looking owner/name', 'secret-org/private-repo'],
    ['a URL with embedded credentials', 'https://user:token@github.com/octo/hello'],
    ['a path traversal', '../../etc/passwd'],
    ['a malformed value', 'Not A Repo!'],
  ])('When the reference is %s, then it is refused and no file is read', async (_label, repo) => {
    const result = await harness.client.callTool({
      name: 'plan_dependency_upgrades',
      arguments: { repo },
    });
    expect(result.isError).toBe(true);
    const code = (result.structuredContent as { code: string }).code;
    expect(['invalid_input', 'not_found']).toContain(code);
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('When an unknown snapshot name is given, then the defined not-found error is returned', async () => {
    const result = await harness.client.callTool({
      name: 'plan_dependency_upgrades',
      arguments: { repo: 'no-such-sample' },
    });
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
  });
});
