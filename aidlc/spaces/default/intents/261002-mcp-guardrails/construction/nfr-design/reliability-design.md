# Reliability Design

Scope: the whole server. Component IDs (LC-nn) are in `logical-components.md`. Source tags: `[Qn]` = `nfr-design-questions.md`; `[NFRx.y]` = `../nfr-requirements/`. No availability SLO: a local process has nothing to keep up (NFR Requirements).

## Audit ordering and counting (LC-04, LC-09) [NFR1.5, NFR1.12-1.14, NFR4.2] [Q2, Q3]

Audit line shape: `{ts, callId, phase, tool, client, inputs(redacted), outcome}` where `phase` is `complete` (one line for reads and every refusal) or `intent` then `outcome` (a write that passed all checks). "One record per call" means one `callId`.

```text
write:  checks pass -> append INTENT line (outcome "pending") + fsync   [fail => refuse, no change]
        -> execute -> append OUTCOME line                               [fail => tell client, log error]
read:   execute -> append COMPLETE line                                 [fail => return result + audit-failure flag]
refuse: append COMPLETE line (outcome refused/rate-limited/invalid/error)
```

- The record is awaited before the result is returned, so a returned result always has its line (or an audit-failure flag).
- If the outcome line fails after a change, the intent line already on file shows the write was attempted; the client gets an audit-failure indicator and one error line goes to standard error.
- Tests count distinct call IDs per call (one ID, one or two lines) and check line shape.
- Decision (ADR): intent-then-outcome for writes. Alternatives rejected: single line after the change (a write could happen unaudited); audit check up front only (still allows an unaudited write if the file fails in between). Consequence: two lines per write, handled by the call ID.

## Audit file safety (LC-09) [NFR1.13, NFR1.18, NFR1.20] [Q3]

- Path: `./audit/audit.jsonl`, overridable by `GUARDRAILS_AUDIT_PATH`; directory created on start. No rotation.
- A single in-process queue serialises appends; each record is one `write` of one complete line to a file opened with append mode, so lines never interleave (also under 5 clients). The queue catches each append's failure and reports it to that call only, then continues: one rejected append never blocks or poisons later ones. Existing bytes are never modified; a torn final line from a crash does not affect earlier lines.
- Lock: a lock file `<path>.lock` created with an exclusive create (fails if present) and containing the process ID. A second process finding a lock whose process is alive refuses to start. A lock whose process no longer exists is replaced by writing a new lock to a temporary name and renaming it into place only after re-reading that the old content is unchanged; two processes starting at once cannot both win. [assumption] A reused process ID could make a stale lock look alive, in which case startup refuses and the operator removes the lock; accepted. Removed on clean shutdown.
- Cap: file size is tracked from `stat` at start and updated per append. When the next line would pass 100 MiB, the file counts as not writable (writes refused; reads return their result plus an audit-failure flag). Nothing is dropped silently or truncated.
- Durability: fsync after every intent line; outcome and read lines rely on the operating system (a power failure can lose the last few of those). [assumption] The intent line is durable after a crash of the process; after a power loss it is as durable as the platform's `fsync`, which on macOS does not force the drive's own cache (no full-flush call is available from Node). This is accepted for a local demonstration tool.

## Failure handling table [NFR1.12, NFR1.14]

| Failure | Behaviour |
|---------|-----------|
| Handler throws | Error boundary: one record (outcome `error`), defined error to client, server continues |
| Audit unwritable / full / locked | Writes refused; reads return result + audit-failure flag + error log line |
| Refusal (rate-limited, invalid, unapproved) while audit is unwritable or at the cap | The refusal is still returned (it changes nothing); the missing record is reported with the audit-failure flag and one error log line. Recovery for a full file: stop the server, move or archive the audit file, restart; the README documents this |
| Audit intent line fails for an approved write | Write refused, the approval is released (back to APPROVED) so it is not burned |
| Snapshot missing or malformed | Defined error naming the snapshot, one record |
| Live read fails | Timeout, bounded retries, defined error (below); snapshot mode unaffected |
| Admin socket unavailable | Writes cannot be approved, so they stay refused; reads unaffected; startup refuses if the socket directory is unsafe (not 0700, wrong owner, or a symlink) |

## Live reader resilience (LC-14) [NFR4.5, NFR4.6] [Q3 of requirements]

- Off by default; with it off, the `Net` port is a stub that throws, so no network call can happen (NFR4.6).
- Each request: 10 s timeout via an abort signal driven by the injected `Scheduler`. Up to 3 retries after the first attempt, waits 1 s, 2 s, 4 s plus jitter from the injected `Rng`. Only transient failures are retried: timeouts, connection errors, HTTP 429, and 5xx. Other 4xx and any 3xx fail at once.
- A `Retry-After` of at most 30 s is waited out; a longer one ends the call immediately with a clear error. An overall deadline of 120 s per call ends any run of waits.
- No circuit breaker or bulkhead: there is a single optional dependency and a caller that makes at most 30 calls a minute, so a breaker adds state without protecting anything. Recorded as a deliberate omission.

## Shutdown and health (LC-18) [NFR1.15]

- On SIGINT or SIGTERM: stop accepting new calls and connections, let in-flight calls finish (up to 5 s), flush the audit queue, close the socket, delete the lock and its own `<pid>.sock` file, exit. At startup it also checks the socket directory (owner, mode 0700, not a symlink) and removes stale sockets of dead processes. A second signal exits at once.
- No health endpoint: liveness is the client's open connection; there is no load balancer or orchestrator.

## Recovery

- Restart the process. Pending approvals and rate-limit counters are in memory and are lost by design. The audit file is the only durable state; the simulated CI system is rebuilt from its bundled starting state.

## Sources

- [Q2] A, [Q3] A; [NFR1.5], [NFR1.12]-[NFR1.15], [NFR1.18], [NFR1.20], [NFR4.5], [NFR4.6].

## Assumptions & Open Questions

- [assumption] The 5 s drain time and "fsync only intent lines" are design proposals.
- [assumption] The simulated CI system starts from a bundled initial state each run (it has no persistence); its design belongs to Functional Design / Code Generation.
