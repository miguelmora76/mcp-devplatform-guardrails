import { z } from 'zod';
import { GuardrailError } from '../../src/core/errors.js';
import { createLogger } from '../../src/core/logger.js';
import { createRedactor } from '../../src/core/redactor.js';
import { defineTool, type Tool } from '../../src/core/tool-types.js';
import { safeString } from '../../src/core/validator.js';
import { ApprovalService } from '../../src/guardrails/approval.js';
import { AuditWriter } from '../../src/guardrails/audit.js';
import { RateLimiter } from '../../src/guardrails/rate-limiter.js';
import { GuardrailWrapper } from '../../src/guardrails/wrapper.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { FakeClock, FakeIdSource, FakeScheduler, MemoryAuditSink } from './fakes.js';

/** Counts how often each synthetic tool's handler actually ran. */
export interface HandlerCalls {
  read: number;
  write: number;
  boom: number;
  missing: number;
  changed: string[];
  precondition: number;
}

/** A promise a spec resolves by hand, to hold a call in flight. */
export interface Gate {
  readonly promise: Promise<void>;
  open(): void;
}

export function createGate(): Gate {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open: () => open() };
}

export interface WrapperFixture {
  /** Holds every `slow_read` call until opened. */
  readonly gate: Gate;
  readonly precondition: PreconditionControl;
  readonly wrapper: GuardrailWrapper;
  readonly clock: FakeClock;
  readonly scheduler: FakeScheduler;
  readonly sink: MemoryAuditSink;
  readonly approvals: ApprovalService;
  readonly calls: HandlerCalls;
  readonly logLines: string[];
  readonly registry: ToolRegistry;
  logged(): { msg: string; [key: string]: unknown }[];
}

/** Lets a spec decide what the guarded write tool's precondition does. */
export interface PreconditionControl {
  mode: 'ok' | 'defined_error' | 'unexpected_error';
}

export const alice = { name: 'alice' };
export const bob = { name: 'bob' };

/** The real wrapper, rate limiter, approvals and audit writer around four synthetic tools. */
export function createWrapperFixture(extraTools: Tool[] = []): WrapperFixture {
  const clock = new FakeClock(Date.UTC(2026, 9, 5, 12, 0, 0));
  const scheduler = new FakeScheduler(clock);
  const ids = new FakeIdSource();
  const sink = new MemoryAuditSink();
  const logLines: string[] = [];
  const redactor = createRedactor();
  const logger = createLogger({
    sink: (line) => logLines.push(line),
    clock,
    redactor,
    level: 'debug',
    component: 'Test',
  });
  const calls: HandlerCalls = {
    read: 0,
    write: 0,
    boom: 0,
    missing: 0,
    changed: [],
    precondition: 0,
  };
  const precondition: PreconditionControl = { mode: 'ok' };
  const gate = createGate();

  const tools: Tool[] = [
    defineTool({
      name: 'echo_read',
      description: 'A read tool for specs.',
      kind: 'read',
      shape: { text: safeString(20) },
      handler: (input) => {
        calls.read += 1;
        return Promise.resolve({ echoed: input.text });
      },
    }),
    defineTool({
      name: 'change_thing',
      description: 'A write tool for specs.',
      kind: 'write',
      shape: { target: safeString(20), count: z.number().int().optional() },
      handler: (input) => {
        calls.write += 1;
        calls.changed.push(input.target);
        return Promise.resolve({ changed: input.target });
      },
    }),
    defineTool({
      name: 'slow_read',
      description: 'A read tool that waits for the spec to let it finish.',
      kind: 'read',
      shape: {},
      handler: async () => {
        await gate.promise;
        return { slow: true };
      },
    }),
    defineTool({
      name: 'boom_read',
      description: 'A read tool whose handler throws an unexpected error.',
      kind: 'read',
      shape: {},
      handler: () => {
        calls.boom += 1;
        return Promise.reject(new Error('ENOENT /Users/secret/path'));
      },
    }),
    defineTool({
      name: 'missing_read',
      description: 'A read tool whose handler throws a defined error.',
      kind: 'read',
      shape: {},
      handler: () => {
        calls.missing += 1;
        return Promise.reject(new GuardrailError('not_found', 'Snapshot x has no such run.'));
      },
    }),
    defineTool({
      name: 'boom_write',
      description: 'A write tool whose handler throws after approval.',
      kind: 'write',
      shape: { target: safeString(20) },
      handler: () => Promise.reject(new Error('write failed half way')),
    }),
    defineTool({
      name: 'guarded_write',
      description: 'A write tool with a precondition.',
      kind: 'write',
      shape: { target: safeString(20) },
      precondition: () => {
        calls.precondition += 1;
        if (precondition.mode === 'defined_error') {
          return Promise.reject(new GuardrailError('job_not_failed'));
        }
        if (precondition.mode === 'unexpected_error') {
          return Promise.reject(new Error('precondition blew up /secret/path'));
        }
        return Promise.resolve();
      },
      handler: (input) => {
        calls.write += 1;
        return Promise.resolve({ changed: input.target });
      },
    }),
    ...extraTools,
  ];
  const registry = new ToolRegistry(tools);
  const approvals = new ApprovalService({ clock, scheduler, ids, logger });
  const wrapper = new GuardrailWrapper({
    registry,
    audit: new AuditWriter({ sink, clock, redactor }),
    rateLimiter: new RateLimiter({ clock, scheduler }),
    approvals,
    ids,
    logger,
  });
  return {
    gate,
    precondition,
    wrapper,
    clock,
    scheduler,
    sink,
    approvals,
    calls,
    logLines,
    registry,
    logged: () => logLines.map((line) => JSON.parse(line) as { msg: string }),
  };
}
