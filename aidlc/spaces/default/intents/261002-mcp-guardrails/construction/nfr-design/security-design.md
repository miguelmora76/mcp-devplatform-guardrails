# Security Design

Scope: the whole server. Component IDs (LC-nn) are defined in `logical-components.md`. Source tags: `[Qn]` = `nfr-design-questions.md`; `[NFRx.y]` = `../nfr-requirements/`. Short code snippets are illustrative pseudocode only.

## Per-call pipeline (LC-04), in fixed order

1. **Identify** the client (LC-03): session ID in stdio mode, token name in HTTP mode. A call without an identity is refused at the transport.
2. **Rate limit** (LC-06) before validation, so a flood of malformed calls is also limited.
3. **Validate** (LC-05): strict schema, size and format rules.
4. **Authorize**: reads proceed; a write needs a valid approval (LC-07).
5. **Audit intent** (writes only) and wait until it is on disk.
6. **Execute** the handler inside an error boundary.
7. **Audit outcome** (or the single record for non-writes), then return the result.

Every refusal at steps 1-4 writes exactly one record with its outcome (`refused`, `rate-limited`, `invalid`) and calls no handler [NFR4.2, NFR1.14].

## Input validation (LC-05) [NFR1.1, NFR1.6]

- One zod schema per tool, `.strict()` (unknown fields rejected). Strings at most 1024 characters; request body at most 64 KiB, enforced while reading the body (HTTP) and on the message size (stdio). Oversize input is refused, never truncated.
- Repository reference: either a bundled snapshot name or `owner/name` matching `^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$`. URLs, credentials in the text, `..`, absolute paths, and anything else are refused. Snapshot names are looked up in a fixed list, never joined to a path from input.
- Validation errors return a defined code and message listing field names only, never echoing the offending value.

## Untrusted outside text [NFR1.2]

- CI log lines, changelogs and advisory text are only ever placed into result fields (for example `excerpt`) as quoted data, with control characters and ANSI sequences stripped and length capped. No code path parses such text into a tool name, an approval, or tool arguments.
- Classification of failures uses fixed rules over the text (pattern tables in code). The rules read the text; nothing in the text can select a rule, call a tool, or reach the approval service.
- The write tool accepts only explicit typed arguments from the caller and a verified approval. A prompt-injection line inside a log can therefore at most appear in a report; it cannot cause a write. A test with instruction-like snapshot text proves this.

## Approval design (LC-07, LC-08) [NFR1.3, NFR1.8] [Q1]

Flow:

```text
agent  -> rerun_ci_job(args)            -> server: no approval -> store PENDING request,
                                           return {status:"approval_required", requestId}
server -> logs (stderr) only: "approval pending: <tool> from <client>, ref <requestId>"  (no secret)
human  -> runs `approve` in a terminal: lists pending requests over the admin socket,
          shows the exact action (escaped inputs + digest), human picks one and types `yes`
         -> server marks request APPROVED at time T
agent  -> rerun_ci_job(args, requestId) -> server verifies, claims, audits intent, CONSUMES -> executes
```

Rules:
- There is no approval code. The `requestId` is a non-secret reference the agent already holds; what makes an approval real is the human's separate action, not a secret. Standard error therefore carries no secret in any mode, even when the host captures it. The `approve` command lists pending requests itself, so the human sees them without reading the server's logs [Q1 A, refined: `approve` with no argument lists; `approve <ref>` goes straight to one request].
- The approval record binds `tool`, `client`, and `sha256(canonical JSON of validated inputs)`. Presenting it with different inputs, another tool, or from another client is refused.
- Valid for 5 minutes counted from T, inclusive (accepted at exactly T+5:00, refused after). A pending request that nobody approves expires 5 minutes after it was created. Expired records are discarded. [assumption: counting from T, and the separate pending expiry, are design refinements not covered by a Q&A item.]
- Single use, with a claim step: verify-and-claim is one synchronous step with no `await` in it (state APPROVED to EXECUTING), so two concurrent presentations of one request cannot both pass. The audit intent line is then written. If the intent write fails, the claim is released (EXECUTING back to APPROVED) and the write is refused, so the human's approval is not burned by an audit failure. After a successful intent line the record becomes CONSUMED before the handler runs; a failed execution does not refund it.
- The approval display escapes agent-supplied text: control characters are rendered as `\xNN`, inputs are shown as JSON-escaped strings, and the input digest (first 12 hex characters) is shown beside them so what the human sees is what the digest covers. The input validator also rejects control characters in every string argument (this extends NFR1.1).
- The `approve` command and the admin socket are not MCP tools and not HTTP routes. The registry test enumerates tools and HTTP paths and fails if any can issue an approval. The `approve` command reads the human's `yes` from the controlling terminal (`/dev/tty`) and refuses to run without one.
- Admin socket (LC-08): lives in a per-user directory `~/.mcp-guardrails/run/` created with mode 0700; at start the server verifies the directory is owned by the current user, has no group or world access, and is not a symlink, else it refuses to start. The socket is named `<pid>.sock` (one per server process), created with mode 0600. `approve` scans the directory, tests each socket with a connection, deletes sockets whose connection is refused (stale after a crash; the server also removes any stale socket of a dead process at start), and when more than one live server answers lists them (mode, start time, audit path) and asks which to use. On macOS the 0700 directory is the effective control, because socket-file modes are not reliably honoured there.
- Trust model (stated plainly): NFR1.3(a) is met against everything the agent can reach through the protocol: MCP tools, the stdio stream, and every HTTP route. A malicious agent that also has a shell running as the same operating-system user is out of scope: it could connect to the socket directly (the terminal check lives in the `approve` client) or edit the environment. The design reduces this exposure with no secret on stderr, the 0700 directory, and the terminal confirmation, but does not claim to stop it. This is the accepted risk in the table below.
- Decision (ADR): approval path. Chosen: separate local command over a user-only socket [Q1 A]. Alternatives rejected: HTTP-only approval route (leaves local mode with no writes; needs a second credential scheme); hand-edited approvals file (no display of the exact action, easy to approve the wrong thing); a printed approval code (the code would travel through stderr, which an agent host may capture and expose, and a global wrong-code limit lets an agent block the human). Consequences: macOS/Linux only; same-user shell access is out of scope.

