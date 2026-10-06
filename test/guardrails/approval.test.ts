import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/core/logger.js';
import { createRedactor } from '../../src/core/redactor.js';
import { GuardrailError } from '../../src/core/errors.js';
import {
  ApprovalService,
  APPROVAL_TTL_MS,
  MAX_APPROVALS_PER_CLIENT,
} from '../../src/guardrails/approval.js';
import { FakeClock, FakeIdSource, FakeScheduler } from '../support/fakes.js';

const TOOL = 'rerun_ci_job';
const inputs = { repo: 'sample-node-api', jobId: 'job-1001-1' };

function setup() {
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const logLines: string[] = [];
  const service = new ApprovalService({
    clock,
    scheduler,
    ids: new FakeIdSource(),
    logger: createLogger({
      sink: (line) => logLines.push(line),
      clock,
      redactor: createRedactor(),
      level: 'info',
      component: 'ApprovalService',
    }),
  });
  const events = () => logLines.map((line) => (JSON.parse(line) as { msg: string }).msg);
  return { clock, scheduler, service, events };
}

function approvedRequest(setupResult = setup()) {
  const request = setupResult.service.request(TOOL, 'alice', inputs);
  expect(setupResult.service.approve(request.requestId)).toMatchObject({ ok: true });
  return { ...setupResult, requestId: request.requestId };
}

describe('Given an agent asks for a write and no approval exists', () => {
  it('When the request is made, then a pending record with a request ID and a short digest exists', () => {
    const { service, events } = setup();
    const request = service.request(TOOL, 'alice', inputs);
    expect(request.requestId).toMatch(/^req_[a-z2-7]{26}$/);
    expect(request.displayDigest).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(request.state).toBe('pending');
    expect(events()).toEqual(['approval.requested']);
  });

  it('When the same action is requested again while pending or approved, then the same record is returned', () => {
    const { service } = setup();
    const first = service.request(TOOL, 'alice', inputs);
    expect(service.request(TOOL, 'alice', { jobId: 'job-1001-1', repo: 'sample-node-api' })).toBe(
      first,
    );
    service.approve(first.requestId);
    expect(service.request(TOOL, 'alice', inputs)).toBe(first);
  });

  it('When a different client or different inputs ask, then a new record is made', () => {
    const { service } = setup();
    const first = service.request(TOOL, 'alice', inputs);
    expect(service.request(TOOL, 'bob', inputs)).not.toBe(first);
    expect(service.request(TOOL, 'alice', { ...inputs, jobId: 'other' })).not.toBe(first);
  });

  it('When a client holds 20 records, then the 21st request is refused and other clients are unaffected', () => {
    const { service } = setup();
    for (let i = 0; i < MAX_APPROVALS_PER_CLIENT; i += 1) {
      service.request(TOOL, 'alice', { ...inputs, jobId: `job-${i}` });
    }
    expect(() => service.request(TOOL, 'alice', { ...inputs, jobId: 'one-too-many' })).toThrow(
      GuardrailError,
    );
    expect(() => service.request(TOOL, 'bob', inputs)).not.toThrow();
  });
});

