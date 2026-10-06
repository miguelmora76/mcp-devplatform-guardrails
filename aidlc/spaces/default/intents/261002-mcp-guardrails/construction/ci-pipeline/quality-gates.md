# Quality Gates

Scope: the whole server. These are the pass/fail rules the pipeline enforces before a pull request can merge into `main` [Q2 A]. Sources: `[TP]` = `aidlc/spaces/default/memory/team.md`, `project.md`; `[NFRx.y]` = `../nfr-requirements/`; `ci-config.md` for the jobs.

## Gates

| Gate | Criteria | Enforced by | Source |
|------|----------|-------------|--------|
| Formatting | `prettier --check .` reports no differences | Format check job | TP, NFR6.2 |
| Lint | `eslint .` exits 0 (includes the rule forbidding real timers and `Date.now`/`Math.random` outside `src/core/ports.ts`) | Lint job | TP, NFR6.3, NFR5.2 |
| Type check | `tsc --noEmit` exits 0 under strict mode | Type check job | TP, NFR6.1, NFR6.4 |
| Tests | All tests pass, offline | Tests and coverage job | NFR4, NFR5.1 |
| Overall coverage | At least 90% lines | Tests and coverage job (threshold in `vitest.config.ts`) | TP, NFR3.1 |
| Guardrail coverage | 100% lines and 100% branches on `src/guardrails/**` (wrapper, audit, rate limiter, approval, admin channel and client) | Tests and coverage job (per-path threshold) | TP, NFR3.2 |
| Build | `tsc -p tsconfig.build.json` exits 0 | Build job | NFR6 |
| Secrets | No findings in the full history with `.gitleaks.toml` | Secret scan job | TP, NFR2.3 |
| Static analysis | CodeQL finds no alerts at the repository's blocking severity | CodeQL job | TP, NFR7.4 |
| New dependencies | No newly introduced dependency with high or critical vulnerabilities | Dependency review job | TP, NFR7.3 |
| Lockfile | Installs use `npm ci` exactly; a manifest and lockfile mismatch fails | every job | NFR7.1 |
| Actions pinning | Every `uses:` is a full commit SHA (checked by review and by grep) | pull request review | TP, NFR7.2 |
| Branch protection | Pull request required, up-to-date branch, no force push or deletion, zero approvals | repository settings (not yet applied) | Q2 A |

Not a gate: the benchmark (`npm run bench`) is informational in CI and enforced locally (reads and writes p95 <= 1 s and max <= 5 s, overhead p95 <= 50 ms) [NFR8.1-8.3].

## Rules for the gates

- Gate thresholds are never lowered to make a run pass. A change to `vitest.config.ts` thresholds or to the exclusion list needs a stated reason and is reviewed like code (NFR3.3).
- A bypass of a gate is recorded as an exception with a reason in the pull request; none is configured.
- The commands behind the gates are the same ones Build and Test ran locally (`npm run build`, `typecheck`, `lint`, `format:check`, `test:coverage`), so a local pass predicts a CI pass.

## Status

- Locally verified (Build and Test, 2026-10-05): formatting, lint, type check, tests (576), coverage (99.37% lines overall; guardrails 417/417 lines and 203/203 branches), build, 0 known vulnerabilities in runtime dependencies, all actions pinned.
- Not yet verified: secret scan (gitleaks not installed locally), CodeQL, dependency review, and branch protection; all depend on the first pull request and the repository settings (see `ci-config.md`).

## Update 2026-10-06

The previously unverified gates ran on GitHub in pull request #1 and passed: secret scan (gitleaks), CodeQL, dependency review, and all of the job gates above. Branch protection is applied on `main` as described in `ci-config.md`. Gitleaks also ran locally (8.30.1) over the working tree and history with no findings.

## Sources

- `team.md` and `project.md` practices; `../nfr-requirements/*.md`; `../build-and-test/test-results.md`; Q2 A.

## Assumptions & Open Questions

- [assumption] "Blocking severity" for CodeQL is the GitHub default for code scanning check runs; revisit after the first analysis.
- Open: gitleaks licence versus command-line tool (see `ci-config.md`).
