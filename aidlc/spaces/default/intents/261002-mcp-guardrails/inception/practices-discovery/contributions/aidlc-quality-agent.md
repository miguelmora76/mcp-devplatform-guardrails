**Collaborator:** aidlc-quality-agent

## Contribution

### 1. Testing Posture: the draft restates the org fallback; it needs a real decision

The draft's Testing Posture is the org placeholder (test-after, 80% floor). For this project the three headline guardrails are safety properties, so the choice of methodology should be driven by them, not left to the fallback.

Recommended proposal for the interview (a recommendation, not an affirmed fact):
- **Methodology**: test-first (TDD) for the guardrail core only (approval gate, audit log, rate limiter), and test-after for the read-only analysis tools. A hybrid needs explicit `Methodology` and `Ordering` fields per layer. If the human wants a single value, use TDD or BDD, because the inception phase rules already mandate Given/When/Then acceptance criteria, so BDD-style test naming costs nothing extra and keeps tests traceable to stories.
- **Ordering**: guardrail tests are written before the write-action implementation. This matches the scope dependency rule (SQ4): guardrails must exist before any write action is built.
- Scope family: the intent is `mcp-guardrails-portfolio`. The org floors name `mvp`, `enterprise`, `feature`, `infra`, `classic`, `express`, `bugfix`, and so on, but not this scope. The interview must confirm which floor applies (suggest the 80% floor, as the mvp family does). Otherwise there is an ambiguity about whether any floor applies.

### 2. Coverage: a line-coverage floor is not enough to prove the guardrails

The org 80% line floor is a guide, and the guardrails are exactly where coverage numbers mislead. Suggested affirmations:
- Overall floor 80% line coverage (org default), plus a higher stated target on the guardrail modules (suggest 100% line and branch for approval gate, audit logger, rate limiter). Reason: the refusal and rejection branches are the product.
- Branch coverage enabled in tooling, not just lines.
- Coverage may not be weakened to pass the gate (org rule); record that no `# pragma: no cover`/ignore-comment exclusions are allowed in the guardrail modules without a documented rationale.
- Coverage tool depends on the language, which is not yet chosen (see section 6). The interview should either pick the language now or defer the tool choice to a named later stage (tech stack decision), recorded in `project.md` `## Tech Stack`.

### 3. Safety-property tests that must be named as mandated test obligations

The brief says the project must prove these by test. Suggested as `Mandated` candidates, each with a pass/fail criterion (the inception rule requires testable requirements):
1. **Write refused without approval**: for every write-capable tool, a call without a valid approval is rejected, and the target system is verified unchanged (assert on side effects, not just the error message). Include the negative variants: missing approval, expired/replayed approval, approval for a different action or arguments, approval from the wrong principal, malformed approval token.
2. **Read-only by default**: a test enumerates the registered tool list and fails if any tool that mutates state is reachable without passing through the approval gate. This guards against a new write tool being added that bypasses the gate (a structural test, not only per-tool tests).
3. **Every call audit-logged**: success, error, rate-limited, and approval-refused calls each produce exactly one audit record containing at minimum timestamp, tool name, caller identity, argument digest or redacted arguments, and outcome. Include the case where the tool handler raises: the record must still be written. Also test that audit write failure behavior is defined (fail closed for writes, a decision the interview should settle).
4. **Rate limits reject excess calls**: with a controllable clock, call N+1 within the window is rejected with a defined error, calls resume after the window, and limits are per-caller/per-tool as specified. A rejected call is also audit-logged. Use an injected fake clock; never sleep in tests.
5. **Secrets/data constraint**: a test or check that no real credentials appear in fixtures (synthetic or public data only), for example a secret-scan step in CI.

The numeric rate limit and "works end to end" threshold are deferred to Requirements Analysis (SQ7), so the practice to affirm now is the testing method (injected clock, boundary tests at N and N+1), not the number.

### 4. Test pyramid and patterns to affirm

- Unit tests for guardrail logic with pure functions and injected dependencies (clock, audit sink, approval provider). This makes the three safety properties deterministic and fast.
- Integration tests through the real MCP protocol surface (in-process client against the server) to prove the guardrails sit in the request path and cannot be bypassed by calling a handler through the protocol. Unit tests alone could pass while the gate is unwired.
- Contract tests for tool input/output schemas (MCP tool schemas), including that write tools advertise their approval requirement.
- External systems (git hosting, CI provider, package registries): use recorded fixtures or fakes built from synthetic or public data. No live network in the default test run; any live smoke test is opt-in and clearly separated. This aligns with the data constraint (SQ3).
- Test independence: no shared state or ordering dependence; each test gets a fresh audit sink and limiter.
- Negative/edge tests: the construction phase rule already requires the happy path plus at least two error/edge cases per test file; affirm it as the floor and note the guardrail modules exceed it.
- Every defect gets a regression test written before the fix (quality principle; suggest affirming as `ALWAYS`).

### 5. CI quality gates

