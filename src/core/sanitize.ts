/**
 * Untrusted outside text (NFR1.2): CI logs, changelogs and advisory text are only ever
 * placed into result fields as quoted data. This strips what could disguise or reshape
 * that data (ANSI sequences, control characters) and caps its length. Nothing here
 * interprets the text.
 */

export const MAX_EXCERPT_LENGTH = 2048;

const ANSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export function sanitizeUntrustedText(
  text: string,
  maxLength: number = MAX_EXCERPT_LENGTH,
): string {
  const cleaned = text.replace(ANSI_SEQUENCE, '').replace(CONTROL_CHARACTERS, '');
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/** Longest workflow, job, step or branch name placed in a result. */
export const MAX_NAME_LENGTH = 120;

/**
 * A name that came from outside (a workflow, job, step or branch name): sanitised like any
 * untrusted text, with whitespace runs (including newlines and tabs) collapsed to one
 * space, and capped. It is only ever shown as data.
 */
export function sanitizeUntrustedName(text: string): string {
  return sanitizeUntrustedText(text.replace(/\s+/g, ' ').trim(), MAX_NAME_LENGTH);
}
