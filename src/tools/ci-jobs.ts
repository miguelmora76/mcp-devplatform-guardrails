import { defineTool, type Tool } from '../core/tool-types.js';
import { safeString } from '../core/validator.js';
import { GuardrailError } from '../core/errors.js';
import type { SimulatedCi } from '../data/simulated-ci.js';

/**
 * get_ci_job (read) and rerun_ci_job (write) over the simulated CI system. The write is
 * the only state-changing tool; it is declared `write`, so the wrapper will not run it
 * without a human approval bound to exactly these arguments (FR4.1-4.4).
 */

const shape = {
  repo: safeString(100),
  jobId: safeString(64),
};

export function createGetCiJobTool(ci: SimulatedCi): Tool {
  return defineTool({
    name: 'get_ci_job',
    description:
      'Read-only. Shows the current status and attempt number of a job in the simulated CI system.',
    kind: 'read',
    shape,
    handler: (input) => {
      const job = ci.get(input.repo, input.jobId);
      if (job === undefined) {
        return Promise.reject(new GuardrailError('not_found', 'The job was not found.'));
      }
      return Promise.resolve(job);
    },
  });
}

export function createRerunCiJobTool(ci: SimulatedCi): Tool {
  return defineTool({
    name: 'rerun_ci_job',
    description:
      'Changes state: re-runs a failed job in the simulated CI system only (never a real CI service). Needs a human approval: the first call returns approval_required with a requestId; after the person runs the approve command, call again with approvalRequestId.',
    kind: 'write',
    shape,
    // Checked before a human is asked, so nobody approves a re-run that cannot happen.
    precondition: (input) => {
      ci.assertRerunnable(input.repo, input.jobId);
      return Promise.resolve();
    },
    handler: (input) => Promise.resolve(ci.rerun(input.repo, input.jobId)),
  });
}