No CI exists today. The draft says "CI execution before merge" but with a solo trunk workflow and no reviewer, CI is the only independent gate. Questions and suggestions:
- CI platform: GitHub Actions is the natural fit for a public GitHub repo (confirm; the org mentions CodePipeline for deployment, which is likely overkill here).
- Required checks on a PR to `main` (suggest): lint, type check (if the language supports it), unit + integration tests, coverage floor enforcement (fail below floor), secret scan, dependency audit. Branch protection requiring them, even for a solo maintainer.
- Whether direct pushes to `main` are allowed. Trunk-based with squash-merge per Bolt implies PRs or at least a gated merge; for a solo build the interview must say if PR-with-CI is wanted as the self-review mechanism (the draft already flags this open question; the quality view is: yes, so the gates are enforced mechanically).
- A visible CI badge and a one-command local test run documented in the README help the portfolio goal ("reviewer can trace and reproduce", IS success metric). The Construction Verification Command should be that same command, so it doubles as the walking-skeleton verification.
- Reproducibility target: tests run with no manual setup beyond documented prerequisites (construction phase rule); suggest a pinned lockfile and a single `make test`-style entry point (name to be set after language choice).

### 6. Gaps the human interview must resolve (suggested questions)

1. Testing methodology and ordering: TDD for the guardrail core and test-after for read-only tools (recommended), full TDD/BDD, or the org test-after fallback? Record `Methodology` and `Ordering` as separate fields.
2. Which scope floor applies to `mcp-guardrails-portfolio`: the 80% line floor, a higher guardrail-module target, or something else? Is branch coverage required?
3. Language/runtime and test framework (this determines the coverage, lint, and type tools). If undecided, which later stage owns this and does practices-discovery record the testing choices as language-neutral?
4. CI platform and required checks before merge; are PRs required even for a solo build, and are direct pushes to `main` forbidden?
5. Walking skeleton: does the scope declare `skeleton: on`? If yes, which real end-to-end command is the Construction Verification Command (suggest: run the server with the in-process client, make a read-only call, check an audit record, attempt a write and observe refusal)? The draft leaves this open; resolving it now avoids a later human stop.
6. Which of the safety-property tests in section 3 are `ALWAYS`/`NEVER` rules? Suggested candidates: ALWAYS cover refused-write, audit-per-call, and rate-limit-rejection with automated tests; NEVER add a write-capable tool that bypasses the approval gate; NEVER use live external services or real credentials in the default test run.
7. Audit failure policy: if the audit log cannot be written, does the call fail closed? This affects test design (a stated requirement for Requirements Analysis, but the practice of testing it can be affirmed here).
8. Security checks in CI: secret scanning and dependency audit as required gates (relevant to a project that is itself about dependency safety and public by design).
9. Is a mutation-testing or property-based testing practice wanted for the guardrail modules (optional, portfolio-signal value, but costs effort)? Ask as an explicit optional item, default off.
10. Performance/load testing: confirm it is out of scope (no deadlines and hosting is Not Yet Decided), except that rate-limit correctness is tested functionally. Record this so the quality stages do not assume NFR load tests.

### 7. Observations on the lead's draft

- `discovered-rules.md` has only `None yet`. Several rules are already evidenced in Ideation and need no new decision beyond confirmation: tests are a deliverable, the write-refused test, synthetic/public data only, the README linking AI-DLC records. Propose them as candidates at the gate rather than leaving the Mandated list empty.
- The Testing Posture section labels `Methodology`/`Ordering` as placeholders, which is correct and honest. However, because the org fallback only applies "when no posture has been affirmed", the gate must produce a real affirmation or an explicit "accept fallback" answer, so Code Generation resolves the fields unambiguously.
- Evidence file correctly lists unresolved items. Add the testing-specific unresolved items: coverage tool, CI platform, scope floor mapping, audit-failure policy, and whether an approval-gate bypass test (structural) is wanted.
- Deployment: because hosting is Not Yet Decided, the draft's caveat is right; from a quality viewpoint suggest "no deploy gate; release by tag from `main` after CI is green" as the likely affirmed practice, to avoid carrying a staging/production ceremony that does not exist.

## Positions

- AGREE: Treating every item in the draft as a suggested default until the interview affirms it is correct for a greenfield project with no affirmed team baseline.
- AGREE: Flagging the language, formatter, linter, and CI platform as undecided is accurate; the repo has no config files or code.
- AGREE: Not marking the org test-after fallback as affirmed is the correct handling under the org Testing Posture rule.
- OBJECT: `discovered-rules.md` leaves Mandated and Forbidden entirely as `None yet`; the safety-property test obligations (refused write, audit per call, rate-limit rejection) and the synthetic-data constraint are already stated in Ideation and should be proposed as candidate rules at the gate.
- OBJECT: The draft's "80% line-coverage floor" is presented without noting that the org floor list does not name this scope and that line coverage alone does not demonstrate the guardrail branches; the interview should settle the scope-floor mapping and a branch/guardrail-module target.
- OBJECT: The draft treats the staging/production deploy default as plausible; given hosting is Not Yet Decided and the build is a solo portfolio with no deadlines, the quality gate should be framed around CI-green-then-tag rather than a deploy pipeline unless the human says otherwise.
