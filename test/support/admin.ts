import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../src/core/logger.js';
import { createRedactor } from '../../src/core/redactor.js';
import { AdminChannel, type AdminChannelOptions } from '../../src/guardrails/admin-channel.js';
import { ApprovalService } from '../../src/guardrails/approval.js';
import { FakeClock, FakeIdSource, FakeScheduler } from './fakes.js';

/** An approval service plus admin channel in a short temp directory (socket paths are length-limited). */
export interface AdminFixture {
  readonly dir: string;
  readonly root: string;
  readonly clock: FakeClock;
  readonly approvals: ApprovalService;
  readonly logLines: string[];
  channel(overrides?: Partial<AdminChannelOptions>): AdminChannel;
  cleanup(): Promise<void>;
}

export async function createAdminFixture(): Promise<AdminFixture> {
  const root = await mkdtemp(join(tmpdir(), 'gr-adm-'));
  const dir = join(root, 'run');
  const clock = new FakeClock(Date.UTC(2026, 9, 5, 12, 0, 0));
  const scheduler = new FakeScheduler(clock);
  const logLines: string[] = [];
  const logger = createLogger({
    sink: (line) => logLines.push(line),
    clock,
    redactor: createRedactor(),
    level: 'debug',
    component: 'Test',
  });
  const approvals = new ApprovalService({ clock, scheduler, ids: new FakeIdSource(), logger });
  const started: AdminChannel[] = [];
  return {
    dir,
    root,
    clock,
    approvals,
    logLines,
    channel(overrides = {}) {
      const channel = new AdminChannel({
        dir,
        approvals,
        logger,
        clock,
        info: { mode: 'stdio', auditPath: '/tmp/audit.jsonl' },
        ...overrides,
      });
      started.push(channel);
      return channel;
    },
    async cleanup() {
      for (const channel of started) await channel.stop();
      approvals.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}
