# Observability Requirements

Scope: the whole server. Two separate records exist: the audit log (what tools were called, a guardrail feature defined by FR6) and the operational log (the server's own diagnostics). There are no metrics, traces, dashboards, or alerts: the server is a local tool with no hosted operation. Source tags: `[Qn]` = answer in `nfr-requirements-questions.md`; `[FRn.m]`/`[NFRn]` = requirements.md.

## Audit log (defined by the functional requirements)

| ID | Requirement | Pass/fail | Source |
|----|-------------|-----------|--------|
| NFR4.2 | Automated tests shall verify that exactly one audit record is written per tool call for each outcome (allowed, refused, rate-limited, error), including the read case where the audit write fails (reported per NFR1.12, with no second record), and that each record contains timestamp, tool name, calling client, redacted inputs, and outcome. | One passing test per outcome checks the count of new lines is 1 and the five fields are present; the test fails if a second record or none is written. | NFR4, FR6.1, FR6.2 |
| NFR2.2 | Audit inputs are redacted (defined in `security-requirements.md`). | See NFR2.2 there. | FR6.3 |

## Operational log

| ID | Requirement | Pass/fail | Source |
|----|-------------|-----------|--------|
| NFR8.5 | The server shall write structured JSON log lines (one object per line) to standard error with the levels error, warn, info, and debug. Each line has at least: timestamp, level, component, and message; client identity and tool name are added where a call is involved. The default level is info; an environment variable raises it to debug. | A test captures standard error and checks each line parses as JSON with the required fields, and that debug lines appear only when enabled. | Q4, NFR8 |
| NFR8.6 | The operational log shall record: server start and stop (mode, listening address in HTTP mode, never the token), denied connections and refused tokens, audit write failures, live-read retries and final failures, and unexpected errors with their internal detail. | Tests trigger each event and find a log line for it. | Q4, FR8.2, FR6.4 |
| NFR2.4 | Operational log lines pass through the same secret redaction as the audit log (defined in `security-requirements.md`). | See NFR2.4 there. | Q4 |

Standard output is reserved for the stdio protocol stream in local process mode; nothing but protocol messages may be written to it. A test checks that no log line reaches standard output.

## Not required

- No metrics, no distributed tracing, no dashboards, no alert thresholds, and no SLI/SLO definitions: a local demonstration server has no operations team or hosted service [Q4, TP]. There is nothing to page.
- No log shipping or retention policy beyond the user's own terminal and the audit file.

## Sources

- [Q4] A: structured JSON to standard error with levels, no metrics or tracing; [FR6.1]-[FR6.4], [FR8.2]; [NFR4], [NFR8], [NFR2].

## Assumptions & Open Questions

- [assumption] The required log-line field names (`ts`, `level`, `component`, `msg`) are decided at design time; this stage requires only the content.
- [assumption] Standard output is reserved for the protocol in local mode; this follows from the stdio connection (FR8.1) and is stated so the logging design does not break it.
