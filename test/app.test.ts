import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/core/config.js';
import { AuditLockedError } from '../src/guardrails/audit.js';
import { FakeClock, FakeIdSource, FakeRng, FakeScheduler } from './support/fakes.js';

let directory: string;
const apps: App[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gr-app-'));
});
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  await rm(directory, { recursive: true, force: true });
});

function build(
  overrides: { pid?: number; isAlive?: (pid: number) => boolean; tokens?: string } = {},
) {
  const clock = new FakeClock();
  return createApp({
    mode: 'stdio',
    config: loadConfig({
      GUARDRAILS_AUDIT_PATH: join(directory, 'audit.jsonl'),
      GUARDRAILS_SOCKET_DIR: join(directory, 'run'),
      ...(overrides.tokens === undefined ? {} : { GUARDRAILS_TOKENS: overrides.tokens }),
    }),
    clock,
    scheduler: new FakeScheduler(clock),
    ids: new FakeIdSource(),
    rng: new FakeRng(),
    logSink: () => undefined,
    ...(overrides.pid === undefined ? {} : { pid: overrides.pid }),
    ...(overrides.isAlive === undefined ? {} : { isAlive: overrides.isAlive }),
  });
}

describe('Given the server is composed from configuration', () => {
  it('When a second server starts on the same audit file while the first is alive, then startup is refused', async () => {
    apps.push(await build({ pid: 9001, isAlive: () => true }));
    await expect(build({ pid: 9002, isAlive: () => true })).rejects.toBeInstanceOf(
      AuditLockedError,
    );
  });

  it('When the server is composed, then the tools, wrapper and CI are all present', async () => {
    const app = await build();
    apps.push(app);
    expect(
      app.registry
        .list()
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['get_ci_job', 'plan_dependency_upgrades', 'rerun_ci_job', 'triage_ci_failure']);
  });
});
