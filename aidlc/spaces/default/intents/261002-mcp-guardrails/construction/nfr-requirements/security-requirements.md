# Security Requirements

Scope: the whole server (one product; no Unit split recorded yet). Detailed IDs extend the inception NFRs in `../../inception/requirements-analysis/requirements.md` (NFR1 security, NFR2 secrets, NFR7 supply chain). Source tags: `[Qn]` = answer in `nfr-requirements-questions.md`; `[FRn.m]`/`[NFRn]` = requirements.md; `[DR]` = `../../inception/practices-discovery/discovered-rules.md`; `[TP]` = `team-practices.md`.

## Context and data classification

- Assets: the simulated CI system state (only write target), the append-only audit log, the HTTP access token, and the saved snapshots (public data only) [FR3.4].
- Data classification: the project handles no personal data and no regulated data (no PII, PHI, or card data). No GDPR, HIPAA, PCI-DSS, or SOC 2 control applies; the compliance agent finds no regulatory requirement for this stage. The one sensitive item is the HTTP access token (restricted: environment variable only, never stored or logged) [NFR2].
- Identity model: a calling client is a random session ID per server start in local mode, and a name tied to each access token in HTTP mode [Q6].
- Trust boundaries: (1) agent to server (all tool arguments are hostile); (2) server to outside text (CI logs, changelogs, advisory text are untrusted data); (3) server to filesystem (audit log, snapshots); (4) HTTP listener to the local network (localhost only).

## Authentication and authorization

| ID | Requirement | Pass/fail | Source |
|----|-------------|-----------|--------|
| NFR1.1 | Every tool input shall be validated against a schema at the boundary (type, length, range, format); unknown fields and oversized values are rejected before the handler runs. | Limits: request body at most 64 KiB; each string argument at most 1024 characters; oversize input is refused (never truncated) with a defined error. A test sends a malformed, an oversized, and an unknown-field input to every registered tool and gets a defined validation error each time, with one audit record and no handler call. | NFR1, FR5.2 |
| NFR1.2 | Text from outside sources (CI logs, changelogs, advisory text) shall be treated as data only. Such text shall never select a tool, supply approval, or change tool arguments. | A snapshot log containing instruction-like text ("re-run the job", "approve", "ignore previous rules") is triaged with no write performed and the simulated CI system unchanged. | NFR1, DR |
| NFR1.3 | An approval shall be (a) issued only through a separate human step that the agent's tool calls cannot invoke, (b) single-use, (c) bound to the exact tool, client, and a digest of the exact inputs the human saw, and (d) valid for 5 minutes from issue. | Tests refuse an approval that is missing, reused, expired, for another action, for different inputs, or presented by a different client; the simulated CI system is unchanged in each case. An approval presented at exactly 5 minutes 0 seconds after issue is accepted and one at 5 minutes 0.001 seconds is refused (injected clock). Agent cannot self-approve: the operation that issues an approval is not registered as a tool, and a test enumerates the tool list and attempts issuance through every agent-reachable path (each registered tool, the stdio stream, and every HTTP route reachable with an agent's token); every attempt fails and the simulated CI system is unchanged. | FR4.2-FR4.4, Q5, Q6 |
| NFR1.4 | HTTP mode shall bind to the loopback address only and require a secret access token on every request. Each of the up to 5 clients has its own token and its own client name; the set of names and tokens is supplied through the environment (a name-to-token map, at least 128 bits of randomness per token). Tokens are compared in constant time. A request with a missing or wrong token is refused without revealing which was wrong. Tokens are never written to any log or audit record. The authenticated client name is the audit identity and rate-limit key (NFR1.8). | Tests: a request with no token and one with a wrong token both get the same refusal; the listener address is the loopback address; two tokens map to two distinct client names, audit identities and rate-limit counters; a token-shaped string never appears in the audit file or operational log after a run. | FR8.2, NFR2, Q6, Q2 |
| NFR1.16 | HTTP mode shall reject requests whose `Host` or `Origin` header is not an expected loopback value (defence against DNS rebinding and browser requests to localhost), and shall throttle failed authentication attempts: after 5 failed attempts within one minute from any source, further attempts are refused for 1 minute without evaluating the token, and each refusal is written to the operational log. | Tests: a request with a foreign `Host` and one with a foreign `Origin` are refused even with a valid token; the 6th failed attempt within a minute is refused without a token comparison, and a valid token is accepted again after the injected clock passes the minute. | FR8.2, NFR1.4 |
| NFR1.5 | A write shall be refused when its audit record cannot be written (fail closed). For a write, an intent record is appended and confirmed written before the state change is made; the outcome record follows after. If the intent record cannot be written, the write is refused and nothing changes. If the outcome record cannot be written after the change, the failure is reported to the client and the operational log, and the intent record already on file shows the write was attempted. | With the audit file made unwritable at call time, a write request is refused and the simulated CI system is unchanged. With the file made unwritable between the intent record and the outcome record, the client receives an audit-failure indicator, standard error holds one error line, and the intent record exists. | FR6.4 |
| NFR1.6 | Repository references shall be restricted to public GitHub `owner/name` pairs or bundled snapshot names; the live reader shall send no credentials. Any reference that cannot be shown to be public or bundled shall be refused. | A test passes a private-looking reference, a URL with embedded credentials, and a path-traversal string; each is refused. The live reader's request headers contain no authorization value, it sends requests only to `api.github.com` and `github.com` (any other host, including via a redirect, is refused), and it follows no redirect to a different host. | FR3.1, FR3.4 |
| NFR1.7 | Error responses shall not reveal stack traces, file-system paths, or secrets; the detail goes to the operational log only. | A test forces an internal error and checks that the client response holds a defined error code and message only. | NFR1, OWASP A09 |
| NFR1.8 | Rate-limit state, approvals, and audit identity shall be isolated per client: one client cannot consume another client's limit or redeem another client's approval. | A test with two clients shows client A at its 30th read does not affect client B, and B cannot redeem A's approval. | FR7.1, Q2, Q6 |

