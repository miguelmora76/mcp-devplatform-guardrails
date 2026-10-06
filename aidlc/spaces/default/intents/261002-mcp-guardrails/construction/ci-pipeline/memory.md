<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-05T00:00:00Z — Treated the existing workflows as adequate and described them instead of rewriting them; the stage asked only the three questions that earlier answers could not settle (trunk branch, merge protection, publishing).
- 2026-10-05T00:00:00Z — Checked the GitHub repository settings read-only before writing the CI description; found the remote had no main branch and security settings off, which earlier stages had assumed were on.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-05T00:00:00Z — The gitleaks action needs a licence key on organisation-owned repositories; decide between obtaining the key and running the gitleaks command-line tool directly before the first pull request.
