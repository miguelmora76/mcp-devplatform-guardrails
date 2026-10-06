import { describe, expect, it, vi } from 'vitest';
import { GuardrailError } from '../../src/core/errors.js';
import { CALL_ID_PATTERN } from '../../src/core/identity.js';
import { APPROVAL_TTL_MS } from '../../src/guardrails/approval.js';
import { alice, bob, createWrapperFixture } from '../support/wrapper-fixture.js';

const target = { target: 'thing-1' };

/** Drives a write through request, human approval and the approved call. */
async function approvedWrite(fx = createWrapperFixture(), args: Record<string, unknown> = target) {
  const first = await fx.wrapper.call(alice, 'change_thing', args);
  if (first.ok || first.error.requestId === undefined)
    throw new Error('expected approval_required');
  fx.approvals.approve(first.error.requestId);
  return { fx, requestId: first.error.requestId };
}

describe('Given every call goes through the one wrapper in a fixed order', () => {
  describe('When a read is allowed', () => {
    it('Then the handler runs once and exactly one complete audit line exists under one call ID', async () => {
      const fx = createWrapperFixture();
      const result = await fx.wrapper.call(alice, 'echo_read', { text: 'hi' });
      expect(result).toEqual({
        ok: true,
        callId: 'call_aaaaaaaaaaaaaaaaaaaaaaaaab',
        data: { echoed: 'hi' },
      });
      expect(result.callId).toMatch(CALL_ID_PATTERN);
      expect(fx.calls.read).toBe(1);
      expect(fx.sink.records()).toMatchObject([
        {
          callId: result.callId,
          phase: 'complete',
          tool: 'echo_read',
          client: 'alice',
          outcome: 'allowed',
        },
      ]);
    });
  });

  describe('When a call is refused before any handler runs', () => {
    it.each([
      ['an unknown tool', 'no_such_tool', {}, 'refused', 'unknown_tool'],
      ['invalid input', 'echo_read', { text: 1 }, 'invalid', 'invalid_input'],
      ['an unknown field', 'echo_read', { text: 'a', extra: 1 }, 'invalid', 'invalid_input'],
      ['an oversized string', 'echo_read', { text: 'x'.repeat(21) }, 'invalid', 'invalid_input'],
      ['a control character', 'echo_read', { text: 'a\nb' }, 'invalid', 'invalid_input'],
      ['a write without approval', 'change_thing', target, 'refused', 'approval_required'],
      [
        'a malformed approval reference',
        'change_thing',
        { ...target, approvalRequestId: 'nope' },
        'invalid',
        'invalid_input',
      ],
      [
        'an approval nobody made',
        'change_thing',
        { ...target, approvalRequestId: 'req_aaaaaaaaaaaaaaaaaaaaaaaaaa' },
        'refused',
        'approval_invalid',
      ],
    ] as const)(
      'Then %s gives one record, a defined error and no handler call',
      async (_label, tool, args, outcome, code) => {
        const fx = createWrapperFixture();
        const result = await fx.wrapper.call(alice, tool, args);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe(code);
        expect(fx.sink.records()).toHaveLength(1);
        expect(fx.sink.records()[0]).toMatchObject({
          callId: result.callId,
          phase: 'complete',
          outcome,
        });
        expect(fx.calls).toMatchObject({ read: 0, write: 0 });
      },
    );

    it('Then a caller without an identity is refused and recorded as unknown', async () => {
      const fx = createWrapperFixture();
      const result = await fx.wrapper.call({ name: '' }, 'echo_read', { text: 'a' });
      expect(!result.ok && result.error.code).toBe('unidentified_client');
      expect(fx.sink.records()).toMatchObject([{ client: '(unknown)', outcome: 'refused' }]);
      expect(fx.calls.read).toBe(0);
    });

    it('Then validation errors name fields only and never echo the offending value', async () => {
      const fx = createWrapperFixture();
      const secretish = 'ghp_SHOULDNOTBEECHOED\u0007';
      const result = await fx.wrapper.call(alice, 'echo_read', { text: secretish });
      const message = !result.ok ? result.error.message : '';
      expect(message).toContain('text');
      expect(message).not.toContain('SHOULDNOTBEECHOED');
    });
  });

  describe('When the pipeline order matters', () => {
    it('Then rate limiting happens before validation and before tool lookup', async () => {
      const fx = createWrapperFixture();
      for (let i = 0; i < 30; i += 1) await fx.wrapper.call(alice, 'echo_read', { text: 'a' });
      const invalid = await fx.wrapper.call(alice, 'echo_read', { text: 5 });
      const unknown = await fx.wrapper.call(alice, 'no_such_tool', {});
      expect(!invalid.ok && invalid.error.code).toBe('rate_limited');
      expect(!unknown.ok && unknown.error.code).toBe('rate_limited');
      expect(fx.sink.records().slice(-2)).toMatchObject([
        { outcome: 'rate-limited' },
        { outcome: 'rate-limited' },
      ]);
      expect(fx.calls.read).toBe(30);
    });

    it('Then validation happens before approval, so an invalid write creates no approval request', async () => {
      const fx = createWrapperFixture();
      await fx.wrapper.call(alice, 'change_thing', { target: 5 });
      expect(fx.approvals.listPending()).toEqual([]);
    });

    it('Then a refused write leaves no intent line and does not run the handler', async () => {
      const fx = createWrapperFixture();
      await fx.wrapper.call(alice, 'change_thing', target);
      expect(fx.sink.records().map((r) => r.phase)).toEqual(['complete']);
      expect(fx.calls.write).toBe(0);
    });
  });

  describe('When a client exceeds its rate limit', () => {
    it('Then the 31st read is rejected with a retry time and one record, and another client is unaffected', async () => {
      const fx = createWrapperFixture();
      for (let i = 0; i < 30; i += 1) await fx.wrapper.call(alice, 'echo_read', { text: 'a' });
      const limited = await fx.wrapper.call(alice, 'echo_read', { text: 'a' });
      expect(!limited.ok && limited.error).toMatchObject({
        code: 'rate_limited',
        message: expect.stringContaining('Retry after 60 seconds') as unknown,
      });
      expect((await fx.wrapper.call(bob, 'echo_read', { text: 'a' })).ok).toBe(true);
      expect(fx.sink.records().filter((r) => r.callId === limited.callId)).toHaveLength(1);
    });

    it('Then the 4th write-tool call in a window is rejected, counting the call that only asks for approval', async () => {
      const fx = createWrapperFixture();
      for (let i = 0; i < 3; i += 1)
        await fx.wrapper.call(alice, 'change_thing', { target: `t${i}` });
      const limited = await fx.wrapper.call(alice, 'change_thing', { target: 't3' });
      expect(!limited.ok && limited.error.code).toBe('rate_limited');
      fx.clock.tick(60_000);
      expect(!(await fx.wrapper.call(alice, 'change_thing', { target: 't3' })).ok).toBe(true);
    });
  });
});

