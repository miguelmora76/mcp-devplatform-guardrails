# Tech Stack Decisions

Scope: the whole server. Decisions come from the confirmed answers (Q8, Q9, Q10), the affirmed practices (`team.md`, `project.md`), and the requirements. Items marked [assumption] are proposals not yet confirmed by the user. Exact versions are verified and pinned when the project is set up (Code Generation), never guessed here. Source tags: `[Qn]` = answer in `nfr-requirements-questions.md`; `[FRn.m]`/`[NFRn]` = requirements.md; `[TP]` = `team-practices.md`.

## Decisions

| Area | Decision | Why | Alternatives rejected | Source |
|------|----------|-----|-----------------------|--------|
| Language | TypeScript with strict mode | Required by the project description and team practice | Plain JavaScript: loses the type guarantees the guardrail code relies on | NFR6, TP |
| Runtime | Current long-term-support Node.js, pinned in the repo (`.nvmrc` and the `engines` field) | Stable, supported, and easy for a reader to install | Bun or Deno: less familiar to reviewers and adds setup risk for a reproducible walkthrough | Q8 |
| Package manager | npm, with a committed `package-lock.json` and `npm ci` in CI | Ships with Node, so there is nothing extra to install | pnpm: faster but one more tool to install and document | Q8, NFR7.1 |
| Test framework and coverage | Vitest with built-in coverage (V8 provider), line and branch | Native TypeScript, fast, supports per-path coverage thresholds and fake timers | Jest: heavier TypeScript setup; Node test runner: weaker coverage thresholds and mocking | Q9, NFR3 |
| Formatter / linter / type-check | Prettier; ESLint with typescript-eslint; `tsc --noEmit` | Named in team practice; all three block merge | None considered: affirmed by the team | NFR6, TP |
| Secret scanning | gitleaks as a pre-commit hook and in GitHub Actions, plus GitHub secret scanning with push protection | Fast, one config, same tool locally and in CI | detect-secrets: needs a baseline file to maintain | Q10, NFR2.3 |
| CI | GitHub Actions, actions pinned to full commit SHAs; CodeQL; dependency-review; automatic dependency updates | Team practice | Other CI services: no benefit for a public GitHub repository | NFR7, TP |
| Audit log | Local append-only JSON-lines file | Simple, human-readable, easy to test | SQLite: more power than needed and a native dependency; stdout logging: not durable | FR6.2 |
| HTTP listener | Node's built-in HTTP server on the loopback address only (optional mode) | No extra dependency | A web framework: adds dependencies for one endpoint | FR8.2, NFR7.3 |
| GitHub access (live mode) | Built-in `fetch` with the timeout and retry rules in NFR4.5 | No extra dependency; unauthenticated public reads only | Octokit client: larger dependency, authentication features we must not use | FR3.1, NFR7.3 |
| MCP protocol layer [assumption] | The official TypeScript MCP SDK for the protocol and stdio transport | Avoids re-implementing the protocol; the project is an MCP server | Hand-written protocol code: more code to test and secure. To be confirmed in NFR Design / Code Generation after checking the SDK's current version and dependency footprint | FR8.1 |
| Input validation [assumption] | A schema library (zod, which the MCP SDK already uses) at the tool boundary | Reuses a dependency the SDK brings; one schema per tool | Hand-written checks: error-prone; a second validation library: duplicate dependency | NFR1.1 |

## Dependency justification table (NFR7.3)

Runtime dependencies are limited to: the MCP SDK and its schema library (both [assumption], confirm at design). Everything else is built in. Development dependencies: TypeScript, Vitest and its coverage provider, ESLint with typescript-eslint, Prettier. Each addition during Code Generation gets a one-line justification here; the final list is checked against the manifest.

## Quality, testing, and reproducibility requirements

