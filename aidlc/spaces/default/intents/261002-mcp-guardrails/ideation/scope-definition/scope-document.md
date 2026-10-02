# Scope Document

Sources: answers in `scope-definition-questions.md` (cited as SQ1-SQ9), the confirmed intent in `../intent-capture/intent-statement.md` (cited as IS), and the original project description (cited as Desc).

## Purpose

- The project is mainly a portfolio demonstration of safe-agent design for a developer platform; the problem it addresses is secondary (IS, Problem Statement).
- The confirmed product boundary is an assistant-facing tool server covering two tool areas, dependency-upgrade planning and CI failure triage, with the guardrails named in the description (IS, Initial Scope Signal; Desc).

## In Scope (minimum version)

The minimum version is the smallest complete version that still shows safe-agent design (SQ1, SQ8, SQ9).

| # | Capability | Priority | Source |
|---|-----------|----------|--------|
| 1 | Dependency-upgrade planning: read-only analysis of a repository's dependencies | Must have | SQ1 |
| 2 | CI failure triage: read-only analysis of failed pipeline runs | Must have | SQ1 |
| 3 | Approval-gated write actions: a change is made only after explicit approval | Must have | SQ1, SQ2, SQ8 |
| 4 | Audit log of every tool call | Must have | SQ9 |
| 5 | Call-rate limits that reject excess calls | Must have | SQ9 |
| 6 | Read-only by default, so nothing can change without going through the approval step | Must have | Desc; IS |

Notes:
- Write actions were first rated "Could have" in SQ2 and revised to "Must have" after the conflict with SQ1 was resolved in SQ8.
- The data constraint applies throughout: only synthetic or public data is used (Desc).
- Tests and a README linking the AI-DLC inception and construction records are deliverables of the project (Desc; IS, Success Metrics).

## Out of Scope

| Item | Source |
|------|--------|
| Real company accounts, private repositories, or live production data | SQ3 |

## Not Yet Decided

These were offered in SQ3 and not selected, so they are neither included nor excluded; they remain open for later stages.

- Hosting or deploying the server as a running service
- A graphical user interface or dashboard
- Tool areas beyond upgrade planning and CI triage

## Dependencies Between Capabilities

- Guardrails (approval step, audit log, rate limits) must exist before any write action is built; read-only analysis can come first (SQ4).

## Sequencing Preference

- Value-first: deliver the most visible, demonstrable capability early (SQ5).
- This is applied within the dependency rule above, so the two read-only tool areas come first, then the guardrails, then the approval-gated write actions.

## Deadlines

- None (SQ6).

## Value Stream Map

| Step | What happens | Outcome for the audience |
|------|--------------|--------------------------|
| 1 | An agent asks for an upgrade plan or a CI failure diagnosis | A useful read-only answer with no risk of change (SQ1, SQ4) |
| 2 | The call is checked against the rate limits and recorded in the audit log | Excess calls are rejected and every call leaves evidence (SQ9) |
| 3 | The agent asks to make a change | The change is refused unless explicit approval is given (SQ1, SQ8) |
| 4 | A reviewer reads the README and the linked AI-DLC records | The reviewer can trace and reproduce the result (IS, Success Metrics) |

## Assumptions & Open Questions

- Exact thresholds for "works end to end", the rate limit, and "reproduce the results" are not defined here. They are deferred to Requirements Analysis (SQ7).
- Which specific write actions are offered is not defined; at least one approval-gated write action is required (SQ2, SQ8).
