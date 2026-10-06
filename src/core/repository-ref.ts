import { safeString } from './validator.js';

/**
 * Repository references (NFR1.6): a bundled snapshot name or a public GitHub `owner/name`.
 * URLs, credentials, paths and anything else are refused; a reference is never joined to a
 * file path. Whether an `owner/name` is really public is decided by GitHub itself, which
 * the live reader asks without credentials.
 */

export type RepositoryRef =
  | { readonly kind: 'snapshot'; readonly name: string }
  | { readonly kind: 'github'; readonly owner: string; readonly name: string };

const SNAPSHOT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const GITHUB_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

export function parseRepositoryRef(text: string): RepositoryRef | undefined {
  if (!text.includes('/')) {
    return SNAPSHOT_NAME.test(text) ? { kind: 'snapshot', name: text } : undefined;
  }
  const parts = text.split('/');
  const [owner, name] = parts;
  if (parts.length !== 2 || owner === undefined || name === undefined) return undefined;
  const valid = [owner, name].every(
    (segment) => GITHUB_SEGMENT.test(segment) && segment !== '.' && segment !== '..',
  );
  return valid ? { kind: 'github', owner, name } : undefined;
}

/** Zod field for a tool's `repo` argument. */
export function repositoryField() {
  return safeString(201).refine((value) => parseRepositoryRef(value) !== undefined, {
    message: 'not a snapshot name or owner/name',
  });
}
