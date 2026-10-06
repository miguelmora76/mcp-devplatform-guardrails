# Reliability Requirements

Scope: the whole server. Reliability here means the guardrails behave correctly and fail safe, not uptime. Source tags: `[Qn]` = answer in `nfr-requirements-questions.md`; `[FRn.m]`/`[NFRn]` = requirements.md.

## Availability, recovery, and durability

- Availability: no SLA or SLO. The server is a local process started on demand by the agent, with no hosted service [TP]; there is nothing to keep up, and "downtime" has no business meaning.
- Recovery: restart the process. No state other than the audit file and the simulated CI system must survive a restart; pending approvals are in memory and are lost on restart by design (the agent asks again).
- Durability: the audit file is the only durable record. A record is written before the call's result is returned, so a crash cannot leave a returned result without a record [FR6.1].
- Backup: none. The audit file is a user-owned local file.

## Requirements

| ID | Requirement | Pass/fail | Source |
|----|-------------|-----------|--------|
| (NFR1.5) | Write fail-closed and audit ordering are defined once, in `security-requirements.md` (NFR1.5). | See there. | FR6.4 |
| NFR1.17 | Time-based guardrail rules shall use a fixed window per client for rate limits (the 31st read in the same 60-second window is rejected; the counter resets when the window ends) and an inclusive approval expiry (valid up to and including 5 minutes). | Injected-clock tests check the 30th and 31st read, the window reset at 60 s, and the 5:00 and 5:00.001 approval boundaries. | FR7.1, FR4.4, Q5 |
| NFR1.12 | A read shall still return its result when its audit record cannot be written, together with a reported audit failure, and the failure shall also be written to the operational log. | With the audit file unwritable, a read returns its result plus an audit-failure indicator, and standard error holds one error line. | FR6.4 |
| NFR1.13 | The audit file shall be append-only: each record is one complete line written with a single append; existing lines are never modified or truncated; a partial write at the end of the file shall not corrupt earlier lines. | A test appends 1000 records, checks earlier bytes are unchanged, and simulates a truncated last line to show earlier lines still parse. | FR6.2 |
| NFR1.14 | When the tool handler itself fails, the call shall still produce exactly one audit record (outcome: error) and return a defined error to the client without crashing the server. | A test makes a handler throw and checks one record, a defined error, and that a following call still works. | FR6.1 |
| NFR1.15 | On SIGINT or SIGTERM the server shall finish writing the audit record of any call in progress, then exit; it shall not start new calls. | A test sends the signal during a call and checks the record exists and the process exits. | FR6.1 |
| NFR4.5 | Live public-GitHub reading (optional, off by default) shall time out each request after 10 seconds, retry up to 3 times with growing waits (jittered exponential backoff), then return a clear error without crashing. Only transient failures are retried (timeouts, connection errors, HTTP 429 and 5xx); a rate-limit response from GitHub with a Retry-After of at most 30 seconds is honoured, and a longer one ends the call at once with a clear error. Failures never alter the audit guarantees and never trigger a write. | Tests with a fake transport and the injected clock check: the 10 s timeout, exactly 3 retries and the waits growing, no retry on a 4xx other than 429, a clear error after the last retry, and the server still serving later calls. | Q3, FR3.3 |
| NFR4.6 | With live reading disabled (the default), no network call shall be made by any tool. | A test replaces the network layer with one that fails on use and runs every tool in default mode. | FR3.3, NFR5 |

## Graceful degradation

| Dependency | If it fails | Behaviour |
|------------|-------------|-----------|
| Audit file | Unwritable | Writes refused; reads continue with a reported failure (NFR1.5, NFR1.12) |
| Live GitHub | Slow or down | Timeout, bounded retries, clear error (NFR4.6 and NFR4.5); snapshot mode unaffected |
| Simulated CI system | Internal error | Defined error, one audit record, no partial state change reported as success |
| Snapshot file | Missing or malformed | Defined error naming the snapshot (not the full path), one audit record |

## Failure-mode checklist

- Component unavailable: handled per the table above.
- Response time doubles: no effect on correctness; timeouts still apply to live reads.
- Throughput exceeds capacity: per-client rate limits reject calls with a defined error and an audit record (FR7).
- Corrupted dependency data: input from snapshots and live reads is validated before use (NFR1.1).
- Blast radius: one local process; the only state change possible is inside the simulated CI system.

## Sources

- [Q3] A: 10 s timeout, 3 retries; [FR3.3], [FR6.1], [FR6.2], [FR6.4], [FR7]; [TP] local deployment; [NFR1], [NFR4], [NFR5].

## Assumptions & Open Questions

- [assumption] Backoff waits of about 1 s, 2 s, 4 s with jitter; Q3 said "growing waits" without numbers. With these values a failing live call is bounded at about 47 seconds (4 attempts x 10 s plus 7 s of waits); honoured Retry-After waits are counted inside an overall deadline of 120 seconds per live call, after which the call fails with a clear error. The 30 s and 120 s limits are proposals.
- [assumption] Pending approvals are held in memory only and lost on restart.
