# Requirements

Sources: answers in `requirements-analysis-questions.md` (RQ1-RQ14), the Ideation artifacts `../../ideation/intent-capture/intent-statement.md` (IS), `../../ideation/scope-definition/scope-document.md` (SD), `../../ideation/scope-definition/intent-backlog.md` (IB), the affirmed practices in `../practices-discovery/team-practices.md` (TP) and `../practices-discovery/discovered-rules.md` (DR), and the original project description (Desc). The origin of each requirement is shown in square brackets.

## Intent Analysis

- Goal: a portfolio demonstration of safe-agent design. A server that gives AI agents safe, auditable tools for a developer platform, covering dependency-upgrade planning and CI failure triage, with guardrails (read-only by default, approval-gated writes, audit log, rate limits), tests, and a README that links the AI-DLC records [IS; Desc].
- Type: new build (greenfield). Scope: a single product with two tool areas and a shared guardrail layer. Complexity: standard [IS; SD].
- Audience: platform/DevOps engineers, application developers, and reviewers or peers [IS].

## Functional Requirements

### FR1 Dependency-upgrade planning (read-only)

- FR1.1 The system shall, given a repository, list each outdated dependency with its current version and a target version [RQ8; SD item 1].
  - Pass/fail: given a sample repository whose dependency files contain N known-outdated dependencies, the plan lists exactly those N, each with current and target versions.
- FR1.2 The system shall give each proposed upgrade a risk rating of patch, minor, or major, with a reason [RQ8].
  - Pass/fail: for each listed upgrade the rating matches the version change type, and a non-empty reason is present.
- FR1.3 The system shall recommend an order for the upgrades and state the reason for the order [RQ8].
  - Pass/fail: the plan contains an ordered list, and each entry carries a reason.
- FR1.4 The system shall list known public security advisories that an upgrade fixes [RQ8].
  - Pass/fail: for a snapshot dependency with a known advisory, the plan lists that advisory against the upgrade that fixes it.
- FR1.5 Dependency-upgrade planning shall not change the analysed repository [SD; IS].
  - Pass/fail: after a plan is produced, the analysed repository content is byte-for-byte unchanged.

### FR2 CI failure triage (read-only)

- FR2.1 The system shall assign each failed CI run a failure category, such as test failure, build error, lint error, dependency problem, or flaky/infrastructure [RQ9; SD item 2].
  - Pass/fail: for each failed-run snapshot with a known cause type, the assigned category equals the expected category.
- FR2.2 The system shall identify the failing step and the key log lines that show why it failed [RQ9].
  - Pass/fail: the report names the failing step and quotes at least one log line that appears in the source log.
- FR2.3 The system shall state a suspected cause and a suggested next action [RQ9].
  - Pass/fail: both fields are present and non-empty in every report.
- FR2.4 The system shall state whether the same failure appears in earlier runs [RQ9].
  - Pass/fail: for a snapshot with a repeated failure, the report reports the earlier occurrences; for a first-time failure, it says there are none.
- FR2.5 CI failure triage shall not change the analysed run or repository [SD; IS].
  - Pass/fail: no write operation is performed by the triage tool.

### FR3 Data sources

- FR3.1 The system shall read public GitHub repositories and their public CI runs through the public API, read-only, without requiring a login [RQ2, RQ11].
  - Pass/fail: reading a public repository works with no credentials configured.
- FR3.2 The system shall ship saved snapshots of a few chosen public repositories and CI runs, and the automated tests and the documented walkthrough shall use only those snapshots [RQ14; TP; DR].
  - Pass/fail: the full test suite and the walkthrough pass with the network disabled.
- FR3.3 Live reading of public GitHub shall be an optional extra whose output may differ from the snapshots [RQ14].
  - Pass/fail: with live reading disabled (the default), no network call is made.
- FR3.4 The system shall not read private repositories, use real credentials, or use production data [SD out of scope; DR].
  - Pass/fail: tests and fixtures contain no real credentials, and no tool accepts a private-repository reference.

### FR4 Approval-gated write action

- FR4.1 The only write action in the first version shall be re-running a failed CI job, and it shall act only on a simulated CI system inside this project [RQ1, RQ11; SD item 3].
  - Pass/fail: no code path performs a write against real GitHub or any real CI service.
- FR4.2 The system shall refuse every write unless a valid approval is presented [IS; SD; RQ3].
  - Pass/fail: a re-run request with no approval is refused, and the simulated CI system is verified unchanged.
- FR4.3 Approval shall be a separate human step outside the agent's control: the agent asks for a write, the system returns an approval request, and a human approves it [RQ3].
  - Pass/fail: an agent cannot complete a write using only its own tool calls; approval requires the separate human step.
- FR4.4 An approval shall be one-time, bound to the exact action and inputs the human saw, and shall expire [RQ3].
  - Pass/fail: an approval is refused when it is reused, expired, issued for a different action, or issued for different inputs, and in each case the simulated CI system is unchanged.

### FR5 Read-only by default and single guardrail path

- FR5.1 Every tool shall be read-only unless it is registered as a write tool that requires approval [IS; SD item 6; DR].
  - Pass/fail: a test enumerates all registered tools and fails if any state-changing tool is reachable without the approval step.
- FR5.2 Every tool shall pass through one shared wrapper that applies the approval check, the audit record, and the rate limit [DR].
  - Pass/fail: a test fails if any tool is registered without the wrapper.

### FR6 Audit log

