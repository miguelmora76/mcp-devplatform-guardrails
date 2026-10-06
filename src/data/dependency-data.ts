import { z } from 'zod';

/**
 * Shape of the bundled dependency files of a sample repository. The data is synthetic and
 * labelled as such. Advisory text is untrusted: it is only ever sanitised and quoted.
 */

export const manifestSchema = z.object({
  synthetic: z.literal(true),
  name: z.string(),
  version: z.string(),
  dependencies: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

export const registrySchema = z.object({
  synthetic: z.literal(true),
  packages: z.record(z.string(), z.object({ versions: z.array(z.string()) })),
});

export const severitySchema = z.enum(['low', 'moderate', 'high', 'critical']);

export const advisoriesSchema = z.object({
  synthetic: z.literal(true),
  advisories: z.array(
    z.object({
      id: z.string(),
      package: z.string(),
      severity: severitySchema,
      summary: z.string(),
      /** Versions from `introduced` (inclusive) up to `fixed` (exclusive) are affected. */
      introduced: z.string(),
      fixed: z.string(),
    }),
  ),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Registry = z.infer<typeof registrySchema>;
export type Advisories = z.infer<typeof advisoriesSchema>;
export type Severity = z.infer<typeof severitySchema>;
