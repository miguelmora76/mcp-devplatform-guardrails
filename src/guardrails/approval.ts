import { canonicalJson, displayDigest, sha256Hex } from '../core/canonical-json.js';
import { GuardrailError } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import type { Clock, IdSource, Scheduler, TimerHandle } from '../core/ports.js';

/**
 * Approval service (LC-07): in-memory approval requests for state-changing tools.
 *
 * An approval binds a tool, a client and the SHA-256 of the canonical JSON of the
 * validated inputs. The agent can only create a pending request; turning it into an
 * approval is a separate human action (`approve`, reached through the admin channel and
 * never through a tool or route). An approval is single use, valid for 5 minutes from the
 * moment it is granted (a pending request lapses 5 minutes after it was made), and
 * verify-and-claim is one synchronous step so two presentations cannot both win
 * (NFR1.3, NFR1.9, NFR1.17).
 */

export const APPROVAL_TTL_MS = 5 * 60 * 1000;
export const MAX_APPROVALS_PER_CLIENT = 20;
const SWEEP_INTERVAL_MS = 60_000;

export type ApprovalState = 'pending' | 'approved' | 'executing' | 'consumed';

export interface ApprovalRequest {
  readonly requestId: string;
  readonly tool: string;
  readonly client: string;
  /** Full SHA-256 (hex) of the canonical inputs; what the approval is bound to. */
  readonly digest: string;
  /** `sha256:` plus 12 hex characters; shown to the human next to the inputs. */
  readonly displayDigest: string;
  readonly inputs: unknown;
  state: ApprovalState;
  /** When the record entered its current waiting state (made, or approved). */
  since: number;
  readonly createdAt: number;
}

export type ApproveResult =
  | { readonly ok: true; readonly requestId: string; readonly validUntilMs: number }
  | { readonly ok: false; readonly reason: 'unknown' | 'expired' | 'not_pending' };

export type ClaimRefusal =
  | 'unknown'
  | 'wrong_client'
  | 'wrong_tool'
  | 'wrong_inputs'
  | 'reused'
  | 'not_approved'
  | 'expired';

export type ClaimResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ClaimRefusal };

/** What the human sees when listing pending requests. */
export interface PendingView {
  readonly requestId: string;
  readonly tool: string;
  readonly client: string;
  readonly inputs: unknown;
  readonly digest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ApprovalServiceOptions {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly ids: IdSource;
  readonly logger: Logger;
}

export class ApprovalService {
  private readonly records = new Map<string, ApprovalRequest>();
  private readonly sweeper: TimerHandle;

  constructor(private readonly options: ApprovalServiceOptions) {
    this.sweeper = options.scheduler.every(SWEEP_INTERVAL_MS, () => {
      this.purge();
    });
  }

  /** Creates (or returns the open) pending request for this exact action. */
  request(tool: string, client: string, inputs: unknown): ApprovalRequest {
    this.purge();
    const digest = sha256Hex(canonicalJson(inputs));
    for (const record of this.records.values()) {
      const open = record.state === 'pending' || record.state === 'approved';
      if (open && record.client === client && record.tool === tool && record.digest === digest) {
        return record;
      }
    }
    const held = [...this.records.values()].filter((record) => record.client === client).length;
    if (held >= MAX_APPROVALS_PER_CLIENT) throw new GuardrailError('approval_limit');

    const now = this.options.clock.now();
    const record: ApprovalRequest = {
      requestId: this.options.ids.requestId(),
      tool,
      client,
      digest,
      displayDigest: displayDigest(digest),
      inputs,
      state: 'pending',
      since: now,
      createdAt: now,
    };
    this.records.set(record.requestId, record);
    this.options.logger.info('approval.requested', {
      requestId: record.requestId,
      tool,
      client,
      digest: record.displayDigest,
    });
    return record;
  }

  /** The human's action: pending to approved, valid for 5 minutes from now. */
  approve(requestId: string): ApproveResult {
    const record = this.records.get(requestId);
    if (record === undefined) return { ok: false, reason: 'unknown' };
    if (this.isExpired(record, this.options.clock.now())) {
      this.purge();
      return { ok: false, reason: 'expired' };
    }
    if (record.state !== 'pending') return { ok: false, reason: 'not_pending' };
    const now = this.options.clock.now();
    record.state = 'approved';
    record.since = now;
    this.options.logger.info('approval.granted', { requestId, client: record.client });
    return { ok: true, requestId, validUntilMs: now + APPROVAL_TTL_MS };
  }

  /**
   * Verifies and claims an approval in one synchronous step (no `await`), moving it from
   * approved to executing so a second presentation cannot also pass.
   */
  claim(requestId: string, tool: string, client: string, inputs: unknown): ClaimResult {
    const record = this.records.get(requestId);
    if (record === undefined) return { ok: false, reason: 'unknown' };
    if (record.client !== client) return { ok: false, reason: 'wrong_client' };
    if (record.tool !== tool) return { ok: false, reason: 'wrong_tool' };
    if (record.digest !== sha256Hex(canonicalJson(inputs))) {
      return { ok: false, reason: 'wrong_inputs' };
    }
    if (record.state === 'executing' || record.state === 'consumed') {
      return { ok: false, reason: 'reused' };
    }
    if (this.isExpired(record, this.options.clock.now())) return { ok: false, reason: 'expired' };
    if (record.state === 'pending') return { ok: false, reason: 'not_approved' };
    record.state = 'executing';
    return { ok: true };
  }

  /** The audit intent line failed: give the approval back so it is not burned. */
  release(requestId: string): void {
    const record = this.records.get(requestId);
    if (record?.state === 'executing') record.state = 'approved';
  }

  /** The intent line is on disk: the approval is spent, even if the write then fails. */
  consume(requestId: string): void {
    const record = this.records.get(requestId);
    if (record?.state === 'executing') {
      record.state = 'consumed';
      this.options.logger.info('approval.consumed', { requestId, client: record.client });
    }
  }

  /** Unexpired pending requests, for the human's `approve` command. */
  listPending(): PendingView[] {
    this.purge();
    return [...this.records.values()]
      .filter((record) => record.state === 'pending')
      .map((record) => ({
        requestId: record.requestId,
        tool: record.tool,
        client: record.client,
        inputs: record.inputs,
        digest: record.displayDigest,
        createdAt: record.createdAt,
        expiresAt: record.since + APPROVAL_TTL_MS,
      }));
  }

  stop(): void {
    this.sweeper.cancel();
  }

  private isExpired(record: ApprovalRequest, now: number): boolean {
    const waiting = record.state === 'pending' || record.state === 'approved';
    return waiting && now - record.since > APPROVAL_TTL_MS;
  }

  /** Discards expired and consumed records. */
  private purge(): void {
    const now = this.options.clock.now();
    for (const [requestId, record] of this.records) {
      if (record.state === 'consumed') {
        this.records.delete(requestId);
      } else if (this.isExpired(record, now)) {
        this.records.delete(requestId);
        this.options.logger.info('approval.expired', { requestId, client: record.client });
      }
    }
  }
}