describe('Given a handler fails', () => {
  it('When it throws an unexpected error, then the client gets a generic defined error, the detail is only logged, and the server continues', async () => {
    const fx = createWrapperFixture();
    const result = await fx.wrapper.call(alice, 'boom_read', {});
    expect(!result.ok && result.error).toEqual({
      code: 'internal_error',
      message: 'The tool failed unexpectedly. The failure was logged.',
    });
    expect(JSON.stringify(result)).not.toContain('/Users/secret');
    expect(fx.sink.records()).toMatchObject([{ outcome: 'error', phase: 'complete' }]);
    expect(fx.logged().find((l) => l.msg === 'tool.error')).toMatchObject({
      err: 'ENOENT /Users/secret/path',
      tool: 'boom_read',
    });
    expect((await fx.wrapper.call(alice, 'echo_read', { text: 'still up' })).ok).toBe(true);
  });

  it('When it throws a defined error, then that code reaches the client without an error log line', async () => {
    const fx = createWrapperFixture();
    const result = await fx.wrapper.call(alice, 'missing_read', {});
    expect(!result.ok && result.error.code).toBe('not_found');
    expect(fx.logged().some((l) => l.msg === 'tool.error')).toBe(false);
    expect(fx.sink.records()).toMatchObject([{ outcome: 'error' }]);
  });
});

describe('Given the audit file cannot be written', () => {
  it('When a read succeeds, then the result is returned with the audit-failure flag and an error is logged', async () => {
    const fx = createWrapperFixture();
    fx.sink.failWith = new Error('disk full');
    const result = await fx.wrapper.call(alice, 'echo_read', { text: 'hi' });
    expect(result).toMatchObject({ ok: true, auditFailure: true, data: { echoed: 'hi' } });
    expect(fx.logged().some((l) => l.msg === 'audit.write_failed')).toBe(true);
  });

  it('When a refusal cannot be recorded, then it is still returned, flagged', async () => {
    const fx = createWrapperFixture();
    fx.sink.failWith = new Error('disk full');
    const result = await fx.wrapper.call(alice, 'no_such_tool', {});
    expect(result).toMatchObject({ ok: false, auditFailure: true });
    expect(!result.ok && result.error.code).toBe('unknown_tool');
  });

  it('When an approved write cannot write its intent line, then nothing changes, the write is refused, and the approval is not burned', async () => {
    const { fx, requestId } = await approvedWrite();
    fx.sink.failWith = new Error('disk full');
    fx.sink.failWhen = (line) => line.includes('"phase":"intent"');
    const refused = await fx.wrapper.call(alice, 'change_thing', {
      ...target,
      approvalRequestId: requestId,
    });
    expect(!refused.ok && refused.error.code).toBe('audit_unavailable');
    expect(fx.calls.write).toBe(0);

    fx.sink.failWith = undefined;
    const retried = await fx.wrapper.call(alice, 'change_thing', {
      ...target,
      approvalRequestId: requestId,
    });
    expect(retried.ok).toBe(true);
    expect(fx.calls.write).toBe(1);
  });

  it('When the outcome line fails after the change, then the client is told, and the intent line already shows the attempt', async () => {
    const { fx, requestId } = await approvedWrite();
    fx.sink.failWith = new Error('disk full');
    fx.sink.failWhen = (line) => line.includes('"phase":"outcome"');
    const result = await fx.wrapper.call(alice, 'change_thing', {
      ...target,
      approvalRequestId: requestId,
    });
    expect(result).toMatchObject({ ok: true, auditFailure: true });
    expect(fx.calls.write).toBe(1);
    expect(fx.sink.records().map((r) => r.phase)).toEqual(['complete', 'intent']);
  });
});

