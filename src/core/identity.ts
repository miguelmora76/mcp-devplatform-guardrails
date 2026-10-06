import type { IdSource, Rng } from './ports.js';

/**
 * Identifiers and client identity (LC-03). IDs are a fixed prefix plus 26 base32 characters
 * (130 bits), so the redactor can recognise and keep them (security-design.md).
 */

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const ID_CHARACTERS = 26;
const ID_BYTES = 17; // 136 bits, of which the first 130 are used

export const CALL_ID_PATTERN = /^call_[a-z2-7]{26}$/;
export const REQUEST_ID_PATTERN = /^req_[a-z2-7]{26}$/;
export const SESSION_ID_PATTERN = /^sess_[a-z2-7]{26}$/;

function base32Id(rng: Rng): string {
  const bytes = rng.bytes(ID_BYTES);
  let bits = 0;
  let accumulator = 0;
  let out = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < ID_CHARACTERS) {
      bits -= 5;
      out += BASE32[(accumulator >> bits) & 31] ?? '';
    }
    accumulator &= (1 << bits) - 1;
  }
  return out;
}

export function createIdSource(rng: Rng): IdSource {
  return {
    callId: () => `call_${base32Id(rng)}`,
    requestId: () => `req_${base32Id(rng)}`,
    sessionId: () => `sess_${base32Id(rng)}`,
  };
}

/** The caller of a tool: a random session in stdio mode, a token's name in HTTP mode. */
export interface ClientIdentity {
  readonly name: string;
}

export function sessionClient(ids: IdSource): ClientIdentity {
  return { name: ids.sessionId() };
}
