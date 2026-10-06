<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-05T00:00:00Z — Treated the platform engineer role as not applicable: local process, no cloud design; recorded in logical-components.md.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-05T00:00:00Z — Design refines three approved requirement wordings (audit counting by call ID, client = token with per-connection throttle, approval validity from human approval); flagged under "Requirement clarifications" for the gate.

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-05T00:00:00Z — Intent-then-outcome audit lines for writes (two lines, one call ID) over a single after-the-fact line, to keep fail-closed honest; no circuit breaker because there is one optional dependency.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-05T00:00:00Z — Windows support for the admin socket (out of scope for v1); whether an agent able to drive an interactive terminal as the same OS user can self-approve (accepted risk).
