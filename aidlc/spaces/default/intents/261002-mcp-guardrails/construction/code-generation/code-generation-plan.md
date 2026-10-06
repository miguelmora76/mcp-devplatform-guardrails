# Code Generation Plan

Scope: the whole server, built as one implementation pass (this workflow has no Unit split). Application code goes to the workspace root; this plan, the test instructions, the code summary and the traceability file stay in this record directory. Sources: `[FRn.m]`/`[NFRn]` = `../../inception/requirements-analysis/requirements.md`; `[NFRx.y]` = `../nfr-requirements/`; `[LC-nn]`, `[Qn]` = `../nfr-design/` (design components and answers).

## Testing Contract

```json
{
  "version": 1,
  "methodology": "bdd",
  "source": "project",
  "ordering": "Define executable behavior scenarios before implementing each observable feature slice.",
  "scope": "mcp-guardrails-portfolio",
  "test_strategy": "standard",
  "project_type": "greenfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "- **Methodology**: bdd\n- **Ordering**: Tests are written alongside the code they cover, in the same change, with each behaviour scenario (Given/When/Then) written before or together with the code that satisfies it.\n- Coverage target: 90% overall, plus 100% line and branch coverage on the guardrail code (approval gate, audit log, rate limiter).\n- Coverage floors are never weakened to make a step pass.\n- Automated tests run in GitHub Actions before merge."
    },
    {
      "layer": "project",
      "text": "- Record behaviour-style (Given/When/Then) tests written alongside the code as Methodology bdd. (learned 2026-10-02) \n\n- Keep performance benchmarks in a separate script outside the deterministic unit suite, because they need a real timer while unit tests use an injected clock. (learned 2026-10-05)"
    }
  ],
  "obligations": {
    "strategy": "standard",
    "strategy_volume": [
      "Five to eight tests per component.",
      "Unit tests plus integration tests for key boundaries.",
      "Add E2E, performance, or security tests when requirements demand them."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "bdd",
    "runner_step": "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
      "Behavior scenarios - define executable examples for the observable feature slice before implementation.",
      "Feature slice - implement the required data, repository, business, API, and frontend layers.",
      "Behavior scenarios - run the scenarios until they pass.",
      "Feature slice - refactor while the scenarios stay green.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:23b21eb05f3556737b8a48711e9ac41daa31accd8168afd691038ac4daa304c9",
  "contract_sha256": "sha256:6961fbe2fc368cd1e795d866d5ed6947c84d3af88492ba8c18a4823ca502cfbc"
}
```

How the contract is applied: each numbered slice below follows the BDD profile. Its scenarios (Given/When/Then, as executable Vitest specs) are written first, then the slice is implemented across every layer it needs, then the scenarios are run green, then the slice is refactored while green. The frontend and database layers do not exist in this project (no UI, no database; the audit file and the simulated CI are the only state), so they are omitted as inapplicable. Standard strategy: 5-8 tests per component, unit tests plus integration tests at the key boundaries (wrapper to tools, transports to wrapper, approve command to server), plus the tests the project rules require.

## Layout (workspace root)

```text
src/guardrails/   wrapper, audit, rate-limiter, approval, admin-channel   (100% line+branch)
src/core/         ports, config, redactor, logger, identity, validator, errors, canonical-json
src/data/         snapshot-store, simulated-ci, semver, live-github
src/tools/        registry, plan-dependency-upgrades, triage-ci-failure, get-ci-job, rerun-ci-job
src/transport/    stdio, http
src/bin/          server, approve, new-token, walkthrough, bench
snapshots/        bundled synthetic sample repositories, registry data, advisories, CI runs
test/             one spec per module, mirroring src/, plus test/support (fakes) and test/e2e
```

## Plan steps

### Foundation

