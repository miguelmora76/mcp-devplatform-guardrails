# Test Results

Run date 2026-10-05, development machine, Node v26.8.2, npm from the same install. No network was required.

## Build

- `npm run build` (`tsc -p tsconfig.build.json`): success, exit 0, no output.
- `npm run typecheck` (`tsc --noEmit`): exit 0. `npm run lint` (`eslint .`): exit 0. `npm run format:check` (`prettier --check .`): "All matched files use Prettier code style!"

## Tests

- Command: `npx vitest run --coverage`. Result: 34 test files passed (34), 494 tests passed (494), 0 failed, 0 skipped; exit 0. Three consecutive earlier runs were also stable.
- Integration subset: `npx vitest run test/e2e`: 4 files, 28 tests passed.
- Double counting: unit and integration specs are in one suite; the 494 total includes both and is not added to the subset.

## Coverage

| Scope | Lines | Branches |
|-------|-------|----------|
| All files | 99.48% (1162/1168) | 94.98% (625/658) |
| `src/guardrails/**` (admin-channel, admin-client, approval, audit, rate-limiter, wrapper) | 100% (407/407) | 100% (199/199) |

The thresholds in `vitest.config.ts` (90% lines overall; 100% lines and branches on `src/guardrails/**`) were not changed; the run exits 0. Lowest-covered non-gating files: `src/transport/http.ts` 96.3% lines, `src/tools/triage-ci-failure.ts` 97.4% lines, `src/walkthrough.ts` 64.3% branches.

## Benchmark (`npm run bench`, real timers, bundled snapshots, no network)

| Case | n | p50 ms | p95 ms | max ms |
|------|---|--------|--------|--------|
| triage_ci_failure (read) | 100 | 0.05 | 0.11 | 0.29 |
| plan_dependency_upgrades (read) | 100 | 0.04 | 0.12 | 1.72 |
| get_ci_job (read) | 100 | 0.02 | 0.05 | 0.20 |
| rerun_ci_job (write path, 2 calls each) | 200 | 0.68 | 4.23 | 8.13 |
| noop through the wrapper (guardrail overhead) | 1000 | 0.02 | 0.03 | 0.17 |

"All targets met."

## Walkthrough (`npm run walkthrough`)

Exit 0; printed the five sections: upgrade plan (4 outdated, ordered, advisories listed), triage of `run-1001` (test failure, failing step quoted), a write refused without approval with the simulated CI unchanged, the 31st read rate-limited, and the audit record (35 lines, one call ID per call).

## Security checks run

- `npm audit --omit=dev`: found 0 vulnerabilities.
- All `uses:` lines in `.github/` are pinned to 40-character SHAs (grep found no exception).
- Runtime dependencies: `@modelcontextprotocol/sdk`, `zod`.
- Read-only GitHub queries (no changes made): repository is public; default branch is `ideation-records` (no `main`); secret scanning, push protection and Dependabot security updates are `disabled`; private vulnerability reporting is `enabled: false`; no branch protection (404).

## Not run

- `gitleaks` (not installed), the GitHub Actions workflows, CodeQL, and a clean-machine run of the README steps.

## Target outcome

Nine applicable targets are `Not Met` or `Unverified`; see the Target Verification Matrix in `build-and-test-summary.md`. The stage is recorded as failed for that reason.

## Re-run after loop-back 1 (2026-10-05, working tree after the repair pass)

- Build, `tsc --noEmit`, `eslint .`, `prettier --check .`: all clean. `npx vitest run --coverage`: 38 files, 576 tests passed, 0 failed, 0 skipped. The same suite passed under Node 24.21.0 (`npx -y node@24`).
- Coverage: all files lines 99.37% (1441/1450), branches 94.77%; `src/guardrails/**` lines 417/417 and branches 203/203 (100% each); thresholds unchanged.
- Benchmark: reads p95 0.05-0.11 ms (max 1.46 ms), write path p95 4.10 ms (max 7.88 ms), overhead p95 0.03 ms; all targets met.
- `npm audit --omit=dev`: 0 vulnerabilities. All `uses:` pinned to 40-character SHAs. Walkthrough: five sections printed.
- Read-only GitHub queries (unchanged since the first run): secret scanning and push protection `disabled`, private vulnerability reporting `false`, only branch on the remote is `ideation-records` (no `main`).
- Matrix change: T06, T16, T17, T18 are now `Met`; T11-T15 are unchanged (`Not Met` or `Unverified`).

## Loop-Back Log

### Loop-back 1 — 2026-10-05T23:39:01Z

- Diagnosis: two code defects (T17 live-mode names unsanitised, T18 silent stdio oversize drop) plus smaller review findings (R-03 `approve` shows the wrong mode, R-05 coverage exclusion reason, R-06 weak traceability rows NFR8.6 and NFR1.1, R-07 live response size checked after reading the whole body) and the Node pin (T16). T11-T15 (CodeQL run, SECURITY/secret scanning settings, branch protection, clean-machine run) are repository actions, not code, and are not fixed by this loop-back.
- Root-cause stage: code-generation.
- Planned fix: sanitise and cap live workflow, job and step names with a spec; give an oversize stdio message a defined refusal, a log line and an audit record with a spec; make `approve` report the real mode; narrow or correct the `src/bin/**` coverage exclusion reason; stream-limit live response bodies; pin Node 24 consistently (`.nvmrc`, `engines`, `@types/node` 24.x, CI reads `.nvmrc`); strengthen the NFR8.6 and NFR1.1 traceability targets. No threshold is lowered.
- Estimated impact: effort one developer pass plus re-review; financial cost none; risk low (small, test-first changes; guardrail coverage stays at 100%). Node 24 is not installed locally, so the Node pin is first verified in CI.
