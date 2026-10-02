# Decision Log

All decisions made during Ideation, in order. Source files: `../intent-capture/intent-capture-questions.md` (IQ), `../scope-definition/scope-definition-questions.md` (SQ), `approval-handoff-questions.md` (AQ).

| # | Stage | Decision | Source |
|---|-------|----------|--------|
| 1 | Intent Capture | The project is mainly a portfolio demonstration of safe-agent design; the problem is secondary | IQ1 |
| 2 | Intent Capture | Audience is platform/DevOps engineers, application developers, and reviewers or peers | IQ2 |
| 3 | Intent Capture | Success means both tool areas work, writes need approval (test-proven), audit log and rate limits are proven, and the README links the AI-DLC records | IQ4 |
| 4 | Intent Capture | Trigger: growing agent and MCP use plus a portfolio goal | IQ5 |
| 5 | Intent Capture | Stakeholders: owner and builder, future users or operators, README and record readers, security or compliance reviewers | IQ6 |
| 6 | Intent Capture | The owner decides scope and priority alone | IQ7 |
| 7 | Intent Capture | The workflow-selected scope matches the intended product boundary | IQ8 |
| 8 | Intent Capture | No reporting cadence; the README and AI-DLC records are the only communication | IQ9 |
| 9 | Scope Definition | Minimum version: upgrade planning, CI triage, approval-gated writes, audit log, rate limits | SQ1, SQ8, SQ9 |
| 10 | Scope Definition | Write actions are a Must have (first rated Could have in SQ2; revised after the conflict with SQ1 was resolved) | SQ2, SQ8 |
| 11 | Scope Definition | Out of scope: real company accounts, private repositories, live production data | SQ3 |
| 12 | Scope Definition | Guardrails must exist before any write action is built | SQ4 |
| 13 | Scope Definition | Sequencing is value-first | SQ5 |
| 14 | Scope Definition | No hard deadlines | SQ6 |
| 15 | Scope Definition | Numeric thresholds for the success checks are deferred to Requirements Analysis | SQ7 |
| 16 | Approval & Handoff | Intent and scope carried forward as written | AQ1 |
| 17 | Approval & Handoff | Acknowledged risks: no numeric thresholds, write actions not chosen, hosting/dashboard/extra tools undecided, records are public | AQ2 |
| 18 | Approval & Handoff | Resources: personal time only | AQ3 |
| 19 | Approval & Handoff | Staffing: owner alone with AI assistants | AQ4 |

## Assumptions & Open Questions

None.