- [x] Step 1 - Project structure and production configuration skeleton [NFR6.1-6.5, NFR7.1, NFR8.8]: directories above; `tsconfig.json` (strict, `noUncheckedIndexedAccess`, NodeNext) and `tsconfig.build.json`; `eslint.config.js` (typescript-eslint, a rule forbidding real timers and `Date.now`/`Math.random` outside `src/core/ports.ts`); `.prettierrc`; `.nvmrc` pinned to the Node major in use and matching `engines`; `.gitignore` additions (`dist/`, `coverage/`, `audit/`, `.env*`). `package.json` and the lockfile already exist (SDK and zod are the only runtime dependencies, versions pinned exactly; any addition is justified in `code-summary.md`).
- [x] Step 2 - Bootstrap the test runner and record the unit-scoped command [NFR3.1-3.3, NFR5.1]: `vitest.config.ts` with the V8 coverage provider, global thresholds of 90% lines, and per-path thresholds of 100% lines and branches on `src/guardrails/**`, with a list of excluded files each carrying a reason; a setup file that makes any socket creation throw (offline guard); `test/support/fakes.ts` with the fake Clock, Scheduler, IdSource, Rng, Net and an in-memory file sink; one smoke spec. Exact command recorded in `unit-test-instructions.md`.
- [x] Step 3 - Ports, config and canonical JSON [LC-12, LC-17; NFR5.2, NFR5.3, NFR2.1]. Scenarios first: time and randomness come only from injected ports; config reads environment variables only and refuses more than 5 tokens, duplicate names, tokens under 128 bits; canonical JSON is stable for the approval digest. Then implement `src/core/ports.ts`, `config.ts`, `canonical-json.ts`.

### Walking skeleton (thin end-to-end slice first)

- [x] Step 4 - Scenarios for the skeleton [FR2.1, FR2.2, FR6.1, FR8.1; LC-01, LC-04]: Given a bundled failed-run snapshot, when an in-process MCP client calls `triage_ci_failure` over the stdio transport, then the report names a category and failing step, and exactly one audit line exists. Written as an end-to-end spec in `test/e2e/skeleton.test.ts`.
- [x] Step 5 - Implement the skeleton: `src/core/redactor.ts` and `logger.ts` (minimal), `identity.ts` (session ID), `validator.ts` (strict schema helper), a first cut of `src/guardrails/wrapper.ts` (identify, validate, execute, audit) and `audit.ts` (append a JSON line), `src/data/snapshot-store.ts`, `src/tools/triage-ci-failure.ts` (first categories), `src/transport/stdio.ts` using the MCP SDK, `src/bin/server.ts`, and one bundled snapshot.
- [x] Step 6 - Run the skeleton scenarios green; refactor while green. Later slices harden each piece; the skeleton spec stays as a regression.

### Feature slices (scenarios, then implementation, then green, then refactor, for each)

