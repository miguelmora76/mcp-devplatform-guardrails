/**
 * Defined errors (NFR1.7). Every failure the client can see is a `{code, message}` pair
 * with a fixed message per code. Stack traces, paths and causes never reach the client;
 * they go to the operational log only (redacted).
 */

export const ERROR_MESSAGES = {
  unidentified_client: 'The caller could not be identified.',
  invalid_input: 'The input was rejected by validation.',
  unknown_tool: 'There is no tool with that name.',
  not_found: 'The requested snapshot, repository or run was not found.',
  too_large: 'The document is larger than the 5 MiB limit and was not read.',
  snapshot_invalid: 'The snapshot data could not be read.',
  run_not_failed: 'The run did not fail, so there is nothing to triage.',
  rate_limited: 'Too many calls from this client. Wait for the window to pass and try again.',
  approval_required:
    'This tool changes state and needs a human approval. Ask the person to run the approve command, then call again with approvalRequestId.',
  approval_invalid: 'The approval is missing, expired, already used, or does not match this call.',
  approval_limit: 'Too many approval requests are open for this client. Wait for them to expire.',
  audit_unavailable: 'The audit log is unavailable, so this change was refused.',
  job_not_failed: 'Only a failed job can be re-run.',
  live_unavailable: 'Live GitHub reading failed.',
  message_too_large: 'The message was larger than 64 KiB and was dropped without being read.',
  shutting_down: 'The server is shutting down and is not accepting new calls.',
  internal_error: 'The tool failed unexpectedly. The failure was logged.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ClientError {
  readonly code: ErrorCode;
  readonly message: string;
  /** Present on `approval_required`: the reference the human approves and the agent presents. */
  readonly requestId?: string;
}

/**
 * An error that is safe to show a client. `detail` must be text the server chose (a field
 * name, a snapshot name from the fixed list), never text copied from input or outside data.
 */
export class GuardrailError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
  ) {
    super(detail === undefined ? ERROR_MESSAGES[code] : `${ERROR_MESSAGES[code]} ${detail}`);
    this.name = 'GuardrailError';
  }
}

/** Maps any thrown value to the error a client may see. */
export function toClientError(error: unknown): ClientError {
  if (error instanceof GuardrailError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'internal_error', message: ERROR_MESSAGES.internal_error };
}

/** Internal detail for the operational log only (never shown to a client). */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'non-error value thrown';
}
