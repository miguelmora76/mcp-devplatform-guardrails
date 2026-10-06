import { describe, expect, it } from 'vitest';
import { createIdSource } from '../../src/core/identity.js';
import { createRedactor, REDACTED } from '../../src/core/redactor.js';
import { FakeRng } from '../support/fakes.js';

// Obviously fake, token-shaped values (never real credentials).
const fakeGithubToken = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
const fakeAwsKey = 'AKIAFAKEFAKEFAKE1234';
const fakeLongRun = 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LmNbVcXz12';
const configuredToken = 'mgt_TESTconfiguredtokenvalue0123';

describe('Given a redactor built with the configured token values', () => {
  const redactor = createRedactor({ secrets: [configuredToken, 'short'] });

  describe('When objects with secret-shaped keys are redacted', () => {
    it.each([
      'token',
      'apiToken',
      'client_secret',
      'Password',
      'Authorization',
      'api-key',
      'apiKey',
      'credentials',
    ])('Then the value of key %s is replaced', (key) => {
      expect(redactor.redact({ [key]: 'visible', other: 'kept' })).toEqual({
        [key]: REDACTED,
        other: 'kept',
      });
    });

    it('Then nested objects and arrays are walked and the input is not mutated', () => {
      const input = { list: [{ password: 'p', name: 'n' }], deep: { authorization: 'x' } };
      expect(redactor.redact(input)).toEqual({
        list: [{ password: REDACTED, name: 'n' }],
        deep: { authorization: REDACTED },
      });
      expect(input.list[0]?.password).toBe('p');
    });

    it('Then values that are not strings, arrays or objects pass through', () => {
      expect(redactor.redact({ n: 3, b: true, z: null })).toEqual({ n: 3, b: true, z: null });
    });

    it('Then data nested deeper than the safety limit is replaced', () => {
      let nested: unknown = 'leaf';
      for (let i = 0; i < 20; i += 1) nested = { next: nested };
      expect(JSON.stringify(redactor.redact(nested))).toContain(REDACTED);
    });
  });

  describe('When text holds secret-shaped values', () => {
    it.each([
      ['a GitHub token', `clone with ${fakeGithubToken} now`, fakeGithubToken],
      ['a Bearer value', 'Authorization failed: Bearer abc.def-123_xyz', 'abc.def-123_xyz'],
      ['an AWS-style key', `key=${fakeAwsKey}`, fakeAwsKey],
      ['a 40+ character run', `blob ${fakeLongRun} end`, fakeLongRun],
      ['a 64 character hex digest', `hash ${'ab12'.repeat(16)}`, 'ab12'.repeat(16)],
      ['a configured token', `used ${configuredToken} twice ${configuredToken}`, configuredToken],
      [
        'a private key block',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj\n-----END RSA PRIVATE KEY-----',
        'MIIBOgIBAAJBAKj',
      ],
    ])('Then %s is removed', (_label, text, secret) => {
      const redacted = redactor.redactText(text);
      expect(redacted).not.toContain(secret);
      expect(redacted).toContain(REDACTED);
    });

    it('Then secrets inside object values and array items are removed as well', () => {
      const out = JSON.stringify(redactor.redact({ note: [`x ${fakeGithubToken}`] }));
      expect(out).not.toContain(fakeGithubToken);
    });

    it('Then a secret shorter than 8 characters is not treated as a configured secret', () => {
      expect(redactor.redactText('this is short')).toBe('this is short');
    });
  });

  describe('When identifiers the design needs are redacted', () => {
    const ids = createIdSource(new FakeRng());

    it('Then call IDs, request IDs, session IDs and short digests survive', () => {
      const text = `${ids.callId()} ${ids.requestId()} ${ids.sessionId()} sha256:ba7816bf8f01`;
      expect(redactor.redactText(text)).toBe(text);
    });

    it('Then call_ followed by a long secret-like run is still redacted', () => {
      const text = `call_${fakeLongRun}${fakeLongRun}`;
      expect(redactor.redactText(text)).not.toContain(fakeLongRun);
    });
  });

  describe('When there is nothing secret', () => {
    it('Then ordinary text is unchanged', () => {
      expect(redactor.redactText('triage run-1001 of sample-node-api')).toBe(
        'triage run-1001 of sample-node-api',
      );
    });

    it('Then a redactor with no options works', () => {
      expect(createRedactor().redactText('hello')).toBe('hello');
    });
  });
});