## Secrets

| ID | Requirement | Pass/fail | Source |
|----|-------------|-----------|--------|
| NFR2.1 | The code, fixtures, snapshots, and logs shall contain no real credentials; secrets (the HTTP tokens) are read from the environment only. The live GitHub reader is unauthenticated and uses no token. | The secret scan passes in the pre-commit hook and in GitHub Actions with no findings; no secret literal exists in the repository. | NFR2, DR |
| NFR2.2 | Audit records shall redact secret-like values (tokens, keys, passwords, authorization headers) in tool inputs before writing. | A call whose input holds a token-shaped value yields a record in which that value does not appear, and the record still parses. | FR6.3 |
| NFR2.3 | gitleaks shall run as a pre-commit hook and again in GitHub Actions; repository secret scanning with push protection stays enabled. | The workflow fails on a planted test pattern in a throwaway branch; the hook blocks a commit containing it. | Q10, TP |
| NFR2.4 | Operational log lines shall pass through the same redaction as audit records. | A test logs an event carrying a secret-like value and finds it redacted in the standard-error output. | Q4, FR6.3 |

## Supply chain

| ID | Requirement | Pass/fail | Source |
|----|-------------|-----------|--------|
| NFR7.1 | A lockfile (`package-lock.json`) shall be committed and installs in CI shall use the lockfile exactly (`npm ci`). | CI fails when the lockfile and manifest disagree. | NFR7, Q8 |
| NFR7.2 | GitHub Actions shall be pinned to full commit SHAs. | A check (or review of the workflow files) finds no mutable tag or branch reference. | NFR7, TP |
| NFR7.3 | The dependency set shall be small and each runtime dependency justified in `tech-stack-decisions.md`; dependency-review shall run on pull requests, and automatic dependency updates shall be enabled. | Every runtime dependency in the manifest appears in the justification table; dependency-review and the update bot are configured. | NFR7, TP |
| NFR7.4 | CodeQL code scanning shall run on pull requests and on the default branch. | The CodeQL workflow is present and passing. | TP |
| NFR7.5 | `SECURITY.md` shall be present and private vulnerability reporting enabled. | The file exists and the repository setting is on when the project is complete. | NFR7, TP |

## STRIDE summary (per trust boundary)

| Threat | Example | Mitigation (requirement) |
|--------|---------|--------------------------|
| Spoofing | Agent poses as a human approver, or a second HTTP client poses as the first | Separate human approval step, client-bound approvals, token per client (NFR1.3, NFR1.4, NFR1.8) |
| Tampering | Edit approved inputs after approval; alter audit lines | Input-digest binding; append-only audit file, existing lines never modified (NFR1.3; FR6.2) |
| Repudiation | Dispute whether a write was approved | One audit record per call with client, redacted inputs, outcome (FR6.1; NFR1.5) |
| Information disclosure | Secret in a log line or error | Redaction in audit and operational logs; generic client errors (NFR2.2, NFR2.4, NFR1.7) |
| Denial of service | Flood of calls, oversized input, token guessing | Per-client rate limits, input size limits, loopback-only listener, Host/Origin checks, failed-auth throttle (FR7.1, NFR1.1, NFR1.4, NFR1.16); audit growth under a flood is bounded by NFR1.18 |
| Elevation of privilege | Prompt-injection text in a CI log triggers a write | Outside text is data; every write needs separate approval (NFR1.2, NFR1.3) |

## Sources

- [Q5] approval 5 minutes; [Q6] client identity; [Q10] gitleaks; [Q4] logging format; [Q8] npm.
- [FR3.1], [FR3.4], [FR4.2]-[FR4.4], [FR5.2], [FR6.1]-[FR6.4], [FR7.1], [FR8.2]; [NFR1], [NFR2], [NFR7].
- Practices: [DR] never log secrets, treat outside text as untrusted; [TP] CodeQL, dependency updates, SECURITY.md, secret scanning.

## Assumptions & Open Questions

- [assumption] The approval digest covers the tool name, client identity, and the canonical JSON of the validated inputs; the exact approval hand-off mechanism (how a human approves outside the agent) is a design decision for NFR Design.
- [assumption] The numeric input limits in NFR1.1 (64 KiB body, 1024-character strings) are proposals, not user-confirmed; NFR Design may change the numbers but not the refuse-not-truncate rule.
- [assumption] The HTTP token map is supplied as environment configuration (name-to-token pairs); the exact variable format and a helper to generate tokens are NFR Design decisions within NFR1.4.
- [assumption] Trust assumption on the approval channel: in stdio mode the human approves through a channel the agent has no tool for (for example a separate terminal command or prompt on the user's side); in HTTP mode the approval route requires a separate human credential that is never issued to an agent client. NFR Design defines the mechanism; NFR1.3 tests the property.
- Accepted risk: another process running as the same operating-system user can read the audit file and the environment; the project does not defend against a compromised local user account.
