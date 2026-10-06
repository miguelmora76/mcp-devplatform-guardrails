# Observability Design

Scope: the whole server. Component IDs (LC-nn) are in `logical-components.md`. Source tags: `[NFRx.y]` = `../nfr-requirements/observability-requirements.md`. Two records exist: the audit log (what tools were called; `reliability-design.md`) and the operational log (the server's diagnostics). No metrics, tracing, dashboards or alerts: a local tool has no operations team [Q4 of the requirements stage].

## Operational log (LC-11) [NFR8.5, NFR8.6, NFR2.4]

- A `Logger` writes one JSON object per line to standard error through an injected sink. Fields: `ts`, `level` (`error|warn|info|debug`), `component` (LC name), `msg`; plus `callId`, `client`, `tool` when a call is involved, and `err` (redacted internal detail) for errors.
- Level filter from `GUARDRAILS_LOG_LEVEL`, default `info`; `debug` only on request.
- Every line goes through the Redactor (LC-10) before writing; tokens, keys and secret-shaped values never appear.
- In stdio mode standard output is reserved for protocol messages. The logger has no code path to standard output, and a test checks that no log line reaches it.

## Event catalogue

| Event | Level | Component |
|-------|-------|-----------|
| `server.start` / `server.stop` (mode, address in HTTP mode, never tokens) | info | Lifecycle |
| `http.refused` (reason: token, host, origin, queue full; remote address only) | warn | HttpListener |
| `http.conn_limit` (connection beyond the 50-connection bound closed at accept) | warn | HttpListener |
| `config.invalid` (for example more than 5 tokens, duplicate names) | error | Config |
| `audit.write_failed` (reason: unwritable, full, locked) | error | AuditWriter |
| `approval.requested` / `approval.granted` / `approval.consumed` / `approval.expired` (IDs, not codes) | info | ApprovalService |
| `approve.refused` (no terminal, unknown or expired reference) | warn | AdminChannel |
| `live.retry` / `live.failed` (host, attempt, reason) | warn / error | LiveGitHubReader |
| `tool.error` (internal detail) | error | GuardrailWrapper |
| `call.start` / `call.end` (duration, outcome) | debug | GuardrailWrapper |

Standard error carries no secret in any mode, because the agent host may capture it. A pending approval appears there only as a one-line notice (tool, client, request reference); the human sees the full request, with escaped inputs and digest, by running the `approve` command, which reads it over the admin socket.

## Correlation

- Every call gets a random `callId` of the form `call_` plus 26 base32 characters (injected `IdSource`); the redactor leaves these shapes alone (`security-design.md`). The same ID is on the audit line(s), on log lines for that call, and in the response metadata, so a human can follow one call across both records. Connection-level events (refusals, throttles) have no call ID and go to the operational log only [NFR1.19].

## Audit log observability [NFR4.2, NFR2.2]

- Audit lines are the durable account of tool use; they are redacted with the same Redactor. Tests assert one call ID per call, the five required fields, and absence of planted secrets.

## Explicitly not designed

- No metrics endpoint, no OpenTelemetry, no dashboards, no alert rules, no SLI/SLO tracking, no log shipping.

## Sources

- [NFR8.5], [NFR8.6], [NFR2.2], [NFR2.4], [NFR1.19], [NFR4.2].

## Assumptions & Open Questions

- [assumption] Field names (`ts`, `level`, `component`, `msg`, `callId`) are design proposals.
