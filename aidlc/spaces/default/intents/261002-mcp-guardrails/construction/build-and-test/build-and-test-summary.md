# Build and Test Summary

Scope: the whole server (one implementation pass). Run date 2026-10-05 on the development machine (Node v26.8.2). Detailed output is in `test-results.md`; requirement coverage is in `cross-unit-traceability.md`.

## Overall status

- Build: succeeds. Tests: 576 of 576 pass (also under Node 24.21.0). Type check, lint, format check, benchmark, walkthrough and `npm audit` (0 vulnerabilities) all pass.
- Result of the stage after loop-back 1: still NOT fully successful. The four code and configuration targets from the first run (T06, T16, T17, T18) are now `Met`. Five applicable targets remain `Not Met` or `Unverified` (matrix below), all of them depending on GitHub-hosted checks and repository settings that have not been set up or run (T11-T15). They need your action or go-ahead on GitHub; no code change fixes them.

## Test type inventory

| Type | File | Status |
|------|------|--------|
| Unit (per module, BDD) | `../code-generation/unit-test-instructions.md` | 576 tests pass (includes the integration specs) |
| Integration (key boundaries) | `integration-test-instructions.md` | Pass |
| Performance (benchmark) | `performance-test-instructions.md` | Targets met |
| Security | `security-test-instructions.md` | Automated parts pass; gitleaks, CodeQL and repository settings not verified |

## Coverage expectations and actuals

- Overall lines 99.37% (1441/1450), branches 94.77%, against the 90% line floor (re-run after loop-back 1).
- `src/guardrails/**`: lines 417/417 and branches 203/203 (100% each), per-path threshold enforced; the coverage run exits 0.

