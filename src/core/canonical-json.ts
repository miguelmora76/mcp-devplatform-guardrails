import { createHash } from 'node:crypto';

/**
 * Canonical JSON for the approval digest (NFR2.1, NFR1.3): object keys are sorted, no
 * whitespace, properties set to `undefined` are omitted, and anything JSON cannot
 * represent exactly (NaN, Infinity, functions, bigint, symbols, cycles, undefined array
 * items) is refused. Two inputs with the same data therefore always give the same text.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set<object>());
}

function encode(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object':
      return encodeObject(value, ancestors);
    default:
      throw new TypeError(`canonicalJson: cannot encode ${typeof value}`);
  }
}

function encodeObject(value: object, ancestors: Set<object>): string {
  if (ancestors.has(value)) throw new TypeError('canonicalJson: cycle detected');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => encode(item, ancestors)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${encode(record[key], ancestors)}`);
    return `{${parts.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Full SHA-256 of a text, as lower-case hex. Approvals bind to the full digest. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The form shown to people and written to logs: `sha256:` plus the first 12 hex characters. */
export function displayDigest(fullHex: string): string {
  return `sha256:${fullHex.slice(0, 12)}`;
}
