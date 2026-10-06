/**
 * Redactor (LC-10): removes secret-like keys, secret-shaped values and the exact
 * configured token values from audit records and log lines. Applied to every audit input
 * and log line so secrets never reach disk (NFR2.2, NFR2.4).
 *
 * Identifiers the design needs (`call_`/`req_`/`sess_` plus 26 base32 characters, and
 * `sha256:` plus 12 hex characters) are shorter than the 40-character run rule and so
 * survive by construction. A longer run that merely starts with `call_` is still redacted.
 */

export const REDACTED = '[REDACTED]';

const SECRET_KEY = /token|secret|password|authorization|api[-_]?key|credential/i;
// Ordered: block-shaped secrets first, then named token shapes, then generic long runs.
const SECRET_SHAPES: readonly { pattern: RegExp; replacement: string }[] = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replacement: REDACTED,
  },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: `Bearer ${REDACTED}` },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: REDACTED },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: REDACTED },
  // Base64url or hex runs of 40+ characters (API keys, hashes, generated tokens).
  { pattern: /[A-Za-z0-9_-]{40,}/g, replacement: REDACTED },
];

const MAX_DEPTH = 12;
const MIN_SECRET_LENGTH = 8;

export interface Redactor {
  /** Returns a deep copy of a JSON-like value with secrets replaced. */
  redact(value: unknown): unknown;
  /** Returns the text with secrets replaced. */
  redactText(text: string): string;
}

export interface RedactorOptions {
  /** Exact secret values (configured tokens) that must never appear in output. */
  readonly secrets?: readonly string[];
}

export function createRedactor(options: RedactorOptions = {}): Redactor {
  const secrets = (options.secrets ?? []).filter((secret) => secret.length >= MIN_SECRET_LENGTH);

  const redactText = (text: string): string => {
    const withoutExact = secrets.reduce(
      (current, secret) => current.split(secret).join(REDACTED),
      text,
    );
    return SECRET_SHAPES.reduce(
      (current, shape) => current.replace(shape.pattern, shape.replacement),
      withoutExact,
    );
  };

  const redact = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return redactText(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return REDACTED;
    if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  };

  return { redact: (value) => redact(value, 0), redactText };
}
