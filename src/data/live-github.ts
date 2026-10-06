import { z } from 'zod';
import { GuardrailError } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import type { Clock, Net, Rng, Scheduler } from '../core/ports.js';
import { sanitizeUntrustedName } from '../core/sanitize.js';
import type { CiJob, CiRun, CiStep } from './ci-data.js';
import { MAX_DOCUMENT_BYTES } from './snapshot-store.js';

/**
 * Live GitHub reader (LC-14), optional and off by default (FR3.1, FR3.3). Read-only and
 * unauthenticated: no Authorization header is ever sent, only api.github.com and
 * github.com over HTTPS are contacted, and redirects are never followed (so raw CI log
 * downloads, which redirect, are not available live; logs come from snapshots).
 *
 * Each request times out after 10 s. Transient failures (no answer, connection errors,
 * HTTP 429 and 5xx) are retried up to 3 times after waits of about 1 s, 2 s and 4 s plus
 * jitter; a Retry-After of at most 30 s is waited out, a longer one ends the call. One
 * call never runs past its overall deadline (120 s). Failures never alter the audit
 * guarantees and never trigger a write (NFR1.6, NFR4.5, NFR4.6).
 */

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_RETRIES = 3;
export const MAX_RETRY_AFTER_SECONDS = 30;
export const DEFAULT_DEADLINE_MS = 120_000;
const BASE_WAIT_MS = 1000;
const JITTER_MS = 250;
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com']);

export interface LiveGitHubOptions {
  readonly net: Net;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly logger: Logger;
  readonly deadlineMs?: number;
}

type Attempt =
  | { readonly kind: 'ok'; readonly value: unknown }
  | { readonly kind: 'fatal'; readonly error: GuardrailError }
  | { readonly kind: 'retry'; readonly reason: string; readonly retryAfterMs?: number };

export class LiveGitHubReader {
  private readonly deadlineMs: number;

  constructor(private readonly options: LiveGitHubOptions) {
    this.deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  }

