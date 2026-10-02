# Intent Backlog

Prioritised proto-Units using MoSCoW. Sources: `scope-definition-questions.md` (SQ1-SQ9), `../intent-capture/intent-statement.md` (IS), and the original project description (Desc). Ordering follows the value-first preference within the dependency rule that guardrails come before write actions (SQ4, SQ5).

## Backlog

| Order | Proto-Unit | MoSCoW | Depends on | Value | Source |
|-------|-----------|--------|------------|-------|--------|
| 1 | Dependency-upgrade planning (read-only) | Must | None | Shows the first useful agent tool; removes slow manual upgrade planning | SQ1, SQ5; IS Target Customer |
| 2 | CI failure triage (read-only) | Must | None | Shows the second useful agent tool; removes slow, repetitive diagnosis | SQ1, SQ5; IS Target Customer |
| 3 | Read-only-by-default behaviour | Must | None | Establishes that nothing changes without approval | Desc; IS |
| 4 | Audit log of every tool call | Must | 1, 2 | Gives reviewers evidence of what each call did | SQ9; IS Success Metrics |
| 5 | Call-rate limits | Must | 1, 2 | Shows excess calls are rejected | SQ9; IS Success Metrics |
| 6 | Approval-gated write actions | Must | 3, 4, 5 | Shows the riskiest capability held safe behind explicit approval | SQ1, SQ2, SQ4, SQ8 |
| 7 | Tests proving the guardrails | Must | 3, 4, 5, 6 | Proves writes are refused without approval and limits and logging work | Desc; IS Success Metrics |
| 8 | README linking the AI-DLC inception and construction records | Must | All | Lets a reviewer trace and reproduce the result | Desc; IS Success Metrics |

Capabilities 1, 2 and 3 can start in parallel; 4 and 5 follow once there are tools to protect; 6 waits for 3, 4 and 5 (SQ4).

## Won't Have (this time)

| Item | Source |
|------|--------|
| Real company accounts, private repositories, or live production data | SQ3 |

## Not Yet Decided

Neither included nor excluded; to be revisited in later stages if relevant (SQ3): hosting or deploying as a running service, a graphical user interface or dashboard, and tool areas beyond upgrade planning and CI triage.

## Assumptions & Open Questions

- Numeric thresholds and exact definitions for the success checks are deferred to Requirements Analysis (SQ7).
- The set of write actions to offer is not yet chosen (SQ2, SQ8).
