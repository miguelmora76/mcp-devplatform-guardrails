import { defineConfig } from 'vitest/config';

/**
 * Files excluded from coverage, each with the reason it is excluded (NFR3.3).
 * A threshold may never be met by adding an entry here without a reason; review
 * every change to this list.
 */
const coverageExclusions: readonly { readonly path: string; readonly reason: string }[] = [
  {
    path: 'src/bin/**',
    reason:
      'Process entry points only (server, approve, new-token, walkthrough, bench): each hands process globals (arguments, environment, signals, the terminal device, the exit code, real timers) to a function in src/ that has its own specs (serve, runApprove, generateToken, runWalkthrough, runBench) and prints the result. No decision logic lives in them.',
  },
];

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: coverageExclusions.map((entry) => entry.path),
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        // Overall floor (NFR3.1).
        lines: 90,
        // Guardrail code: approval gate, audit log, rate limiter, wrapper, admin channel (NFR3.2).
        'src/guardrails/**': { lines: 100, branches: 100 },
      },
    },
  },
});