  /** GETs JSON from an allowed address (a path on api.github.com, or an https github.com URL). */
  async getJson(target: string): Promise<unknown> {
    const url = this.resolve(target);
    const { scheduler, clock, logger } = this.options;
    const started = clock.now();
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await this.attempt(url);
      if (outcome.kind === 'ok') return outcome.value;
      if (outcome.kind === 'fatal') throw outcome.error;

      if (attempt >= MAX_RETRIES) {
        logger.error('live.failed', { host: url.hostname, reason: outcome.reason });
        throw new GuardrailError(
          'live_unavailable',
          `GitHub did not answer (${outcome.reason}) after ${attempt + 1} attempts.`,
        );
      }
      const wait = outcome.retryAfterMs ?? this.backoff(attempt);
      if (clock.now() - started + wait > this.deadlineMs) {
        logger.error('live.failed', { host: url.hostname, reason: 'deadline' });
        throw new GuardrailError('live_unavailable', 'The call ran past its overall time limit.');
      }
      logger.warn('live.retry', {
        host: url.hostname,
        attempt: attempt + 1,
        reason: outcome.reason,
      });
      await scheduler.delay(wait);
    }
  }

  /** Reads one public workflow run and its jobs as a CI run (steps carry no log lines). */
  async getRun(owner: string, name: string, runId: string): Promise<CiRun> {
    if (!/^\d{1,20}$/.test(runId)) {
      throw new GuardrailError('invalid_input', 'Live run IDs are numbers.');
    }
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs/${runId}`;
    const run = githubRunSchema.safeParse(await this.getJson(base));
    const jobs = githubJobsSchema.safeParse(await this.getJson(`${base}/jobs`));
    if (!run.success || !jobs.success) {
      throw new GuardrailError('live_unavailable', 'GitHub answered with an unexpected shape.');
    }
    return {
      runId: String(run.data.id),
      workflow: sanitizeUntrustedName(run.data.name ?? 'workflow'),
      branch: sanitizeUntrustedName(run.data.head_branch ?? ''),
      commit: sanitizeUntrustedName(run.data.head_sha.slice(0, 7)),
      startedAt: sanitizeUntrustedName(run.data.created_at),
      conclusion: runConclusion(run.data.conclusion),
      jobs: jobs.data.jobs.map(toJob),
    };
  }

  private resolve(target: string): URL {
    try {
      const url = new URL(target, 'https://api.github.com');
      if (
        url.protocol === 'https:' &&
        ALLOWED_HOSTS.has(url.hostname) &&
        url.username === '' &&
        url.password === ''
      ) {
        return url;
      }
    } catch {
      // Falls through to the same refusal as a disallowed address.
    }
    throw new GuardrailError('live_unavailable', 'That address is not an allowed GitHub address.');
  }

  private backoff(attempt: number): number {
    return BASE_WAIT_MS * 2 ** attempt + this.options.rng.float() * JITTER_MS;
  }

  private async attempt(url: URL): Promise<Attempt> {
    const controller = new AbortController();
    const timer = this.options.scheduler.after(REQUEST_TIMEOUT_MS, () => {
      controller.abort();
    });
    try {
      const response = await this.options.net.fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'mcp-devplatform-guardrails',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
      return await this.classify(response);
    } catch {
      return { kind: 'retry', reason: 'no answer' };
    } finally {
      timer.cancel();
    }
  }

  private async classify(response: Response): Promise<Attempt> {
    const { status } = response;
    if (status >= 200 && status < 300) return this.parseBody(response);
    if (status >= 300 && status < 400) {
      return {
        kind: 'fatal',
        error: new GuardrailError(
          'live_unavailable',
          'GitHub redirected the request, which is not followed.',
        ),
      };
    }
    if (status === 404) {
      return {
        kind: 'fatal',
        error: new GuardrailError('not_found', 'GitHub has no such public repository or run.'),
      };
    }
    if (status === 429 || status >= 500) {
      const seconds = retryAfterSeconds(response);
      if (seconds !== undefined && seconds > MAX_RETRY_AFTER_SECONDS) {
        return {
          kind: 'fatal',
          error: new GuardrailError(
            'live_unavailable',
            'GitHub asked to wait more than 30 seconds.',
          ),
        };
      }
      return {
        kind: 'retry',
        reason: `HTTP ${status}`,
        ...(seconds === undefined ? {} : { retryAfterMs: seconds * 1000 }),
      };
    }
    return {
      kind: 'fatal',
      error: new GuardrailError('live_unavailable', `GitHub answered HTTP ${status}.`),
    };
  }

  private async parseBody(response: Response): Promise<Attempt> {
    const tooLarge: Attempt = { kind: 'fatal', error: new GuardrailError('too_large') };
    // Check the declared length first, then count bytes as the body streams (NFR1.11).
    const declared = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) return tooLarge;

    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = response.body?.getReader();
    while (reader !== undefined) {
      const part = await reader.read();
      if (part.done) break;
      const value = part.value as Uint8Array;
      received += value.length;
      if (received > MAX_DOCUMENT_BYTES) {
        await reader.cancel();
        return tooLarge;
      }
      chunks.push(value);
    }
    try {
      return { kind: 'ok', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    } catch {
      return {
        kind: 'fatal',
        error: new GuardrailError(
          'live_unavailable',
          'GitHub answered with something that is not JSON.',
        ),
      };
    }
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('Retry-After');
  return header !== null && /^\d{1,6}$/.test(header) ? Number(header) : undefined;
}

const githubRunSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string().nullish(),
  head_branch: z.string().nullish(),
  head_sha: z.string(),
  created_at: z.string(),
  conclusion: z.string().nullish(),
});

const githubJobsSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      name: z.string(),
      conclusion: z.string().nullish(),
      steps: z.array(z.object({ name: z.string(), conclusion: z.string().nullish() })).default([]),
    }),
  ),
});

function stepConclusion(value: string | null | undefined): CiStep['conclusion'] {
  if (value === 'success') return 'success';
  return value === 'failure' || value === 'timed_out' ? 'failure' : 'skipped';
}

function runConclusion(value: string | null | undefined): CiRun['conclusion'] {
  return value === 'failure' || value === 'timed_out' ? 'failure' : 'success';
}

function toJob(job: z.infer<typeof githubJobsSchema>['jobs'][number]): CiJob {
  return {
    jobId: String(job.id),
    name: sanitizeUntrustedName(job.name),
    conclusion: stepConclusion(job.conclusion),
    steps: job.steps.map((step) => ({
      name: sanitizeUntrustedName(step.name),
      conclusion: stepConclusion(step.conclusion),
      log: [],
    })),
  };
}
