# Requirements Analysis — Questions

Context from earlier stages (not re-asked): the minimum version has dependency-upgrade planning, CI failure triage, approval-gated write actions, an audit log, call-rate limits, and read-only behaviour by default; only synthetic or public data is used; the server is written in TypeScript and deployed locally; tests are behaviour-style with 90% coverage (100% on the guardrail code); the success checks "works end to end", the rate-limit number, and "reproduce the results" were deferred to this stage.

The options below are proposals for you to choose from. Fill in each `[Answer]:` tag with a letter (A-E, or X for your own wording). Every question has a "not yet defined" option.

## Q1. Which approval-gated write actions should the first version offer? (select all that apply)

Why we ask: you require at least one write action, but have not chosen which. Because only synthetic or public data is used, each write acts on a synthetic sample repository or a local sandbox, never a real one.

- A. Apply a proposed dependency upgrade (edit the sample repo's dependency files on a new branch)
- B. Open a change request for a proposed upgrade (a simulated pull request in the sandbox)
- C. Re-run a failed CI job (in a simulated CI system)
- D. Post a triage summary as a comment on a failed run (in a simulated CI system)
- E. Not yet defined
- X. Other (please specify)

[Answer]: C

## Q2. What synthetic or public data stands in for the repositories and CI runs the tools analyse?

Why we ask: the tools need something to read. The quality engineer recommends no live network calls in the default test run.

- A. Synthetic sample repositories and recorded CI logs stored as files inside this project
- B. Public GitHub repositories and their public CI runs, read through the public API
- C. Both: bundled samples for tests and demos, public repositories as an optional extra
- D. Not yet defined
- X. Other (please specify)

[Answer]: B

## Q3. How should a human give explicit approval for a write action?

Why we ask: this is the core guardrail, so we need an exact rule. A "bound" approval means it only covers the exact action and inputs the human saw, so it cannot be reused for something else.

- A. The agent first asks for a write; the server returns an approval request; the human approves it outside the agent's control (for example with a separate command or prompt), producing a one-time approval bound to that exact action and inputs that expires after a short time
- B. The server asks the human directly through the client's built-in confirmation prompt, one prompt per write
- C. A pre-approved list in a local configuration file of the write actions that are allowed
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q4. What call-rate limits should apply?

Why we ask: you asked for rate limits that reject excess calls, and the numbers were deferred here. These are proposals so tests can check the exact boundary; limits would apply per tool-calling client.

- A. Read tools: 60 calls per minute; write tools: 5 calls per minute
- B. Read tools: 30 calls per minute; write tools: 3 calls per minute
- C. One overall limit of 30 calls per minute across all tools
- D. Not yet defined
- X. Other (please specify the numbers and window)

[Answer]: B

## Q5. Where should the audit log be stored, and what should each record contain?

Why we ask: every call, including refused, rate-limited and failed ones, leaves exactly one record. The practices rule is that secrets are never logged.

- A. A local append-only file with one JSON record per line, containing timestamp, tool name, calling client, a redacted copy of the inputs, and the outcome (allowed, refused, rate-limited, or error)
- B. The same fields, written to the standard error stream only
- C. The same fields, stored in a local database file
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q6. If the audit log cannot be written, what should happen to the call?

Why we ask: this is a safety decision. Failing closed means no action happens without a record; failing open keeps the tool working but loses evidence.

- A. Fail closed for write calls (refuse them) and for read calls too (refuse everything)
- B. Fail closed for write calls only; read calls continue and the failure is reported
- C. Fail open: continue and report the failure
- D. Not yet defined
- X. Other (please specify)

[Answer]: B

Note: originally answered C (carry on); revised to B (writes fail closed, reads carry on) by the resolution in Q12.

## Q7. How does an agent connect to the server?

Why we ask: deployment is local, which usually means the agent starts the server directly on your machine. A network option would change the security requirements.

- A. Local process only (the agent starts the server and talks to it over standard input and output)
- B. Local process plus an optional local network (HTTP) mode
- C. Not yet defined
- X. Other (please specify)

[Answer]: B

## Q8. What should a dependency-upgrade plan contain? (select all that apply)

Why we ask: "upgrade planning" needs concrete outputs so it can be tested against a sample repository.

- A. Each outdated dependency with its current version and a target version
- B. A risk rating per upgrade (for example patch, minor, major) with the reason
- C. A recommended order of upgrades, with the reason for the order
- D. Known security advisories that the upgrade fixes (from public advisory data)
- E. Not yet defined
- X. Other (please specify)

[Answer]: A, B, C, D

## Q9. What should a CI failure triage report contain? (select all that apply)

Why we ask: "failure triage" needs concrete outputs so it can be tested against sample failed runs.

- A. A category for the failure (for example test failure, build error, lint error, dependency problem, flaky or infrastructure)
- B. The failing step and the key lines from the log that show why
- C. A suspected cause and a suggested next action
- D. Whether the same failure appears in earlier runs
- E. Not yet defined
- X. Other (please specify)

[Answer]: A, B, C, D

## Q10. What counts as "works end to end" and "a reader can reproduce the results"?

Why we ask: both were left as vague success checks in Intent Capture and now need pass/fail definitions.

- A. A reader clones the repo, installs, runs one documented test command that passes, then runs the server against the bundled sample data and gets the documented example outputs for upgrade planning, CI triage, a refused write, a rate-limited call, and an audit record
- B. The same as A, plus a recorded transcript or screenshots of an agent using the tools
- C. Only the automated tests need to pass; no separate walkthrough
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q11. Follow-up: how do the CI re-run write action (Q1) and reading public GitHub data (Q2) fit together?

Why we ask: in Q1 the re-run happens in a simulated CI system, but Q2 reads real public GitHub repositories. You cannot re-run a job on someone else's public repository, and scope rules out real accounts and live data. We need one consistent picture of where the write lands.

- A. Read from public GitHub repositories (read-only, no login needed), but the approval-gated re-run acts only on a simulated CI system inside this project
- B. Read from public GitHub, and the re-run acts on a sandbox repository that you own on GitHub (this would need a GitHub access token with write permission to that repo)
- C. Switch the data source to bundled samples (Q2 option A), so reads and the re-run both use the simulated CI system
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q12. Follow-up: audit-log failure policy (Q6) versus "every call is audit-logged"

Why we ask: in Q6 you chose to carry on when the audit log cannot be written (fail open). But your success check says every call is audit-logged, and the rule you affirmed says tools are auditable and writes need approval. With fail-open, a write could happen with no record at all. We need one consistent policy.

- A. Writes fail closed (refused if the audit record cannot be written); reads carry on and the failure is reported
- B. Keep fail-open for everything, and record in the requirements that a write may occur without an audit record when logging fails (an accepted risk)
- C. Refuse everything when the audit log cannot be written
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q13. Follow-up: protecting the optional HTTP mode (Q7)

Why we ask: in Q7 you chose to allow an optional local network (HTTP) mode. Unlike the local-process mode, anything that can reach that port could call the tools, so the guardrails need a rule for who may connect.

- A. Listen on this computer only (localhost) and require a secret access token on every request
- B. Listen on this computer only (localhost) with no token
- C. Allow connections from other computers too, with a secret access token
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q14. Follow-up: reproducible results when the data comes from public GitHub (Q2, Q10)

Why we ask: in Q10 a reader should get the documented example outputs from "the bundled sample data", but in Q2 the data comes live from public GitHub, where repositories and CI runs change over time. Tests also should not depend on the network, so we need to say what is bundled.

- A. Bundle saved snapshots of a few chosen public repositories and CI runs; tests and the walkthrough use the snapshots, and live reading of public GitHub is an optional extra that may give different output
- B. No snapshots: tests and the walkthrough read live public GitHub, and output may vary over time (accepted)
- C. Not yet defined
- X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
