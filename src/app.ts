import type { Config } from './core/config.js';
import { createLogger, type Logger } from './core/logger.js';
import {
  systemNet,
  type Clock,
  type IdSource,
  type Net,
  type Rng,
  type Scheduler,
} from './core/ports.js';
import { createRedactor } from './core/redactor.js';
import { LiveGitHubReader } from './data/live-github.js';
import { loadSimulatedCi, type SimulatedCi } from './data/simulated-ci.js';
import { SnapshotStore } from './data/snapshot-store.js';
import { AdminChannel } from './guardrails/admin-channel.js';
import { ApprovalService } from './guardrails/approval.js';
import {
  AuditUnavailableError,
  AuditWriter,
  FileAuditSink,
  UnavailableAuditSink,
  type AuditSink,
} from './guardrails/audit.js';
import { RateLimiter } from './guardrails/rate-limiter.js';
import { GuardrailWrapper } from './guardrails/wrapper.js';
import { createGetCiJobTool, createRerunCiJobTool } from './tools/ci-jobs.js';
import { ToolRegistry } from './tools/registry.js';
import { createPlanDependencyUpgradesTool } from './tools/plan-dependency-upgrades.js';
import { createTriageCiFailureTool } from './tools/triage-ci-failure.js';

/**
 * Composition root: builds the tools, the audit writer, the rate limiter, the approval
 * service and the single guardrail wrapper from configuration and injected ports. The
 * real server and the specs both start here, so what the specs exercise is what runs.
 */

export interface AppDeps {
  readonly config: Config;
  /** How agents reach the server; shown by the `approve` command. */
  readonly mode: 'stdio' | 'http';
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly ids: IdSource;
  readonly rng: Rng;
  /** Network port; defaults to the real network in live mode and a refusing stub otherwise. */
  readonly net?: Net;
  /** Receives one operational-log line (standard error in the real server). */
  readonly logSink: (line: string) => void;
  /** Directory of bundled snapshots; defaults to the project's `snapshots/`. */
  readonly snapshotRoot?: string;
  /** Test seam: process liveness check for the audit lock and admin sockets. */
  readonly isAlive?: (pid: number) => boolean;
  /** Test seam: process ID used for the audit lock and the admin socket name. */
  readonly pid?: number;
}

export interface App {
  readonly registry: ToolRegistry;
  readonly wrapper: GuardrailWrapper;
  readonly approvals: ApprovalService;
  readonly ci: SimulatedCi;
  readonly adminChannel: AdminChannel;
  readonly ids: IdSource;
  readonly logger: Logger;
  close(): Promise<void>;
}

export async function createApp(deps: AppDeps): Promise<App> {
  const redactor = createRedactor({ secrets: deps.config.tokens.map((entry) => entry.token) });
  const logger = createLogger({
    sink: deps.logSink,
    clock: deps.clock,
    redactor,
    level: deps.config.logLevel,
    component: 'Server',
  });

  const sink = await openAuditSink(deps, logger);
  const audit = new AuditWriter({ sink, clock: deps.clock, redactor });
  const rateLimiter = new RateLimiter({ clock: deps.clock, scheduler: deps.scheduler });
  const approvals = new ApprovalService({
    clock: deps.clock,
    scheduler: deps.scheduler,
    ids: deps.ids,
    logger: logger.forComponent('ApprovalService'),
  });
  const snapshots = new SnapshotStore(deps.snapshotRoot);
  const ci = await loadSimulatedCi(snapshots);
  // Live reading exists only when switched on; otherwise no tool has a reader to call.
  const live = deps.config.liveMode
    ? new LiveGitHubReader({
        net: deps.net ?? systemNet,
        scheduler: deps.scheduler,
        clock: deps.clock,
        rng: deps.rng,
        logger: logger.forComponent('LiveGitHubReader'),
      })
    : undefined;
  const registry = new ToolRegistry([
    createPlanDependencyUpgradesTool(snapshots),
    createTriageCiFailureTool(snapshots, live),
    createGetCiJobTool(ci),
    createRerunCiJobTool(ci),
  ]);
  const wrapper = new GuardrailWrapper({
    registry,
    audit,
    rateLimiter,
    approvals,
    ids: deps.ids,
    logger: logger.forComponent('GuardrailWrapper'),
  });
  const adminChannel = new AdminChannel({
    dir: deps.config.socketDir,
    approvals,
    logger: logger.forComponent('AdminChannel'),
    clock: deps.clock,
    info: {
      mode: deps.mode,
      auditPath: deps.config.auditPath,
    },
    ...(deps.pid === undefined ? {} : { pid: deps.pid }),
    ...(deps.isAlive === undefined ? {} : { isAlive: deps.isAlive }),
  });
  const close = async (): Promise<void> => {
    await adminChannel.stop();
    rateLimiter.stop();
    approvals.stop();
    await audit.close();
  };
  try {
    await adminChannel.start();
  } catch (error) {
    // Do not leave the audit lock behind when startup is refused.
    await close();
    throw error;
  }

  return {
    registry,
    wrapper,
    approvals,
    ci,
    adminChannel,
    ids: deps.ids,
    logger,
    close,
  };
}

/**
 * Opens the audit file. If another live process holds it, startup is refused (the error
 * propagates). If the file simply cannot be used, the server still starts: writes are
 * refused and reads report the audit failure (NFR1.12).
 */
async function openAuditSink(deps: AppDeps, logger: Logger): Promise<AuditSink> {
  try {
    return await FileAuditSink.open(deps.config.auditPath, {
      ...(deps.pid === undefined ? {} : { pid: deps.pid }),
      ...(deps.isAlive === undefined ? {} : { isAlive: deps.isAlive }),
    });
  } catch (error) {
    if (!(error instanceof AuditUnavailableError)) throw error;
    logger.error('audit.write_failed', { reason: error.reason, path: deps.config.auditPath });
    return new UnavailableAuditSink(error.reason);
  }
}