| ID | Requirement | Pass/fail | Source |
|----|-------------|-----------|--------|
| NFR3.1 | Overall line coverage shall be at least 90%. | The coverage report meets the threshold and CI fails below it. | NFR3, Q9 |
| NFR3.2 | The guardrail modules (approval, audit log, rate limiter, and the shared tool wrapper that applies them) shall have 100% line and 100% branch coverage, enforced by per-path thresholds. | CI fails when any of those files is below 100% line or branch. | NFR3 |
| NFR3.3 | Coverage thresholds shall never be lowered, and excluded files shall be listed in the configuration with a reason, so a threshold cannot be met by exclusion. | The configuration is reviewed on every pull request; a lowered threshold or unexplained exclusion is a review failure. | NFR3, org rule |
| NFR4.1 | Tests shall be behaviour-style (Given/When/Then), written alongside the code in the same change. | Each test names its scenario in Given/When/Then form; a pull request that adds behaviour without tests is rejected in review. | NFR4, TP |
| NFR4.3 | A test shall enumerate all registered tools and fail if any state-changing tool is reachable without the approval step, or any tool is registered without the shared wrapper. | The enumeration test exists and passes; adding an unwrapped tool in a trial change makes it fail. | FR5.1, FR5.2 |
| NFR4.4 | Tests for refused writes, one audit record per call (NFR4.2), and rate-limit rejection shall each exist and pass. | One or more named tests per behaviour pass. | NFR4 |
| NFR5.1 | The test suite shall pass with the network disabled; any attempt to open a network connection during a test shall fail the test. | The suite runs in CI with outbound network blocked or with a global guard that throws on socket creation. | NFR5, FR3.2 |
| NFR5.2 | Time shall be injected (a clock interface) for rate limits, approval expiry, timeouts, and backoff; no unit test reads the real clock or sleeps. | A lint or review rule forbids real timers in unit tests; the rate-limit tests run in a fake clock. | NFR5, FR7.1 |
| NFR5.3 | Identifiers and randomness (session IDs, approval IDs) shall be injectable so tests are repeatable. | Tests assert exact IDs through the injected source. | NFR5 |
| NFR6.1 | TypeScript strict mode shall be on (including strict null checks and no implicit any). | `tsc --noEmit` passes with the strict settings committed. | NFR6, TP |
| NFR6.2 | Prettier formatting shall be enforced. | The format check passes in CI. | NFR6 |
| NFR6.3 | ESLint shall pass with no errors. | The lint step passes in CI. | NFR6 |
| NFR6.4 | A type-check step shall run separately in CI. | The type-check job passes. | NFR6 |
| NFR6.5 | Format, lint, type-check, tests, coverage, and security checks shall be required checks on pull requests into `main`. | Branch protection lists them; a failing check blocks merge. | NFR6, TP |
| NFR8.7 | The README shall give exact setup steps: install the pinned Node.js version, `npm ci`, one documented test command, and the commands that run the server against the bundled snapshots. | A reader follows the steps on a clean machine and each succeeds. | NFR8, FR9 |
| NFR8.8 | The Node.js version shall be pinned in `.nvmrc` and the `engines` field, and CI shall use that same version. | CI reads the pinned version; a mismatch fails. | NFR8, Q8 |

## Sources

- [Q8] Node LTS and npm; [Q9] Vitest; [Q10] gitleaks; [Q3] and [Q4] for fetch and logging; [FR3.1], [FR3.2], [FR5.1], [FR5.2], [FR6.2], [FR8]; [NFR3]-[NFR8]; [TP] and `project.md` practices.

## Assumptions & Open Questions

- [assumption] The MCP SDK and zod choices above are proposals; they are the only runtime dependencies expected and need confirming (with current versions) before Code Generation adds them.
- [assumption] "Current LTS" is resolved at project setup and recorded in `.nvmrc`; this stage does not name a version number.
- Open: which public repositories and CI runs are captured as snapshots (requirements.md open question) is a later-stage decision and does not affect these NFRs.
