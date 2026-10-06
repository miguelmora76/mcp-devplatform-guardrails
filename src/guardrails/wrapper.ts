import { describeError, GuardrailError, toClientError, type ClientError } from '../core/errors.js';
import type { ClientIdentity } from '../core/identity.js';
import type { Logger } from '../core/logger.js';
import type { IdSource } from '../core/ports.js';
import type { PreparedCall, Tool, ToolKind } from '../core/tool-types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { AuditEntry, AuditOutcome, AuditPhase, AuditWriter } from './audit.js';
import type { ApprovalService } from './approval.js';
import type { RateLimiter } from './rate-limiter.js';

/**
 * Guardrail wrapper (LC-04): the single path every tool call takes. Fixed order:
 *
 *   1. identify the client            4. authorize (writes need a human approval)
 *   2. rate limit                     5. audit intent, then execute, then audit outcome
 *   3. validate                          (reads: execute, then one audit line)
 *
 * Every refusal at steps 1-4 writes exactly one record and calls no handler. A call has
 * one call ID; a write that passes has an `intent` line and an `outcome` line under it.
 * A returned result always has its line, or carries the audit-failure flag (FR5, FR6, FR7,
 * NFR1.1, NFR1.2, NFR1.14).
 */

export type CallResult =
  | {
      readonly ok: true;
      readonly callId: string;
      readonly data: unknown;
      readonly auditFailure?: true;
    }
  | {
      readonly ok: false;
      readonly callId: string;
      readonly error: ClientError;
      readonly auditFailure?: true;
    };

export interface WrapperDeps {
  readonly registry: ToolRegistry;
  readonly audit: AuditWriter;
  readonly rateLimiter: RateLimiter;
  readonly approvals: ApprovalService;
  readonly ids: IdSource;
  readonly logger: Logger;
}

type Body = { readonly data: unknown } | { readonly error: ClientError };

interface CallInfo {
  readonly callId: string;
  readonly client: ClientIdentity;
  readonly tool: string;
  readonly rawArguments: unknown;
}