## Target Verification Matrix

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|-----------|--------|----------|--------|----------|--------------|---------|
| T01 | NFR8.1, performance-requirements | Read tools p95 <= 1 s, max <= 5 s | p95 0.05-0.12 ms, max 1.72 ms | `npm run bench` output in test-results.md | build-and-test | Met |
| T02 | NFR8.2 | Write path p95 <= 1 s, max <= 5 s | p95 4.23 ms, max 8.13 ms | bench output | build-and-test | Met |
| T03 | NFR8.3 | Guardrail overhead p95 <= 50 ms | p95 0.03 ms | bench output | build-and-test | Met |
| T04 | NFR3.1 | Overall lines >= 90% | 99.48% | coverage summary | build-and-test | Met |
| T05 | NFR3.2 | `src/guardrails/**` 100% lines and branches | 407/407 and 199/199 | coverage summary, exit 0 | build-and-test | Met |
| T06 | NFR3.3 | Thresholds not lowered; exclusions carry a true reason | Thresholds intact; logic moved from `src/bin/` into tested `src/serve.ts` and `src/bench.ts`; the one remaining exclusion (`src/bin/**`) covers only entry points that hand process globals to tested functions | `vitest.config.ts`, re-review | build-and-test | Met (re-run after loop-back 1) |
| T07 | NFR4.1-4.4 | BDD style; named tests for refused writes, one call ID per call, rate-limit rejection, registry enumeration | All present and passing | test files in integration-test-instructions.md | build-and-test | Met |
| T08 | NFR5.1-5.3 | Suite offline; injected time and randomness | Guard in test setup; ESLint rule forbids real timers outside ports | `test/support/setup.ts`, `eslint.config.js` | build-and-test | Met |
| T09 | NFR6.1-6.4 | Strict TypeScript, Prettier, ESLint, type-check pass | All exit 0 | command output | build-and-test | Met |
| T10 | NFR7.1-7.3 | Lockfile, pinned Actions, 2 runtime dependencies | Present; all `uses:` pinned to 40-char SHAs; dependencies are the SDK and zod | grep output | build-and-test | Met |
| T11 | NFR7.4 | CodeQL runs on pull requests and the default branch | Workflow written, never run | `.github/workflows/codeql.yml` | none scheduled | Unverified |
| T12 | NFR7.5 | SECURITY.md present; private vulnerability reporting enabled | File present; GitHub reports private vulnerability reporting `enabled: false` | `gh api` read-only query | none scheduled | Not Met |
| T13 | NFR2.3, team Deployment | gitleaks hook and CI scan run; secret scanning with push protection on | gitleaks not installed locally and never run; GitHub reports secret scanning and push protection `disabled` | `gh api` query | none scheduled | Not Met |
| T14 | NFR6.5, team Way of Working | Format, lint, type-check, tests, coverage and security checks are required checks on pull requests into `main` | The remote has no `main` branch (default branch is `ideation-records`); no branch protection; workflows never ran | `gh api` query | none scheduled | Not Met |
| T15 | NFR8.7 | A reader on a clean machine follows the README and each step succeeds | Walkthrough and tests run locally; no clean-machine run | none | none scheduled | Unverified |
| T16 | NFR8.8 | Node version pinned the same in `.nvmrc`, `engines` and CI | `.nvmrc` 24, `engines` `24.x`, `@types/node` 24.19.1 exact; workflows read `.nvmrc`; full suite (576 tests), type check, lint and build also run under Node 24.21.0 | package.json, .nvmrc, Node 24 run | build-and-test | Met (re-run after loop-back 1) |
| T17 | NFR1.2 | Outside text is data only | Live-mode workflow, job, step, branch and commit names are sanitised and capped; log excerpts and advisory text as before; covered by tests and re-review | `src/core/sanitize.ts`, tests | build-and-test | Met (re-run after loop-back 1) |
| T18 | NFR1.1 | Input limits incl. 64 KiB message cap with a defined refusal | Oversize stdio message gets a JSON-RPC error carrying its own top-level id, one `stdio.oversize` log line and one `invalid` audit record; exactly 64 KiB passes; queue cap and back-pressure; real SDK client test | `src/transport/stdio.ts`, `id-scanner.ts`, tests | build-and-test | Met (re-run after loop-back 1) |
| T19 | NFR4.5-4.6 | Live reader timeout, bounded retries; no network when off | Pass in `test/data/live-github.test.ts`, `test/e2e/live-mode.test.ts` | test output | build-and-test | Met |
| T20 | FR9.2 | Walkthrough produces the five documented outputs | All five printed; exit 0; no network | walkthrough output | build-and-test | Met |

Applicable targets: 20. Met 15 (T01-T10, T16-T20). Not Met 3 (T12, T13, T14). Unverified 2 (T11, T15).

## Readiness assessment

- Build-ready: yes. Test-ready: yes. Deployment-ready: not applicable (local tool, no hosted service); merge-ready: no, because the pull-request checks and repository settings above are not in place.

## Known limitations and outstanding items

- Fixed by loop-back 1 and re-reviewed: live-mode name sanitising, oversize stdio message handling, `approve` mode, streamed live response limit, coverage exclusion reasons, Node 24 pin, weak traceability rows. Two minor open review notes remain (a Node listener-count warning under a very slow output consumer; a request `id` key written with an escape or duplicated gets a null-id error reply).
- The repository settings (T12-T14: private vulnerability reporting, secret scanning with push protection, a `main` branch with required checks) and the first pull request (T11 CodeQL, and the CI evidence for T14) need your action on GitHub or your go-ahead for me to make the changes; nothing was changed there.
- A clean-machine README run (T15) needs a fresh checkout and is best done by the first CI run or by you.
- Pinned action SHAs were resolved from the real repositories but nobody has re-checked each against its tag comment.

## Assumptions & Open Questions

- [assumption] "Ordinary developer laptop" is this development machine; the numbers are not a guarantee for other hardware.
- Resolved: Node 24 (your decision), verified locally on Node 24.21.0.
- Open: whether to create `main` on the remote and open the first pull request, and whether I should change the repository security settings through the GitHub API.
