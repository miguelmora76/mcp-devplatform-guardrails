# NFR Design — Questions

Context carried over (not re-asked): the ten NFR Requirements answers (read speed, up to 5 clients, 10 s timeout with 3 retries, JSON logs to standard error, 5-minute approvals, session ID / token-name identity, latest-stable upgrade target, Node LTS with npm, Vitest, gitleaks). The platform engineer's cloud and infrastructure material does not apply: the project is a local process with no hosted service, so there is nothing to design for cloud networking, cost, or environments.

These seven questions settle design gaps that the NFR Requirements review left open or that were carried as assumptions. The first option in each is my recommendation. Fill each `[Answer]:` tag with a letter (A-E, or X for your own wording).

## Q1. How does a human approve a write, outside the agent's reach?

Why we ask: the whole write guardrail rests on the agent being unable to approve its own request (NFR1.3). The agent talks to the server through its tools, so the approval step must use a path the agent has no tool for.

- A. The server prints the approval request (what, which inputs, a short code) to its own terminal; the human runs a separate local command, `approve <code>`, that talks to the running server over a local-only channel (a socket file readable only by the current user). Works in both connection modes.
- B. In HTTP mode only: a separate approval page or endpoint protected by a human credential that is never given to an agent client; local process mode has no write approval (writes are always refused there).
- C. The human edits a local approvals file by hand (listing the approval code), which the server watches.
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q2. How should the audit file count a write, given it is recorded twice (before and after the change)?

Why we ask: to refuse a write if auditing fails, the server records an intent line first and an outcome line after (NFR1.5). The review found that this conflicts with "exactly one audit record per call" in three requirements and in the project rule that tests verify one record per call.

- A. Keep "one record per call" as a logical record: a write has two lines that share one call ID (phase `intent`, then phase `outcome`), counted as one call; reads and refusals have one line. The tests count call IDs, not lines.
- B. Change the rule to "one line per read or refusal, two lines per write", and update the requirement wording and the tests to match.
- C. Write a single line only, after the change, and instead check up front that the audit file is writable (accepting that a failure between the change and the line leaves an unaudited write).
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q3. Where does the audit file live by default, and does it rotate?

Why we ask: a default path is needed for the README walkthrough; rotation was left open in the requirements. At the highest load the file grows about 10 MB per hour, with a 100 MiB cap proposed.

- A. `./audit/audit.jsonl` in the folder the server is started from, overridable by an environment variable; no rotation in the first version; at the 100 MiB cap writes are refused and reads continue with a reported failure
- B. A per-user data folder (for example under the home directory), overridable by an environment variable; no rotation; same cap behaviour
- C. Same as A, but rotate to a new file at 100 MiB instead of refusing
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q4. How are the HTTP-mode access tokens created and supplied?

Why we ask: each of the up to 5 clients needs its own named token (NFR1.4), and the token must never be stored in the repository.

- A. A helper command generates a random token for a client name and prints it once; the server reads a `name=token` list from one environment variable (comma-separated) at start
- B. The server reads a small JSON file (kept outside the repository and listed in `.gitignore`) mapping names to tokens
- C. The server generates tokens at start and prints them to its terminal once
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q5. What counts as a "client" for the 5-client limit and for rate limits in HTTP mode?

Why we ask: a token and a connection are different things, and the failed-login throttle (NFR1.16) must not let one bad caller lock out everyone.

- A. A client is a token (its name). One token may hold several connections that share its single rate limit; a sixth distinct token is not accepted by configuration (at most 5 tokens are configured). Failed-login throttling is counted per source connection, not globally.
- B. A client is a connection: each connection gets its own limit, up to 5 connections in total, regardless of token
- C. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q6. Which hosts may the optional live reader contact?

Why we ask: live reading is off by default, but GitHub serves CI log downloads from a different storage host after a redirect, which the "no redirect to another host" rule would block.

- A. Only `api.github.com` and `github.com`; redirects are refused, so live reading covers repository files, versions and run metadata but not raw CI log downloads (logs come from the bundled snapshots). State this limit in the README.
- B. Also allow the exact storage host GitHub redirects log downloads to, matched by an exact name allow-list, for that one request type
- C. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q7. Do you confirm the two runtime libraries proposed for the protocol and for input validation?

Why we ask: the requirements keep dependencies small and justified (NFR7.3). The official TypeScript MCP SDK (protocol and standard-input/output connection) and the validation library it already uses (zod) are the only runtime dependencies expected. Exact versions are checked and pinned when the project is set up.

- A. Yes: the official MCP TypeScript SDK and zod are the only runtime dependencies
- B. Use the SDK but write the input checks by hand (no zod)
- C. Write the protocol handling by hand (no SDK)
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct
