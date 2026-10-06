import { describe, expect, it } from 'vitest';
import { canonicalJson, displayDigest, sha256Hex } from '../../src/core/canonical-json.js';

describe('Given inputs that are hashed for the approval digest', () => {
  describe('And two objects hold the same data in a different key order', () => {
    it('When both are canonicalised, then the text and digest are identical', () => {
      const first = { repo: 'sample', nested: { b: 2, a: [3, { y: 1, x: 0 }] }, flag: true };
      const second = { flag: true, nested: { a: [3, { x: 0, y: 1 }], b: 2 }, repo: 'sample' };
      expect(canonicalJson(first)).toBe(canonicalJson(second));
      expect(sha256Hex(canonicalJson(first))).toBe(sha256Hex(canonicalJson(second)));
    });
  });

  describe('And two inputs differ in a value', () => {
    it('When both are canonicalised, then the digests differ', () => {
      expect(sha256Hex(canonicalJson({ job: 'a' }))).not.toBe(
        sha256Hex(canonicalJson({ job: 'b' })),
      );
    });

    it('When array order differs, then the digests differ', () => {
      expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    });
  });

  describe('And values need exact encoding', () => {
    it('When strings, null, numbers and omitted properties appear, then the output is plain JSON', () => {
      expect(canonicalJson({ s: 'a"b\n', n: null, i: 1.5, u: undefined })).toBe(
        '{"i":1.5,"n":null,"s":"a\\"b\\n"}',
      );
    });

    it.each([
      ['undefined in an array', [undefined]],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['a function', () => 1],
      ['a bigint', 10n],
      ['a symbol', Symbol('x')],
    ])('When %s is given, then it is refused', (_label, value) => {
      expect(() => canonicalJson(value)).toThrow(TypeError);
    });

    it('When the value contains a cycle, then it is refused', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => canonicalJson(cyclic)).toThrow(/cycle/);
    });
  });

  describe('And a digest is shown to the human', () => {
    it('When the SHA-256 of a known text is taken, then it matches the published value', () => {
      expect(sha256Hex('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('When the display form is built, then it is sha256: plus the first 12 hex characters', () => {
      expect(displayDigest(sha256Hex('abc'))).toBe('sha256:ba7816bf8f01');
    });
  });
});
