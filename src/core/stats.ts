/** Timing statistics and the performance targets of NFR8.1-NFR8.3 (used by `npm run bench`). */

export const TARGETS = { readP95Ms: 1000, maxMs: 5000, overheadP95Ms: 50 } as const;

export interface Summary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/** Nearest-rank percentile of the samples. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error('percentile of no samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export function summarise(samples: readonly number[]): Summary {
  return {
    count: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: percentile(samples, 100),
  };
}

/**
 * Returns the targets a measurement misses. `read` covers the read and write paths
 * (p95 <= 1 s, max <= 5 s); `overhead` is the guardrail overhead (p95 <= 50 ms).
 */
export function evaluateTargets(kind: 'read' | 'overhead', summary: Summary): string[] {
  const misses: string[] = [];
  if (kind === 'overhead') {
    if (summary.p95 > TARGETS.overheadP95Ms) {
      misses.push(`p95 ${summary.p95.toFixed(2)} ms is over ${TARGETS.overheadP95Ms} ms`);
    }
    return misses;
  }
  if (summary.p95 > TARGETS.readP95Ms) {
    misses.push(`p95 ${summary.p95.toFixed(2)} ms is over ${TARGETS.readP95Ms} ms`);
  }
  if (summary.max > TARGETS.maxMs) {
    misses.push(`max ${summary.max.toFixed(2)} ms is over ${TARGETS.maxMs} ms`);
  }
  return misses;
}
