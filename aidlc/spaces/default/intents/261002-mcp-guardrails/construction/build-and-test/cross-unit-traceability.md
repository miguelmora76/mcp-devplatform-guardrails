# Cross-Unit Traceability

Scope: the whole server (stage-level, no Units). Enumerated from `../../inception/requirements-analysis/requirements.md`: 30 functional requirements (FR1.1-FR9.2) and 8 non-functional requirements (NFR1-NFR8). No user stories exist, so there are no AC IDs. Source of coverage: `../code-generation/traceability.json` (stage-level; there are no per-Unit files).

## Verdict

PASS. Every FR (30) and every NFR group (NFR1-NFR8) appears in `../code-generation/traceability.json` with status `OK` and an existing target file, and so does every derived detailed requirement (NFR1: 20, NFR2: 4, NFR3: 3, NFR4: 6, NFR5: 3, NFR6: 5, NFR7: 5, NFR8: 8). The group rows (FR1-FR9, NFR1-NFR8) were added after loop-back 1 because the traceability check reported them missing; the check now reports no gaps, no orphans and no invalid targets.

Coverage here means a target file exists that implements or tests the ID. It does not mean the requirement's pass/fail criterion is met: the Target Verification Matrix in `build-and-test-summary.md` records Not Met and Unverified results (for example NFR1.1, NFR1.2, NFR6.5, NFR7.5, NFR8.8), and the code review spot-checked 18 rows, finding NFR8.6 and NFR1.1 weakly targeted.

## Functional requirements

| ID | Owning stage/Unit | Target file | Status |
|----|-------------------|-------------|--------|
| FR1.1 | code-generation (stage-level) | src/tools/plan-dependency-upgrades.ts | OK |
| FR1.2 | code-generation | src/data/semver.ts | OK |
| FR1.3 | code-generation | src/tools/plan-dependency-upgrades.ts | OK |
| FR1.4 | code-generation | src/tools/plan-dependency-upgrades.ts | OK |
| FR1.5 | code-generation | test/tools/plan-dependency-upgrades.test.ts | OK |
| FR2.1 | code-generation | src/tools/triage-ci-failure.ts | OK |
| FR2.2 | code-generation | src/tools/triage-ci-failure.ts | OK |
| FR2.3 | code-generation | src/tools/triage-ci-failure.ts | OK |
| FR2.4 | code-generation | src/tools/triage-ci-failure.ts | OK |
| FR2.5 | code-generation | test/tools/triage-ci-failure.test.ts | OK |
| FR3.1 | code-generation | src/data/live-github.ts | OK |
| FR3.2 | code-generation | test/e2e/walkthrough.test.ts | OK |
| FR3.3 | code-generation | test/e2e/live-mode.test.ts | OK |
| FR3.4 | code-generation | src/core/repository-ref.ts | OK |
| FR4.1 | code-generation | src/data/simulated-ci.ts | OK |
| FR4.2 | code-generation | test/e2e/approval-flow.test.ts | OK |
| FR4.3 | code-generation | src/guardrails/admin-channel.ts | OK |
| FR4.4 | code-generation | src/guardrails/approval.ts | OK |
| FR5.1 | code-generation | test/tools/registry.test.ts | OK |
| FR5.2 | code-generation | src/guardrails/wrapper.ts | OK |
| FR6.1 | code-generation | src/guardrails/audit.ts | OK |
| FR6.2 | code-generation | src/guardrails/audit.ts | OK |
| FR6.3 | code-generation | src/core/redactor.ts | OK |
| FR6.4 | code-generation | test/guardrails/audit.test.ts | OK |
| FR7.1 | code-generation | src/guardrails/rate-limiter.ts | OK |
| FR7.2 | code-generation | test/guardrails/wrapper.test.ts | OK |
| FR8.1 | code-generation | src/transport/stdio.ts | OK |
| FR8.2 | code-generation | src/transport/http.ts | OK |
| FR9.1 | code-generation | README.md | OK |
| FR9.2 | code-generation | src/walkthrough.ts | OK |

## Non-functional requirements (through derived IDs)

| ID | Derived IDs covered (all `OK`, targets exist) | Count |
|----|-----------------------------------------------|-------|
| NFR1 Security | NFR1.1-NFR1.20 | 20 |
| NFR2 Secrets | NFR2.1-NFR2.4 | 4 |
| NFR3 Test coverage | NFR3.1-NFR3.3 | 3 |
| NFR4 Test method | NFR4.1-NFR4.6 | 6 |
| NFR5 Determinism | NFR5.1-NFR5.3 | 3 |
| NFR6 Code quality | NFR6.1-NFR6.5 | 5 |
| NFR7 Supply chain | NFR7.1-NFR7.5 | 5 |
| NFR8 Reproducibility | NFR8.1-NFR8.8 | 8 |

## Uncovered elements

- None by file existence. The strict-reading caveat above applies to NFR1-NFR8 as parent rows.
- Targets with open verification results are listed in the matrix, not here.
