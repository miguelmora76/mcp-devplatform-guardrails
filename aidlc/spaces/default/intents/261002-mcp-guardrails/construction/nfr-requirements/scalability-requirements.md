# Scalability Requirements

Scope: the whole server. This is a local tool, so scalability means correct behaviour for several simultaneous clients and bounded resource use, not growth to many users. Source tags: `[Qn]` = answer in `nfr-requirements-questions.md`; `[FRn.m]`/`[NFRn]` = requirements.md.

## Load model

| Dimension | Target | Source |
|-----------|--------|--------|
| Simultaneous clients | Up to 5, each with its own rate limit and audit identity | Q2 |
| Local process mode | One client per server process (the agent that started it); the 5-client target is exercised in HTTP mode | Q2, FR8 |
| Read calls | 30 per minute per client, so at most 150 per minute across 5 clients | FR7.1 |
| Write calls | 3 per minute per client, so at most 15 per minute across 5 clients | FR7.1 |
| Audit growth (within limits) | About 165 records per minute from allowed calls; at roughly 1 KB per record that is about 10 MB per hour | FR6.2 (estimate) |
| Audit growth (under a flood) | Refused, rate-limited and validation-failed calls also write one record each, so a flood is not bounded by the rate limits alone; bounded by NFR1.18 | FR6.1, FR7.2 |
| Growth over time | No growth plan: portfolio demonstration, no hosted service | TP |

## Requirements

| ID | Requirement | Pass/fail | Source |
|----|-------------|-----------|--------|
| (NFR1.8) | Per-client isolation is defined once, in `security-requirements.md` (NFR1.8). | See there. | Q2, FR7.1 |
| NFR1.9 | Per-client state (rate-limit counters, pending approvals) shall be bounded: counters are discarded once their window has passed, expired approvals are discarded, and at most 5 clients are served at once. A sixth simultaneous HTTP client shall be refused with a clear error and an operational-log line (NFR1.19). | A test connects 5 clients, then a sixth, and checks the sixth is refused and the state size does not grow after 1000 expired approvals and 1000 idle windows. | Q2, FR7 |
| NFR1.10 | With 5 clients calling in parallel, the audit file shall hold exactly one well-formed JSON line per call, with no interleaved or partial lines, and the rate limits shall be counted per client without cross-talk. | A concurrency test runs 5 simulated clients issuing mixed calls and checks the line count equals the call count and every line parses. | Q2, FR6.1 |
| NFR1.11 | No tool shall load an unbounded amount of data into memory: a snapshot or log document larger than 5 MiB is refused with a defined error (never truncated). | A test feeds a 5 MiB plus 1 byte document and gets the defined refusal, and a document of exactly 5 MiB is accepted. | NFR1.1, Q1 |
| NFR1.18 | The audit file shall have a size cap of 100 MiB. When the next record would exceed the cap, the file counts as not writable: writes are refused and reads continue with a reported audit failure (NFR1.5, NFR1.12). No record is dropped silently and the file is never truncated. Rotation is not part of the first version. | A test with a 1 KiB cap (configurable for tests) fills the file, then checks a write is refused, a read returns its result with an audit-failure indicator, and earlier lines are unchanged. | FR6.4, FR7.2 |
| NFR1.19 | Connection-level refusals (a sixth client, a failed token) are recorded in the operational log, not the audit log, because the audit log has one record per tool call (FR6.1). A refused sixth client or failed login is not a tool call. | A test refuses a sixth client and a bad token and finds one operational log line each and no audit line. | FR6.1, NFR1.9, NFR1.16 |
| NFR1.20 | Several server processes started in local mode shall not share one audit file by default: the audit file path includes the session ID, or a second process finding the file locked refuses to start. | A test starts two server instances on the same configured path and checks the second refuses or uses a distinct file. | FR6.2, Q6 |

## Scaling approach

- Vertical only: one Node.js process; no horizontal scaling, no sharding, no queues.
- Audit log rotation is not required in the first version; see the open question below.

## Sources

- [Q2] up to 5 clients; [FR6.1], [FR6.2], [FR7.1], [FR8]; [TP] local deployment, no hosted service.

## Assumptions & Open Questions

- [assumption] Refusing a sixth simultaneous client (NFR1.9) is the chosen behaviour at the limit; Q2 said "up to 5" without saying what happens beyond that. Confirm at the gate.
- [assumption] The 1 KB average audit record size is an estimate, not a measurement.
- [assumption] The 100 MiB cap (NFR1.18) is a proposal, not user-confirmed.
- Open: whether the audit file rotates and where it lives (requirements.md open question) was not asked here; at about 10 MB per hour of maximum sustained load the file stays small for a demo. NFR Design proposes a default path and "no rotation in v1"; confirm then.