describe('Given a state-changing tool and a human approval', () => {
  it('When the write is requested, approved and repeated, then the lines are complete, intent, outcome under the right call IDs', async () => {
    const { fx, requestId } = await approvedWrite();
    const result = await fx.wrapper.call(alice, 'change_thing', {
      ...target,
      approvalRequestId: requestId,
    });
    expect(result).toMatchObject({ ok: true, data: { changed: 'thing-1' } });
    const records = fx.sink.records();
    expect(records.map((r) => [r.phase, r.outcome])).toEqual([
      ['complete', 'refused'],
      ['intent', 'pending'],
      ['outcome', 'allowed'],
    ]);
    expect(records[1]?.callId).toBe(records[2]?.callId);
    expect(records[0]?.callId).not.toBe(records[1]?.callId);
    expect(fx.sink.durableFlags).toEqual([false, true, false]);
  });

  it('When approval_required is returned, then it carries a request reference for the human', async () => {
    const fx = createWrapperFixture();
    const result = await fx.wrapper.call(alice, 'change_thing', target);
    expect(!result.ok && result.error).toMatchObject({
      code: 'approval_required',
      requestId: expect.stringMatching(/^req_[a-z2-7]{26}$/) as unknown,
    });
  });

  it('When the approval is replayed, then the second write is refused and nothing changes twice', async () => {
    const { fx, requestId } = await approvedWrite();
    const args = { ...target, approvalRequestId: requestId };
    await fx.wrapper.call(alice, 'change_thing', args);
    const replay = await fx.wrapper.call(alice, 'change_thing', args);
    expect(!replay.ok && replay.error.code).toBe('approval_invalid');
    expect(fx.calls.changed).toEqual(['thing-1']);
  });

  it.each([
    ['swapped inputs', alice, { target: 'other-thing' }],
    ['another client', bob, target],
  ] as const)(
    'When the approval is presented with %s, then it is refused and the approval still works for the real call',
    async (_label, client, args) => {
      const { fx, requestId } = await approvedWrite();
      const refused = await fx.wrapper.call(client, 'change_thing', {
        ...args,
        approvalRequestId: requestId,
      });
      expect(!refused.ok && refused.error.code).toBe('approval_invalid');
      expect(fx.calls.write).toBe(0);
      expect(fx.logged().find((l) => l.msg === 'approval.refused')).toBeDefined();
      const real = await fx.wrapper.call(alice, 'change_thing', {
        ...target,
        approvalRequestId: requestId,
      });
      expect(real.ok).toBe(true);
    },
  );

  it('When the approval is presented for a different tool, then it is refused', async () => {
    const { fx, requestId } = await approvedWrite(createWrapperFixture(), { target: 'x' });
    const wrong = await fx.wrapper.call(alice, 'boom_write', {
      target: 'x',
      approvalRequestId: requestId,
    });
    expect(!wrong.ok && wrong.error.code).toBe('approval_invalid');
  });

  it('When the approval is one millisecond past five minutes old, then it is refused; at exactly five minutes it is accepted', async () => {
    const late = await approvedWrite();
    late.fx.clock.tick(APPROVAL_TTL_MS + 1);
    const refused = await late.fx.wrapper.call(alice, 'change_thing', {
      ...target,
      approvalRequestId: late.requestId,
    });
    expect(!refused.ok && refused.error.code).toBe('approval_invalid');

    const edge = await approvedWrite();
    edge.fx.clock.tick(APPROVAL_TTL_MS);
    const accepted = await edge.fx.wrapper.call(alice, 'change_thing', {
      ...target,
      approvalRequestId: edge.requestId,
    });
    expect(accepted.ok).toBe(true);
  });

  it('When the write fails after approval, then the outcome is recorded as an error and the approval is spent', async () => {
    const fx = createWrapperFixture();
    const first = await fx.wrapper.call(alice, 'boom_write', { target: 'x' });
    const requestId = !first.ok ? (first.error.requestId ?? '') : '';
    fx.approvals.approve(requestId);
    const failed = await fx.wrapper.call(alice, 'boom_write', {
      target: 'x',
      approvalRequestId: requestId,
    });
    expect(!failed.ok && failed.error.code).toBe('internal_error');
    expect(fx.sink.records().map((r) => [r.phase, r.outcome])).toEqual([
      ['complete', 'refused'],
      ['intent', 'pending'],
      ['outcome', 'error'],
    ]);
    const again = await fx.wrapper.call(alice, 'boom_write', {
      target: 'x',
      approvalRequestId: requestId,
    });
    expect(!again.ok && again.error.code).toBe('approval_invalid');
  });

  it('When the approval service reports too many open requests, then the write is refused with that defined error and one record', async () => {
    // The 3-writes-a-minute limit keeps one client under 20 open requests (15 in the 5-minute
    // lifetime), so the bound is a second line of defence; here the service is made to hit it.
    const fx = createWrapperFixture();
    vi.spyOn(fx.approvals, 'request').mockImplementation(() => {
      throw new GuardrailError('approval_limit');
    });
    const result = await fx.wrapper.call(alice, 'change_thing', target);
    expect(!result.ok && result.error.code).toBe('approval_limit');
    expect(fx.sink.records()).toMatchObject([{ outcome: 'refused', phase: 'complete' }]);
  });
});

