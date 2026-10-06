import { describe, expect, it } from 'vitest';
import {
  CALL_ID_PATTERN,
  REQUEST_ID_PATTERN,
  SESSION_ID_PATTERN,
  createIdSource,
  sessionClient,
} from '../../src/core/identity.js';
import { FakeIdSource, FakeRng } from '../support/fakes.js';

describe('Given identifiers come from the injected random source', () => {
  it('When IDs are generated, then each has its prefix and 26 base32 characters', () => {
    const ids = createIdSource(new FakeRng());
    expect(ids.callId()).toMatch(CALL_ID_PATTERN);
    expect(ids.requestId()).toMatch(REQUEST_ID_PATTERN);
    expect(ids.sessionId()).toMatch(SESSION_ID_PATTERN);
  });

  it('When two sources use the same random sequence, then they give the exact same IDs', () => {
    const first = createIdSource(new FakeRng());
    const second = createIdSource(new FakeRng());
    expect(first.callId()).toBe(second.callId());
    expect(first.callId()).toBe(second.callId());
  });

  it('When the random bytes differ, then the IDs differ', () => {
    const ids = createIdSource(new FakeRng());
    expect(ids.callId()).not.toBe(ids.callId());
  });

  it('When a stdio client is identified, then its name is a fresh session ID', () => {
    const ids = new FakeIdSource();
    expect(sessionClient(ids).name).toMatch(SESSION_ID_PATTERN);
    expect(sessionClient(ids).name).not.toBe(sessionClient(ids).name);
  });
});