- [x] Step 7 - Redaction and operational logging [LC-10, LC-11; NFR2.2, NFR2.4, NFR8.5, NFR8.6, NFR1.7]. Scenarios: secret-shaped keys and values are redacted (GitHub tokens, Bearer values, AWS-style keys, private-key blocks, 40+ character runs, exact configured tokens); call and request IDs and `sha256:` digests survive; a skip never applies to `call_` followed by a long secret-like run; log lines are JSON with required fields, levels filter, nothing reaches standard output.
- [x] Step 8 - Audit writer [LC-09; FR6.1-6.4, NFR1.5, NFR1.10, NFR1.12-1.14, NFR1.18, NFR1.20, NFR4.2]. Scenarios: one line per call ID; a write gets an intent line then an outcome line; lines never interleave under 5 parallel clients; append-only with a torn last line tolerated; cap refuses; lock refuses a second live process, replaces a dead one with only one winner; unwritable file refuses writes and lets reads continue with a reported failure; a failed append does not block later appends.
- [x] Step 9 - Rate limiter [LC-06; FR7.1, FR7.2, NFR1.8, NFR1.17]. Scenarios (injected clock): 30th read passes and 31st is rejected, 3rd write passes and 4th is rejected, reset after the 60-second window, two clients do not interfere, idle entries are swept, a rejection yields the defined error and one audit record.
- [x] Step 10 - Approval service [LC-07; FR4.2-4.4, NFR1.3, NFR1.17, NFR1.9]. Scenarios: refused when missing, reused, expired (accepted at exactly 5:00, refused after), for another tool, other inputs or other client; verify-and-claim cannot be won twice; an intent-line failure releases the claim; at most 20 records per client; sweep discards expired ones.
- [x] Step 11 - Admin channel and `approve` command [LC-08; NFR1.3]. Scenarios: socket directory must be mode 0700, owned by the user and not a symlink; socket per process; stale socket removed; several servers listed; `approve` lists pending requests with escaped inputs and digest, requires a terminal, and approves only after `yes`; no MCP tool or HTTP route can issue an approval. Implement `src/guardrails/admin-channel.ts`, `src/bin/approve.ts`.
- [x] Step 12 - Complete guardrail wrapper and tool registry [LC-04, LC-05, LC-16; FR5.1, FR5.2, NFR1.1, NFR1.2, NFR1.7, NFR1.14, NFR4.3, NFR4.4]. Scenarios: fixed order (identify, rate limit, validate, authorize, intent, execute, outcome); every refusal yields exactly one record and calls no handler; handler errors map to a defined error and the server continues; unknown fields, oversized and control-character inputs are refused, never truncated; a registry test fails for an unwrapped tool, an unapproved state-changing tool, or an approval-issuing tool.
- [x] Step 13 - Simulated CI and the re-run write tool [LC-15; FR4.1-4.4, FR5.1, NFR1.3, NFR1.5]. Scenarios: `rerun_ci_job` with no approval returns `approval_required` and leaves the simulated CI unchanged; after a human approval through the admin channel the re-run changes only the simulated CI; replay, swapped inputs and expired approvals are refused with the CI unchanged; the audit file is unwritable so the write is refused; a prompt-injection line in a log never triggers a write [NFR1.2]. Also `get_ci_job` (read) so the walkthrough can show state.
- [x] Step 14 - Snapshots, versions and dependency-upgrade planning [LC-13, LC-16; FR1.1-1.5, FR3.2, FR3.4, NFR1.11, NFR1.6, Q7 of the requirements stage]. Scenarios: N outdated dependencies listed with current and target (latest stable release, no pre-releases); patch/minor/major rating with a reason; ordered plan with reasons; advisories listed against the upgrade that fixes them; repository content byte-for-byte unchanged; private or malformed references refused; documents over 5 MiB refused. Implement `src/data/semver.ts` (in-house, no dependency), `snapshot-store.ts` (bounded cache), the tool, and three synthetic sample repositories with registry and advisory data.
- [x] Step 15 - Full CI failure triage [FR2.1-2.5, NFR1.2]. Scenarios: category for each of test failure, build error, lint error, dependency problem, flaky/infrastructure; failing step and quoted log lines that exist in the source log; suspected cause and next action always present; earlier occurrences reported or "none"; instruction-like text in a log appears only as quoted data.
- [x] Step 16 - HTTP mode [LC-02, LC-03; FR8.2, NFR1.4, NFR1.16, NFR1.9, NFR1.19]. Scenarios: loopback bind; missing and wrong tokens refused identically; foreign Host or Origin refused with a valid token; two tokens give two client names with separate limits; failed logins go through the serialised queue (valid tokens never wait, the 21st queued failure is closed); more than 50 connections refused with a logged event; body over 64 KiB refused; more than 5 configured tokens refused at start; `src/bin/new-token.ts` prints a token once.
- [x] Step 17 - Live GitHub reader (optional, off by default) [LC-14; FR3.1, FR3.3, NFR1.6, NFR4.5, NFR4.6]. Scenarios (fake Net and Scheduler): off by default so no network use; 10-second timeout, 3 retries with 1 s, 2 s, 4 s plus jitter, transient errors only, Retry-After above 30 s ends the call, 120-second deadline, only `api.github.com` and `github.com`, redirects refused, no Authorization header.
- [x] Step 18 - Lifecycle [LC-18; NFR1.15]. Scenarios: SIGINT or SIGTERM drains in-flight calls (5 s), flushes audit, removes lock and socket; a second signal exits at once; startup refuses an unsafe socket directory.

### Build, documentation and traceability

- [x] Step 19 - Environment and build configuration [NFR6.2-6.5, NFR7.1-7.5, NFR2.3, NFR8.7]: `.github/workflows/ci.yml` (format, lint, type-check, test with coverage, gitleaks; all actions pinned to full commit SHAs, SHAs verified when written), `codeql.yml`, dependency-review, `dependabot.yml`, `.gitleaks.toml`, a pre-commit hook script for gitleaks, `SECURITY.md`, `npm run bench` (`src/bin/bench.ts`, real timers, informational in CI).
- [x] Step 20 - Walkthrough and README [FR9.1, FR9.2, NFR8.7, Q6 live-log limit]: `src/bin/walkthrough.ts` produces the five documented outputs (upgrade plan, CI triage, refused write, rate-limited call, audit record) offline against the bundled snapshots; README with setup, the one test command, walkthrough, the `approve` flow, HTTP token setup, audit file location and the full-file recovery step, the live-mode limit (no raw CI logs), and links to the inception and construction records.
- [x] Step 21 - Code summary, source manifest and traceability [Step 5 of the stage file]: `code-summary.md`, `source-manifest.json` listing every created path, `traceability.json` mapping each FR and detailed NFR to one existing implementation or test file.