describe('Given a write tool declares a precondition', () => {
  const args = { target: 'thing-1' };

  it('When the action cannot succeed, then no approval request is created, one refused record is written, and the handler is not called', async () => {
    const fx = createWrapperFixture();
    fx.precondition.mode = 'defined_error';
    const result = await fx.wrapper.call(alice, 'guarded_write', args);
    expect(!result.ok && result.error.code).toBe('job_not_failed');
    expect(!result.ok && result.error.requestId).toBeUndefined();
    expect(fx.approvals.listPending()).toEqual([]);
    expect(fx.sink.records()).toMatchObject([{ phase: 'complete', outcome: 'refused' }]);
    expect(fx.calls.write).toBe(0);
  });

  it('When the action can succeed, then the human is asked as usual', async () => {
    const fx = createWrapperFixture();
    const result = await fx.wrapper.call(alice, 'guarded_write', args);
    expect(!result.ok && result.error.code).toBe('approval_required');
    expect(fx.calls.precondition).toBe(1);
    expect(fx.approvals.listPending()).toHaveLength(1);
  });

  it('When the situation changes after approval, then the check runs again, the write is refused, and the approval is not burned', async () => {
    const fx = createWrapperFixture();
    const first = await fx.wrapper.call(alice, 'guarded_write', args);
    const requestId = !first.ok ? (first.error.requestId ?? '') : '';
    fx.approvals.approve(requestId);
    fx.precondition.mode = 'defined_error';
    const refused = await fx.wrapper.call(alice, 'guarded_write', {
      ...args,
      approvalRequestId: requestId,
    });
    expect(!refused.ok && refused.error.code).toBe('job_not_failed');
    expect(fx.calls.write).toBe(0);
    expect(fx.sink.records().map((r) => r.phase)).toEqual(['complete', 'complete']);

    fx.precondition.mode = 'ok';
    const done = await fx.wrapper.call(alice, 'guarded_write', {
      ...args,
      approvalRequestId: requestId,
    });
    expect(done.ok).toBe(true);
  });

  it('When the check itself fails unexpectedly, then the client gets a generic error, the detail is only logged, and nothing is requested', async () => {
    const fx = createWrapperFixture();
    fx.precondition.mode = 'unexpected_error';
    const result = await fx.wrapper.call(alice, 'guarded_write', args);
    expect(!result.ok && result.error.code).toBe('internal_error');
    expect(JSON.stringify(result)).not.toContain('/secret/path');
    expect(fx.logged().find((l) => l.msg === 'tool.error')).toMatchObject({
      tool: 'guarded_write',
    });
    expect(fx.sink.records()).toMatchObject([{ outcome: 'error', phase: 'complete' }]);
    expect(fx.approvals.listPending()).toEqual([]);
  });

  it('When input is invalid, then validation still comes first and the check does not run', async () => {
    const fx = createWrapperFixture();
    await fx.wrapper.call(alice, 'guarded_write', { target: 5 });
    expect(fx.calls.precondition).toBe(0);
  });
});

