# Unit Test Instructions

Scope: the whole server (one implementation pass, no Unit split). Methodology: BDD (scenario-first, Given/When/Then), standard test strategy. Runner: Vitest with the V8 coverage provider.

## Setup

- Prerequisite: the Node.js major pinned in `.nvmrc`, then `npm ci` (lockfile install). No other setup, no network, no credentials.
- `vitest.config.ts` (created in plan Step 2): tests under `test/**/*.test.ts`; setup file `test/support/setup.ts` makes any network socket creation throw so a stray network call fails the suite [NFR5.1]; the coverage block sets the thresholds below.
- Time, randomness, network and scheduling are injected through `src/core/ports.ts`; tests use the fakes in `test/support/fakes.ts`. No test reads the real clock or sleeps [NFR5.2, NFR5.3].

## Exact commands

The runner-readiness command, runnable at plan Step 2 before the first scenario:

```bash
npx vitest run test/smoke.test.ts
```

Commands for each slice use exact test file paths (run after the slice's scenarios are written, to see them fail, and again after implementation, to see them pass):

| Plan step | Command |
|-----------|---------|
| 3 Ports, config, canonical JSON | `npx vitest run test/core/ports.test.ts test/core/config.test.ts test/core/canonical-json.test.ts` |
| 4-6 Walking skeleton | `npx vitest run test/e2e/skeleton.test.ts` |
| 7 Redaction and logging | `npx vitest run test/core/redactor.test.ts test/core/logger.test.ts` |
| 8 Audit writer | `npx vitest run test/guardrails/audit.test.ts` |
| 9 Rate limiter | `npx vitest run test/guardrails/rate-limiter.test.ts` |
| 10 Approval service | `npx vitest run test/guardrails/approval.test.ts` |
| 11 Admin channel and approve command | `npx vitest run test/guardrails/admin-channel.test.ts test/bin/approve.test.ts` |
| 12 Wrapper and registry | `npx vitest run test/guardrails/wrapper.test.ts test/tools/registry.test.ts` |
| 13 Simulated CI and re-run tool | `npx vitest run test/data/simulated-ci.test.ts test/tools/rerun-ci-job.test.ts test/e2e/approval-flow.test.ts` |
| 14 Upgrade planning | `npx vitest run test/data/semver.test.ts test/data/snapshot-store.test.ts test/tools/plan-dependency-upgrades.test.ts` |
| 15 CI triage | `npx vitest run test/tools/triage-ci-failure.test.ts` |
| 16 HTTP mode | `npx vitest run test/transport/http.test.ts test/bin/new-token.test.ts` |
| 17 Live reader | `npx vitest run test/data/live-github.test.ts` |
| 18 Lifecycle | `npx vitest run test/core/lifecycle.test.ts` |
| 20 Walkthrough | `npx vitest run test/e2e/walkthrough.test.ts` |
| 22 Untrusted live metadata | `npx vitest run test/tools/triage-ci-failure.test.ts test/e2e/live-mode.test.ts` |
| 23 Oversize stdio message | `npx vitest run test/transport/stdio.test.ts` |
| 24 Approve shows the real mode | `npx vitest run test/app.test.ts test/guardrails/admin-channel.test.ts` |
| 25 Bounded live response bodies | `npx vitest run test/data/live-github.test.ts` |
| 26-28 Config, Node pin and traceability | `npx vitest run test/smoke.test.ts test/app.test.ts` (then the full run in Build and Test) |

The full coverage run (`npx vitest run --coverage`) belongs to Build and Test, which executes the whole suite once; it is not a per-slice command.

## Test style

- Every spec reads as `describe("Given <context>")` then `it("When <action>, then <result>")`, and the scenarios for a slice are written before the code that satisfies them [NFR4.1].
- Standard strategy volume: 5-8 tests per component, unit tests plus integration tests at key boundaries: wrapper to tools, transports to wrapper (in-process MCP client over stdio and over loopback HTTP), and the `approve` command to a running server.
- Required behaviours, each with at least one named test [NFR4.2-4.4]: refused writes (missing, reused, expired, swapped-input, wrong-client approvals; unwritable audit file), exactly one call ID per call for each of the four outcomes (allowed, refused, rate-limited, error) plus the read-with-audit-failure case, rate-limit rejection (30 reads, 3 writes per window, per client), the registry enumeration test, and the injected-instruction snapshot test.
- Concurrency test: five simulated clients through the real wrapper and audit writer with the fake clock; line and call-ID counts agree [NFR1.10].

## Coverage targets (never lowered)

- Overall: at least 90% lines [NFR3.1].
- `src/guardrails/**` (wrapper, audit, rate limiter, approval, admin channel): 100% lines and 100% branches, enforced by per-path thresholds [NFR3.2].
- Files excluded from coverage are listed in `vitest.config.ts` with a reason (for example `src/bin/*.ts` thin entry points, covered by e2e specs) [NFR3.3].

## Mocking and stubbing guidance

- Prefer fakes over mocks: fake Clock, Scheduler, IdSource, Rng, Net, and an in-memory file sink (for the audit writer's failure cases, a sink that can be told to fail or fill).
- File-system tests use a temporary directory per test (removed afterwards) and never touch the project's real `audit/` folder.
- The Net fake records requests, so tests assert that default mode makes none and live mode contacts only the two allowed hosts.

## Test data management

- Fixtures live in `snapshots/` (bundled, synthetic, labelled as such) and `test/support/`. Each test builds what it needs; no shared mutable state.
- No real credentials, private repositories, or production data in any fixture. Token-shaped values in tests are obviously fake (for example `mgt_TEST...`) and sit in files the secret scanner config allows for tests only.

## Benchmarks (outside this suite)

- `npm run bench` uses real timers against the bundled snapshots and is not part of the commands above [NFR8.1-8.3].
