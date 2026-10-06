import type { Rng } from './ports.js';

/** A new HTTP access token: `mgt_` plus 256 random bits as 43 base64url characters. */
export function generateToken(rng: Rng): string {
  return `mgt_${Buffer.from(rng.bytes(32)).toString('base64url')}`;
}
