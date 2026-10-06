import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config.js';
import { createRedactor } from '../../src/core/redactor.js';
import { generateToken } from '../../src/core/token.js';
import { FakeRng } from '../support/fakes.js';

describe('Given the new-token helper', () => {
  it('When a token is generated, then it starts with mgt_ and carries 256 bits in 43 base64url characters', () => {
    expect(generateToken(new FakeRng())).toMatch(/^mgt_[A-Za-z0-9_-]{43}$/);
  });

  it('When two tokens are generated from different random bytes, then they differ', () => {
    const rng = new FakeRng();
    expect(generateToken(rng)).not.toBe(generateToken(rng));
  });

  it('When a generated token is configured, then the config accepts it and the redactor removes it', () => {
    const token = generateToken(new FakeRng());
    expect(loadConfig({ GUARDRAILS_TOKENS: `agent=${token}` }).tokens).toEqual([
      { name: 'agent', token },
    ]);
    expect(createRedactor().redactText(`header ${token}`)).not.toContain(token);
  });
});
