import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { safeString, strictObject, validateInput } from '../../src/core/validator.js';

const schema = strictObject({ repo: safeString(20), count: z.number().int().optional() });

describe('Given a tool input schema', () => {
  it('When the input matches, then the parsed value is returned', () => {
    expect(validateInput(schema, { repo: 'sample', count: 2 })).toEqual({
      ok: true,
      value: { repo: 'sample', count: 2 },
    });
  });

  it('When an unknown field is sent, then it is refused and only its name is reported', () => {
    expect(validateInput(schema, { repo: 'sample', extra: 'x' })).toEqual({
      ok: false,
      fields: ['extra'],
    });
  });

  it('When a field is missing or has the wrong type, then its name is reported once', () => {
    expect(validateInput(schema, { count: 'many' })).toEqual({
      ok: false,
      fields: ['count', 'repo'],
    });
  });

  it('When a string is too long, then it is refused rather than truncated', () => {
    expect(validateInput(schema, { repo: 'x'.repeat(21) })).toEqual({
      ok: false,
      fields: ['repo'],
    });
  });

  it.each(['line\nbreak', 'tab\there', 'esc\u001b[31m', 'nul\u0000', 'del\u007f'])(
    'When a string holds a control character (%j), then it is refused',
    (repo) => {
      expect(validateInput(schema, { repo })).toEqual({ ok: false, fields: ['repo'] });
    },
  );

  it('When the input is not an object, then the whole input is reported', () => {
    expect(validateInput(schema, 'text')).toEqual({ ok: false, fields: ['(input)'] });
  });

  it('When an unknown field has an odd name, then the name is not echoed back', () => {
    const odd = 'token ghp_secretvalue-with spaces';
    const result = validateInput(schema, { repo: 'ok', [odd]: 1 });
    expect(result).toEqual({ ok: false, fields: ['(invalid field name)'] });
  });
});