describe('Given the server is shutting down', () => {
  it('When a call is in flight, then it is counted until its audit record is written, and drain waits for it', async () => {
    const fx = createWrapperFixture();
    const call = fx.wrapper.call(alice, 'slow_read', {});
    await Promise.resolve();
    expect(fx.wrapper.inFlight).toBe(1);
    let drained = false;
    void fx.wrapper.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    fx.gate.open();
    const result = await call;
    await Promise.resolve();
    expect(result.ok).toBe(true);
    expect(fx.sink.records()).toHaveLength(1);
    expect(fx.wrapper.inFlight).toBe(0);
    expect(drained).toBe(true);
  });

  it('When nothing is in flight, then drain resolves at once', async () => {
    const fx = createWrapperFixture();
    await expect(fx.wrapper.drain()).resolves.toBeUndefined();
  });

  it('When shutdown has begun, then new calls are refused and recorded, and no handler runs', async () => {
    const fx = createWrapperFixture();
    fx.wrapper.beginShutdown();
    const result = await fx.wrapper.call(alice, 'echo_read', { text: 'late' });
    expect(!result.ok && result.error.code).toBe('shutting_down');
    expect(fx.sink.records()).toMatchObject([{ outcome: 'refused', phase: 'complete' }]);
    expect(fx.calls.read).toBe(0);
    expect(fx.wrapper.inFlight).toBe(0);
  });

  it('When shutdown begins, then a call already in flight still finishes and is audited', async () => {
    const fx = createWrapperFixture();
    const call = fx.wrapper.call(alice, 'slow_read', {});
    await Promise.resolve();
    fx.wrapper.beginShutdown();
    fx.gate.open();
    expect((await call).ok).toBe(true);
    expect(fx.sink.records()).toMatchObject([{ outcome: 'allowed' }]);
  });
});

describe('Given a message is too large to be read', () => {
  it('When it is rejected, then one invalid record is written under its own call ID and no handler runs', async () => {
    const fx = createWrapperFixture();
    const result = await fx.wrapper.rejectOversized(alice, 70_000);
    expect(!result.ok && result.error.code).toBe('message_too_large');
    expect(fx.sink.records()).toEqual([
      expect.objectContaining({
        callId: result.callId,
        phase: 'complete',
        tool: '(oversized message)',
        client: 'alice',
        outcome: 'invalid',
        inputs: { _omitted: 'message too large', bytes: 70_000 },
      }),
    ]);
    expect(fx.calls).toMatchObject({ read: 0, write: 0 });
  });

  it('When a client floods oversized messages, then they are rate-limited like reads', async () => {
    const fx = createWrapperFixture();
    for (let i = 0; i < 30; i += 1) await fx.wrapper.rejectOversized(alice, 70_000);
    const limited = await fx.wrapper.rejectOversized(alice, 70_000);
    expect(!limited.ok && limited.error.code).toBe('rate_limited');
    expect(fx.sink.records().at(-1)).toMatchObject({ outcome: 'rate-limited' });
  });

  it('When the sender is unknown or the server is shutting down, then the message is refused and recorded', async () => {
    const fx = createWrapperFixture();
    const unknown = await fx.wrapper.rejectOversized({ name: '' }, 70_000);
    expect(!unknown.ok && unknown.error.code).toBe('unidentified_client');
    fx.wrapper.beginShutdown();
    const late = await fx.wrapper.rejectOversized(alice, 70_000);
    expect(!late.ok && late.error.code).toBe('shutting_down');
  });

  it('When the audit file cannot be written, then the rejection is still returned, flagged', async () => {
    const fx = createWrapperFixture();
    fx.sink.failWith = new Error('disk full');
    const result = await fx.wrapper.rejectOversized(alice, 70_000);
    expect(result).toMatchObject({ ok: false, auditFailure: true });
  });
});

describe('Given five clients call at the same time', () => {
  it('When they share the real wrapper and audit writer, then line and call-ID counts agree', async () => {
    const fx = createWrapperFixture();
    const clients = ['c1', 'c2', 'c3', 'c4', 'c5'].map((name) => ({ name }));
    const results = await Promise.all(
      clients.flatMap((client) =>
        Array.from({ length: 6 }, (_, index) =>
          fx.wrapper.call(client, 'echo_read', { text: `m${index}` }),
        ),
      ),
    );
    const records = fx.sink.records();
    expect(results).toHaveLength(30);
    expect(records).toHaveLength(30);
    expect(new Set(records.map((r) => r.callId)).size).toBe(30);
    expect(new Set(results.map((r) => r.callId)).size).toBe(30);
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual(
        ['callId', 'client', 'inputs', 'outcome', 'phase', 'tool', 'ts'].sort(),
      );
    }
  });
});
