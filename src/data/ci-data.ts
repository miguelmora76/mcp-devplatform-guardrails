import { z } from 'zod';

/**
 * Shape of the bundled CI-run snapshots (`snapshots/<name>/ci-runs.json`). The data is
 * synthetic and labelled as such. Log lines are untrusted text: they are only ever quoted.
 */

const conclusion = z.enum(['success', 'failure', 'skipped']);

export const ciStepSchema = z.object({
  name: z.string(),
  conclusion,
  log: z.array(z.string()).default([]),
});

export const ciJobSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  conclusion,
  steps: z.array(ciStepSchema),
});

export const ciRunSchema = z.object({
  runId: z.string(),
  workflow: z.string(),
  branch: z.string(),
  commit: z.string(),
  startedAt: z.string(),
  conclusion: z.enum(['success', 'failure']),
  jobs: z.array(ciJobSchema),
});

export const ciRunsDocumentSchema = z.object({
  snapshot: z.string(),
  synthetic: z.literal(true),
  runs: z.array(ciRunSchema),
});

export type CiStep = z.infer<typeof ciStepSchema>;
export type CiJob = z.infer<typeof ciJobSchema>;
export type CiRun = z.infer<typeof ciRunSchema>;
export type CiRunsDocument = z.infer<typeof ciRunsDocumentSchema>;