export class GuardrailWrapper {
  private active = 0;
  private shuttingDown = false;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly deps: WrapperDeps) {}

  /** Calls that have started and not yet written their audit record. */
  get inFlight(): number {
    return this.active;
  }

  /** From now on every new call is refused (and recorded); calls in flight carry on. */
  beginShutdown(): void {
    this.shuttingDown = true;
  }

  /** Resolves when no call is in flight. */
  drain(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  async call(client: ClientIdentity, toolName: string, rawArguments: unknown): Promise<CallResult> {
    this.active += 1;
    try {
      return await this.run(client, toolName, rawArguments);
    } finally {
      this.release();
    }
  }

  /**
   * A message over the size limit could not be read, so it is never parsed. It still gets
   * one audit record (outcome `invalid`) under its own call ID, and counts against the
   * client's read allowance so a flood of them is limited too (NFR1.1).
   */
  async rejectOversized(client: ClientIdentity, bytes: number): Promise<CallResult> {
    this.active += 1;
    try {
      const info: CallInfo = {
        callId: this.deps.ids.callId(),
        client,
        tool: '(oversized message)',
        rawArguments: { _omitted: 'message too large', bytes },
      };
      const turnedAway = await this.admit(info, 'read');
      return (
        turnedAway ?? (await this.refuse(info, 'invalid', new GuardrailError('message_too_large')))
      );
    } finally {
      this.release();
    }
  }

  private release(): void {
    this.active -= 1;
    if (this.active === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  /** Steps 1-2 for every call: identify, then (unless shutting down) rate limit. */
  private async admit(info: CallInfo, kind: ToolKind): Promise<CallResult | undefined> {
    if (info.client.name === '') {
      return this.refuse(info, 'refused', new GuardrailError('unidentified_client'));
    }
    if (this.shuttingDown) return this.refuse(info, 'refused', new GuardrailError('shutting_down'));
    const decision = this.deps.rateLimiter.check(info.client.name, kind);
    if (!decision.allowed) {
      const seconds = Math.ceil(decision.retryAfterMs / 1000);
      return this.refuse(
        info,
        'rate-limited',
        new GuardrailError('rate_limited', `Retry after ${seconds} seconds.`),
      );
    }
    return undefined;
  }

  private async run(
    client: ClientIdentity,
    toolName: string,
    rawArguments: unknown,
  ): Promise<CallResult> {
    const info: CallInfo = { callId: this.deps.ids.callId(), client, tool: toolName, rawArguments };

    // 1-2. Identify and rate limit, before validation, so a flood of malformed calls is
    // limited too. The tool's kind decides which allowance is used.
    const tool = this.deps.registry.get(toolName);
    const turnedAway = await this.admit(info, tool?.kind ?? 'read');
    if (turnedAway !== undefined) return turnedAway;

    // 3. Validate.
    if (tool === undefined) return this.refuse(info, 'refused', new GuardrailError('unknown_tool'));
    const prepared = tool.prepare(rawArguments);
    if (!prepared.ok) {
      return this.refuse(
        info,
        'invalid',
        new GuardrailError('invalid_input', `Check fields: ${prepared.fields.join(', ')}.`),
      );
    }

    return tool.kind === 'write'
      ? this.callWrite(info, tool, prepared.value)
      : this.callRead(info, prepared.value);
  }

  private async callRead(info: CallInfo, prepared: PreparedCall): Promise<CallResult> {
    const { outcome, body } = await this.execute(info, prepared);
    return this.finish(info, 'complete', outcome, body);
  }

  private async callWrite(info: CallInfo, tool: Tool, prepared: PreparedCall): Promise<CallResult> {
    const { approvals, logger } = this.deps;

    // 4a. Precondition: never ask a human to approve (or spend an approval on) an action
    // that cannot succeed.
    const refusal = await this.checkPrecondition(info, prepared);
    if (refusal !== undefined) return refusal;

    // 4b. Authorize: no approval yet means a pending request for a human to approve.
    const presented = prepared.approvalRequestId;
    if (presented === undefined) {
      let requestId: string;
      try {
        requestId = approvals.request(tool.name, info.client.name, prepared.input).requestId;
      } catch (error) {
        return this.refuse(info, 'refused', error);
      }
      const error = toClientError(new GuardrailError('approval_required'));
      return this.finish(info, 'complete', 'refused', { error: { ...error, requestId } });
    }
    const claim = approvals.claim(presented, tool.name, info.client.name, prepared.input);
    if (!claim.ok) {
      logger.warn('approval.refused', {
        callId: info.callId,
        client: info.client.name,
        tool: tool.name,
        reason: claim.reason,
      });
      return this.refuse(info, 'refused', new GuardrailError('approval_invalid'));
    }

    // 5. Intent must be on disk before anything changes; if it cannot be, nothing changes
    // and the approval is given back.
    const intentFailed = await this.record(info, 'intent', 'pending');
    if (intentFailed) {
      approvals.release(presented);
      return this.refuse(info, 'refused', new GuardrailError('audit_unavailable'));
    }
    approvals.consume(presented);

    const { outcome, body } = await this.execute(info, prepared);
    return this.finish(info, 'outcome', outcome, body);
  }

  /** Returns a finished result when the tool's precondition fails, otherwise undefined. */
  private async checkPrecondition(
    info: CallInfo,
    prepared: PreparedCall,
  ): Promise<CallResult | undefined> {
    try {
      await prepared.precondition({ callId: info.callId, client: info.client });
      return undefined;
    } catch (error) {
      if (error instanceof GuardrailError) return this.refuse(info, 'refused', error);
      this.logUnexpected(info, error);
      return this.finish(info, 'complete', 'error', { error: toClientError(error) });
    }
  }

  private logUnexpected(info: CallInfo, error: unknown): void {
    this.deps.logger.error('tool.error', {
      callId: info.callId,
      client: info.client.name,
      tool: info.tool,
      err: describeError(error),
    });
  }

  /** Runs the handler inside the error boundary. */
  private async execute(
    info: CallInfo,
    prepared: PreparedCall,
  ): Promise<{ outcome: AuditOutcome; body: Body }> {
    try {
      const data = await prepared.run({ callId: info.callId, client: info.client });
      return { outcome: 'allowed', body: { data } };
    } catch (error) {
      if (!(error instanceof GuardrailError)) this.logUnexpected(info, error);
      return { outcome: 'error', body: { error: toClientError(error) } };
    }
  }

  /** A refusal before any handler runs: one record, a defined error. */
  private refuse(info: CallInfo, outcome: AuditOutcome, error: unknown): Promise<CallResult> {
    return this.finish(info, 'complete', outcome, { error: toClientError(error) });
  }

  /** Writes the call's closing audit line, then builds the result. */
  private async finish(
    info: CallInfo,
    phase: AuditPhase,
    outcome: AuditOutcome,
    body: Body,
  ): Promise<CallResult> {
    const failed = await this.record(info, phase, outcome);
    const flag = failed ? ({ auditFailure: true } as const) : {};
    return 'error' in body
      ? { ok: false, callId: info.callId, error: body.error, ...flag }
      : { ok: true, callId: info.callId, data: body.data, ...flag };
  }

  /** Appends one audit line; returns true when it could not be written. */
  private async record(info: CallInfo, phase: AuditPhase, outcome: AuditOutcome): Promise<boolean> {
    const entry: AuditEntry = {
      callId: info.callId,
      phase,
      tool: info.tool,
      client: info.client.name === '' ? '(unknown)' : info.client.name,
      inputs: info.rawArguments,
      outcome,
    };
    try {
      await this.deps.audit.record(entry);
      return false;
    } catch (error) {
      this.deps.logger.error('audit.write_failed', {
        callId: info.callId,
        err: describeError(error),
      });
      return true;
    }
  }
}