### Repair pass (loop-back 1 from Build and Test; replay under a new stage attempt)

Steps 1-21 above are done and stay as built. This pass applies only the planned fix recorded in `../build-and-test/test-results.md` (Loop-Back Log, loop-back 1), BDD order for every step (scenario first, then the change, then green, then refactor). No coverage threshold or quality target is lowered.

- [x] Step 22 - Untrusted live metadata [NFR1.2, FR2, review R-01]. Scenarios first: workflow, job and step names that arrive from the live GitHub reader contain ANSI sequences, control characters, instruction-like text and an over-long value; the triage result carries them only sanitised and capped, as quoted data. Implement in `src/tools/triage-ci-failure.ts` and `src/data/live-github.ts` using the existing sanitiser.
- [x] Step 23 - Oversize stdio message [NFR1.1, review R-02]. Scenarios first: a stdio message over 64 KiB gets a defined error response (not silence), one operational log line, and one audit record with outcome `invalid`; the server keeps serving afterwards. Implement in `src/transport/stdio.ts` and `src/transport/mcp-server.ts`; add a stdio spec `test/transport/stdio.test.ts` that references the size constant.
- [x] Step 24 - Approve shows the real mode [review R-03]. Scenario first: a stdio server started with `GUARDRAILS_TOKENS` exported reports `stdio` to the `approve` command. Implement in `src/app.ts` (use the `mode` dependency).
- [x] Step 25 - Bounded live response bodies [NFR1.11, review R-07]. Scenarios first: a live response whose `Content-Length` exceeds 5 MiB is refused before reading, and a body without a length is read as a stream with a running byte count and refused at 5 MiB plus 1 byte. Implement in `src/data/live-github.ts`.
- [x] Step 26 - Coverage exclusion reasons [NFR3.3, review R-05]. Make each exclusion in `vitest.config.ts` carry a reason that is true of every file it covers (split `src/bin/**` into thin entry points and the two files with logic, or cover them). No threshold changes.
- [x] Step 27 - Node pin [NFR8.8, your decision: Node 24]. Set `.nvmrc` to `24`, `engines.node` to the same major (`24.x`), `@types/node` to the latest 24.x exact version (lockfile updated with `npm install --save-exact --save-dev @types/node@24`; no other dependency changes); workflows keep reading `.nvmrc`. Try to run the full suite under Node 24 (for example with `npx -y node@24`); if that cannot be done, report that Node 24 was not run locally.
- [x] Step 28 - Traceability and summary [review R-06]. Point NFR8.6 at the files that emit the operational log events (`src/core/lifecycle.ts`, `src/transport/http.ts`, `src/guardrails/wrapper.ts`, `src/data/live-github.ts`) and NFR1.1 at the validator plus the stdio and HTTP size checks; update `code-summary.md`, `source-manifest.json` and `traceability.json`; re-run build, the full suite with coverage, type check, lint and format.

## Requirement coverage check (plan level)

Every FR1-FR9 and NFR1-NFR8 group appears in a step above. Dependency pinning, no real credentials in fixtures, and synthetic or public data only apply to every step.

## Sources

- Requirements `requirements.md`; NFR requirements and NFR design in this record; team practices `team.md` and `project.md` (Testing Posture bdd, 90% overall and 100% guardrail coverage, trunk-based work through short-lived branches and pull requests).

## Assumptions & Open Questions

- [assumption] The bundled snapshots are three synthetic sample repositories written for this project and labelled as such, with sample registry and advisory data. The requirements asked for snapshots of chosen public repositories and left the choice open; capturing real ones needs the optional live mode and the network, so a `capture` helper is left as a follow-up. Please confirm or choose real repositories at this approval.
- [assumption] The tool names are `plan_dependency_upgrades`, `triage_ci_failure`, `get_ci_job` (read) and `rerun_ci_job` (write).
- [assumption] The first Node major in `.nvmrc` is the installed LTS major; verified when written.
- [assumption] Git: the code is written to the working tree only. Creating the feature branch, commits, pull request and CI runs happen when you ask for them; nothing is committed or pushed by this stage.
- Open: the Construction Verification Command for later checkpoints is set when Construction checkpoints begin (not used by this legacy flow).