describe('Given a human approves a pending request', () => {
  it('When the request exists, then it becomes approved and the grant is logged', () => {
    const { service, events } = setup();
    const { requestId } = service.request(TOOL, 'alice', inputs);
    expect(service.approve(requestId)).toEqual({
      ok: true,
      requestId,
      validUntilMs: APPROVAL_TTL_MS,
    });
    expect(events()).toEqual(['approval.requested', 'approval.granted']);
  });

  it('When the ID is unknown, then approval is refused', () => {
    expect(setup().service.approve('req_aaaaaaaaaaaaaaaaaaaaaaaaaa')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('When the request is already approved, then approving again is refused', () => {
    const { service, requestId } = approvedRequest();
    expect(service.approve(requestId)).toEqual({ ok: false, reason: 'not_pending' });
  });

  it('When nobody approves for 5 minutes, then the pending request expires: accepted at 5:00, refused after', () => {
    const accepted = setup();
    const keep = accepted.service.request(TOOL, 'alice', inputs);
    accepted.clock.tick(APPROVAL_TTL_MS);
    expect(accepted.service.approve(keep.requestId)).toMatchObject({ ok: true });

    const late = setup();
    const gone = late.service.request(TOOL, 'alice', inputs);
    late.clock.tick(APPROVAL_TTL_MS + 1);
    expect(late.service.approve(gone.requestId)).toEqual({ ok: false, reason: 'expired' });
    expect(late.events()).toContain('approval.expired');
  });
});

describe('Given an approved request is presented for a write', () => {
  it('When tool, client and inputs match, then it is claimed once', () => {
    const { service, requestId } = approvedRequest();
    expect(service.claim(requestId, TOOL, 'alice', inputs)).toEqual({ ok: true });
  });

  it.each([
    ['another tool', 'other_tool', 'alice', inputs, 'wrong_tool'],
    ['another client', TOOL, 'bob', inputs, 'wrong_client'],
    ['swapped inputs', TOOL, 'alice', { ...inputs, jobId: 'job-9' }, 'wrong_inputs'],
  ] as const)(
    'When it is presented for %s, then it is refused',
    (_label, tool, client, given, reason) => {
      const { service, requestId } = approvedRequest();
      expect(service.claim(requestId, tool, client, given)).toEqual({ ok: false, reason });
      // The failed attempt did not burn the approval.
      expect(service.claim(requestId, TOOL, 'alice', inputs)).toEqual({ ok: true });
    },
  );

  it('When the ID is unknown, then it is refused', () => {
    expect(setup().service.claim('req_aaaaaaaaaaaaaaaaaaaaaaaaaa', TOOL, 'alice', inputs)).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('When the request was never approved, then it is refused as not approved', () => {
    const { service } = setup();
    const { requestId } = service.request(TOOL, 'alice', inputs);
    expect(service.claim(requestId, TOOL, 'alice', inputs)).toEqual({
      ok: false,
      reason: 'not_approved',
    });
  });

  it('When a pending request has passed its own expiry, then it is refused as expired', () => {
    const { service, clock } = setup();
    const { requestId } = service.request(TOOL, 'alice', inputs);
    clock.tick(APPROVAL_TTL_MS + 1);
    expect(service.claim(requestId, TOOL, 'alice', inputs)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('When the approval is exactly 5:00 old it is accepted, and 1 ms later it is refused', () => {
    const edge = approvedRequest();
    edge.clock.tick(APPROVAL_TTL_MS);
    expect(edge.service.claim(edge.requestId, TOOL, 'alice', inputs)).toEqual({ ok: true });

    const late = approvedRequest();
    late.clock.tick(APPROVAL_TTL_MS + 1);
    expect(late.service.claim(late.requestId, TOOL, 'alice', inputs)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('When two presentations arrive together, then only one can win the claim', () => {
    const { service, requestId } = approvedRequest();
    const results = [
      service.claim(requestId, TOOL, 'alice', inputs),
      service.claim(requestId, TOOL, 'alice', inputs),
    ];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results[1]).toEqual({ ok: false, reason: 'reused' });
  });

  it('When the intent line cannot be written and the claim is released, then the approval can be used again', () => {
    const { service, requestId } = approvedRequest();
    service.claim(requestId, TOOL, 'alice', inputs);
    service.release(requestId);
    expect(service.claim(requestId, TOOL, 'alice', inputs)).toEqual({ ok: true });
  });

  it('When the write has been consumed, then the same approval cannot be reused, even if a release is attempted', () => {
    const { service, requestId, events } = approvedRequest();
    service.claim(requestId, TOOL, 'alice', inputs);
    service.consume(requestId);
    service.release(requestId);
    expect(service.claim(requestId, TOOL, 'alice', inputs)).toEqual({
      ok: false,
      reason: 'reused',
    });
    expect(events()).toContain('approval.consumed');
  });

  it('When release or consume is called for something that is not being executed, then nothing changes', () => {
    const { service, requestId } = approvedRequest();
    service.release(requestId);
    service.consume(requestId);
    service.release('req_aaaaaaaaaaaaaaaaaaaaaaaaaa');
    service.consume('req_aaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(service.claim(requestId, TOOL, 'alice', inputs)).toEqual({ ok: true });
  });
});

describe('Given the human lists pending requests', () => {
  it('When requests are in different states, then only unexpired pending ones are listed with their exact inputs', () => {
    const { service, clock } = setup();
    const a = service.request(TOOL, 'alice', inputs);
    const b = service.request(TOOL, 'bob', { ...inputs, jobId: 'job-2' });
    service.approve(b.requestId);
    expect(service.listPending()).toEqual([
      {
        requestId: a.requestId,
        tool: TOOL,
        client: 'alice',
        inputs,
        digest: a.displayDigest,
        createdAt: 0,
        expiresAt: APPROVAL_TTL_MS,
      },
    ]);
    clock.tick(APPROVAL_TTL_MS + 1);
    expect(service.listPending()).toEqual([]);
  });
});

describe('Given records pile up over time', () => {
  it('When the sweep runs, then expired and consumed records are discarded and the client can ask again', async () => {
    const { service, scheduler } = setup();
    for (let i = 0; i < MAX_APPROVALS_PER_CLIENT; i += 1) {
      const { requestId } = service.request(TOOL, 'alice', { ...inputs, jobId: `job-${i}` });
      service.approve(requestId);
    }
    const used = service.request(TOOL, 'alice', { ...inputs, jobId: 'job-0' });
    service.claim(used.requestId, TOOL, 'alice', { ...inputs, jobId: 'job-0' });
    service.consume(used.requestId);

    await scheduler.advance(APPROVAL_TTL_MS + 60_000);
    expect(() => service.request(TOOL, 'alice', { ...inputs, jobId: 'fresh' })).not.toThrow();
    expect(service.listPending()).toHaveLength(1);
  });

  it('When the service is stopped, then its sweep is cancelled', () => {
    const { service, scheduler } = setup();
    service.stop();
    expect(scheduler.pendingCount).toBe(0);
  });

  it('When a record is being executed, then it is never expired out from under the write', async () => {
    const { service, scheduler, requestId } = approvedRequest();
    service.claim(requestId, TOOL, 'alice', inputs);
    await scheduler.advance(APPROVAL_TTL_MS * 3);
    service.release(requestId);
    // Released after the long wait: the approval itself is long expired.
    expect(service.claim(requestId, TOOL, 'alice', inputs)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});