## HTTP mode (LC-02) [NFR1.4, NFR1.16] [Q4, Q5]

- Binds `127.0.0.1` only. Rejects any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`, and any request carrying an `Origin` that is not a loopback origin (DNS-rebinding and browser defence), before looking at the token.
- Tokens come from one environment variable as comma-separated `name=token` pairs; a helper command generates 32 random bytes (256 bits, base64url), prints it once, and stores nothing. Startup refuses more than 5 pairs, duplicate names or tokens, or tokens shorter than 128 bits.
- Authentication: bearer token. The presented token is hashed with SHA-256 and compared with each configured token's hash using constant-time comparison, always over all entries, so neither length nor position leaks. The same refusal is returned for missing and wrong tokens.
- Failed-login throttle [Q5 A: never locks out legitimate clients]: a valid token is answered immediately and never waits. Failed attempts enter a single serialised queue where each failure costs a fixed 200 ms before the refusal is sent (so at most about 5 failed attempts a second are processed, however many connections an attacker opens), and the queue holds at most 20 waiting failures; beyond that the connection is closed at once. No per-source table exists, so there is nothing to grow. Tokens are at least 128 bits, so guessing is infeasible; this bounds the cost of an attack and the work it can force. Each closed or refused attempt is a `http.refused` log line; a connection beyond the 50-connection bound is closed at accept with an `http.conn_limit` warning. This replaces the requirement's wording "after 5 failed attempts ... refused for 1 minute" (NFR1.16) with a rate-bounded design; see the clarifications in `logical-components.md`.
- The client identity is the token's name; several connections on one token share its limits and approvals.

## Secrets and redaction (LC-10, LC-17) [NFR2.1-NFR2.4]

- Secrets exist only as environment variables read once at startup; they are never logged, audited, or placed in error messages.
- Redactor: (a) keys matching `token|secret|password|authorization|api[-_]?key|credential` have their values replaced by `[REDACTED]`; (b) values matching known shapes are replaced (`gh[pousr]_` tokens, `Bearer` values, `AKIA` keys, private-key blocks, and base64url or hex runs of 40+ characters); (c) the redactor is built at startup with the exact configured token values and replaces any occurrence of them. Applied to audit inputs and to every log line. A test plants each shape and checks it is absent.
- Identifiers the design needs are never redacted by rule (b): call IDs and request IDs have the fixed shapes `call_` or `req_` followed by 26 base32 characters (130 bits) and the input digest is written as `sha256:` followed by 12 hex characters; the run rule skips text carrying those prefixes. Generated HTTP tokens start with `mgt_` so they match a named pattern. A test asserts that call IDs, request IDs and digests survive redaction while planted tokens, and the configured tokens, do not.
- Repository controls (design of NFR2.3, NFR7.x): gitleaks pre-commit hook and CI job; GitHub secret scanning with push protection; committed `package-lock.json` with `npm ci`; all Actions pinned to full commit SHAs; dependency-review on pull requests; automatic dependency updates; CodeQL on pull requests and `main`; `SECURITY.md` with private vulnerability reporting. Runtime dependencies: the MCP SDK and zod only [Q7].

## Live reader security (LC-14) [NFR1.6] [Q6]

- Unauthenticated: no `Authorization` header is ever added. Requests go only to `api.github.com` and `github.com` over HTTPS; redirects are never followed (`redirect: "manual"` and any 3xx is an error). Raw CI log downloads are therefore unavailable live; logs come from snapshots.

## Error handling [NFR1.7]

- A single mapper turns every failure into `{code, message}` with a fixed message per code. Stack traces, paths and causes go to the operational log only (redacted).

## Threats and residual risks

| Threat | Control |
|--------|---------|
| Agent self-approval (through the protocol) | Approval via user-only socket and terminal confirmation; no tool or route issues approvals; no secret on stderr |
| Prompt injection via logs | Outside text is data only; writes need separate approval |
| Approval replay / swap | Single use, bound to tool, client, input digest; 5-minute validity |
| DNS rebinding / browser requests | Loopback bind, Host and Origin checks, bearer token |
| Token guessing | 128-bit or longer tokens, constant-time compare, serialised 200 ms failure cost with a 20-entry queue |
| Audit tampering | Append-only writer; lines never rewritten; lock file prevents a second writer |
| Secret leakage | Env-only secrets, redaction, generic client errors, scanners |
| Accepted risk | A malicious agent that has a shell as the same OS user could talk to the admin socket directly, read the environment and the audit file; out of scope and not defended (see Trust model) |

## Sources

- [Q1] A, [Q4] A, [Q5] A, [Q6] A, [Q7] A; [NFR1.1]-[NFR1.8], [NFR1.16], [NFR2.1]-[NFR2.4], [NFR7.1]-[NFR7.5].

## Assumptions & Open Questions

- [assumption] The 200 ms failure cost, the 20-entry failure queue, the control-character rejection, the `~/.mcp-guardrails/run/` location and the ID shapes are design proposals, not user-confirmed.
- Open: exact terminal wording of the approval prompt is a Code Generation detail.