- FR6.1 The system shall write exactly one audit record for every tool call, whether the call is allowed, refused, rate-limited, or ends in an error [RQ5; IS; DR].
  - Pass/fail: for each of the four outcomes, exactly one record is written, including when the tool handler itself fails.
- FR6.2 The audit log shall be a local append-only file with one JSON record per line, each containing timestamp, tool name, calling client, redacted inputs, and outcome [RQ5].
  - Pass/fail: each line parses as JSON and contains all five fields; existing lines are never modified.
- FR6.3 The system shall redact secrets from audit records [DR].
  - Pass/fail: a call whose inputs include a secret-like value produces a record in which that value does not appear.
- FR6.4 If an audit record cannot be written, the system shall refuse the call when it is a write, and shall continue and report the failure when it is a read [RQ6, RQ12].
  - Pass/fail: with the log made unwritable, a write is refused and the simulated CI system is unchanged, while a read still returns its result along with a reported failure.

### FR7 Rate limits

- FR7.1 The system shall reject calls beyond 30 read calls per minute and beyond 3 write calls per minute, for each tool-calling client [RQ4; IS].
  - Pass/fail: using an injected clock, the 30th read in a minute succeeds and the 31st is rejected; the 3rd write succeeds and the 4th is rejected; calls succeed again after the minute passes.
- FR7.2 A rate-limited call shall be rejected with a defined error and shall be audit-logged [RQ4, RQ5].
  - Pass/fail: a rejected call returns the defined error and produces one audit record with outcome rate-limited.

### FR8 Connection

- FR8.1 The system shall run as a local process that the agent starts and talks to over standard input and output [RQ7].
  - Pass/fail: an in-process test client completes calls over this connection.
- FR8.2 The system shall also offer an optional HTTP mode that listens on this computer only and requires a secret access token on every request [RQ7, RQ13].
  - Pass/fail: in HTTP mode, a request with no token or a wrong token is refused, and the listener is not reachable from another computer.

### FR9 Documentation and reproducibility

- FR9.1 The README shall give local setup instructions and link the AI-DLC inception and construction records [IS; Desc; RQ10; TP].
  - Pass/fail: the README contains setup steps and working links to both record sets.
- FR9.2 A reader who clones the repository, installs it, runs one documented test command that passes, and runs the server against the bundled snapshots shall get the documented example outputs for upgrade planning, CI triage, a refused write, a rate-limited call, and an audit record [RQ10, RQ14].
  - Pass/fail: following the README steps on a clean checkout produces each of the five documented outputs.

## Non-Functional Requirements

- NFR1 Security: the system shall validate every tool input at the boundary and treat text from outside sources (CI logs, changelogs, advisory text) as untrusted, so that such text can never by itself trigger a write [DR; IS]. Pass/fail: a test that puts instruction-like text in a log snapshot shows no write is triggered.
- NFR2 Secrets: the code, fixtures, and logs shall contain no real credentials; secrets are read from the environment only [DR; TP]. Pass/fail: the secret scan in the automatic checks passes with no findings.
- NFR3 Test coverage: overall coverage shall be at least 90%, and the guardrail code (approval, audit log, rate limiter) shall have 100% line and branch coverage [TP; IS]. Pass/fail: the coverage report meets both thresholds, and the check fails the build below them.
- NFR4 Test method: tests shall be behaviour-style (Given/When/Then), written alongside the code, and automated tests shall cover refused writes, one audit record per call, and rate-limit rejection [TP; DR]. Pass/fail: each of the three behaviours has at least one automated test that passes.
- NFR5 Determinism: tests shall not depend on the network or the real clock [TP; RQ14]. Pass/fail: the test suite passes with the network disabled and uses an injected clock for rate-limit tests.
- NFR6 Code quality: the code shall be strict TypeScript, formatted with Prettier, linted with ESLint, and pass a type-check, all enforced as automatic checks that block merging [TP]. Pass/fail: all four checks pass on every merged pull request.
- NFR7 Supply chain: the repository shall have a committed lockfile, pinned GitHub Actions versions, a small justified set of dependencies, and a SECURITY.md [TP]. Pass/fail: each item exists in the repository when the project is complete.
- NFR8 Reproducibility: the walkthrough in FR9.2 shall work with no setup beyond the documented prerequisites [IS; RQ10]. Pass/fail: a person follows the README on a clean machine and each step succeeds.

## Constraints

- Only synthetic or public data is used; no real company accounts, private repositories, or live production data [IS; SD].
- The server is written in TypeScript [Desc; TP].
- Deployment is local; there is no hosted service [TP].
- The repository is public on GitHub and the automatic checks run on GitHub Actions [TP; RQ14 context].
- Work merges through short-lived branches and pull requests with required checks [TP].

## Assumptions

- The "calling client" for rate limits and audit records is the identity of the connected agent session. This is an assumption; the means of identifying a client is an open question.
- The simulated CI system is a local, in-project stand-in that models job runs and re-runs; its design is deferred to later stages.

## Out of Scope

- Real company accounts, private repositories, and live production data [SD; RQ11].
- Write actions other than re-running a failed CI job: applying upgrades, opening change requests, and posting comments [RQ1].

## Open Questions

- How long an approval stays valid before it expires (the number) is not defined; it is needed to test FR4.4.
- How a client is identified for per-client rate limits and audit records.
- Where the audit file lives, and whether it rotates.
- The rule for choosing a target version in an upgrade plan (for example latest, or latest compatible).
- Which public repositories and CI runs are captured as snapshots.
- How the access token for HTTP mode is created and supplied.
- Whether hosting, a graphical interface, or further tool areas are ever added (undecided in Scope Definition).
