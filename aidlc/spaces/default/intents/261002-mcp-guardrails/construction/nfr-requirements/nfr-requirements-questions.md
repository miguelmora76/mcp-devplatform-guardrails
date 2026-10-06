# NFR Requirements — Questions

Context carried over (not re-asked): a local TypeScript tool server; read tools default, one approval-gated write (re-run a failed CI job in a simulated CI system); tests and walkthrough use bundled snapshots with no network; optional live public-GitHub reading; rate limits of 30 read and 3 write calls per minute per client; local append-only JSON-lines audit log, writes refused if it cannot be written; optional HTTP mode on localhost with a secret token; 90% overall coverage and 100% line and branch on the guardrail code; strict TypeScript with Prettier, ESLint and type-check; GitHub Actions.

Questions 5-7 close the three open gaps the Requirements Analysis review flagged (approval expiry, client identity, upgrade target version). The options are proposals; the first option in each is my recommendation. Fill in each `[Answer]:` tag with a letter (A-E, or X for your own wording). Every question has a "not yet defined" option.

## Q1. How fast should the read tools respond?

Why we ask: performance needs a number that can be tested. These apply to snapshot data on an ordinary developer laptop; live public-GitHub calls depend on the network and are excluded.

- A. 95% of calls finish within 1 second, and no call takes over 5 seconds
- B. 95% of calls finish within 2 seconds, and no call takes over 10 seconds
- C. No timing target for this project
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q2. How many agents are expected to use the server at the same time?

Why we ask: it sets the concurrency the tests must cover. The server runs locally, started by the agent.

- A. One client at a time (a single local session); a second simultaneous client is out of scope
- B. Up to 5 clients at the same time, each with its own rate limit and audit identity
- C. Not yet defined
- X. Other (please specify)

[Answer]: B

## Q3. How should the server behave when live public-GitHub reading fails or is slow?

Why we ask: live reading is optional, but when used it can hit network errors or GitHub's own rate limits, and the failure behaviour must be exact.

- A. Time out each request after 10 seconds, retry up to 3 times with growing waits, then return a clear error without crashing
- B. Time out after 10 seconds and return a clear error immediately, with no retries
- C. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q4. What operational logging should exist besides the audit log?

Why we ask: the audit log records tool calls; this is about the server's own diagnostics (startup, errors, denied connections).

- A. Structured JSON log lines to standard error with levels (error, warn, info, debug); no metrics or tracing
- B. Plain text messages to standard error only
- C. No operational logging beyond the audit log
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q5. How long should an approval stay valid before it expires?

Why we ask: the expiry test cannot be written without a number (review finding on FR4.4). A shorter time is safer; a longer time is more convenient.

- A. 5 minutes
- B. 2 minutes
- C. 15 minutes
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q6. How should a calling client be identified, for rate limits and audit records?

Why we ask: the per-client limits and the "calling client" audit field need a defined identity (review finding on FR7.1 and FR6.2).

- A. Local process mode: a random session ID created each time the server starts. HTTP mode: a name tied to each access token
- B. A fixed identity such as "local" in local process mode (one client), and a name tied to each access token in HTTP mode
- C. The client name and version the agent reports when it connects, in both modes
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q7. How should the target version in an upgrade plan be chosen?

Why we ask: the plan lists a "target version" and rates the upgrade as patch, minor or major from it, so the rule must be exact (review finding on FR1.1 and FR1.2).

- A. The latest stable release (no pre-releases); the risk rating comes from comparing it with the current version
- B. The latest release within the current major version (non-breaking); a newer major version is listed separately as a major upgrade
- C. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q8. Which runtime and package manager should the project use?

Why we ask: this pins the setup steps in the README and the lockfile. Exact versions are verified later, when the project is set up.

- A. The current long-term-support Node.js release (pinned in the repo), with npm
- B. The current long-term-support Node.js release (pinned in the repo), with pnpm
- C. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q9. Which test framework and coverage tool?

Why we ask: the 90% overall and 100% guardrail coverage targets need a tool that measures line and branch coverage and fails the build below the target.

- A. Vitest with built-in coverage (line and branch)
- B. Jest with built-in coverage
- C. Node's built-in test runner with a coverage reporter
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q10. Which local secret scanner should run before each commit?

Why we ask: you chose a local scanner in addition to GitHub secret scanning; this picks which one.

- A. gitleaks, run as a pre-commit hook and again in GitHub Actions
- B. detect-secrets, run as a pre-commit hook and again in GitHub Actions
- C. Not yet defined
- X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct
