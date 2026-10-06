# Performance Requirements

Scope: the whole server. The inception requirements have no stand-alone performance NFR, so these targets are anchored to NFR8 (reproducible walkthrough: the documented steps must feel instant and never hang). Source tags: `[Qn]` = answer in `nfr-requirements-questions.md`; `[FRn.m]`/`[NFRn]` = requirements.md.

## Targets

ID note: inception has no performance or logging NFR, so NFR8.1-NFR8.6 are anchored to NFR8 (reproducible, diagnosable walkthrough); the mapping is deliberate.

| ID | Requirement | Pass/fail | Source |
|----|-------------|-----------|--------|
| NFR8.1 | Read tools on bundled snapshot data shall return within 1 second for 95% of calls (p95 <= 1 s) and within 5 seconds for every call (max <= 5 s), on an ordinary developer laptop, with one client and no concurrent load. | A benchmark script calls each read tool 100 times against the bundled snapshots and fails when p95 exceeds 1 s or any call exceeds 5 s. | Q1, FR1, FR2 |
| NFR8.2 | The write path (approval request, approval check, simulated re-run) shall meet the same p95 and max targets as NFR8.1, excluding the time a human takes to approve. | The same benchmark covers the request, approval-check, and execute calls with a pre-issued approval. | Q1, FR4 |
| NFR8.3 | Guardrail overhead (validation, approval check, rate-limit check, audit write) shall add no more than 50 ms at p95 to any tool call. | The benchmark runs a no-op tool through the wrapper 1000 times and fails when p95 exceeds 50 ms. | Q1, FR5.2 |
| NFR8.4 | Live public-GitHub reading is excluded from NFR8.1-NFR8.3 because it depends on the network; it is bounded instead by the timeout and retry rules in `reliability-requirements.md` (NFR4.5). | Covered by NFR4.5 tests. | Q1, Q3, FR3.3 |

Measurement method: the benchmark is a separate script (`npm run bench`), not part of the deterministic unit suite, because it needs a real timer while the unit suite uses an injected clock (NFR5.2). It runs locally on demand, where the targets are enforced, and in GitHub Actions as an informational job only (shared runners are too noisy to enforce a 1 s target); it never replaces the unit suite and never touches the network.

## Resource constraints

- The server holds no large in-memory data sets: snapshots are read on demand and each is small (public repository metadata and CI logs).
- Memory used by rate-limit and approval state shall stay bounded (see `scalability-requirements.md`, NFR1.9).

## Anti-requirements (explicitly not promised)

- No throughput target, no latency target for live GitHub reads, and no timing target on a cold first start.
- No performance claim on hardware weaker than an ordinary developer laptop.

## Sources

- [Q1] A: 95% within 1 s, none over 5 s; [Q3] live-read bounds; [FR1], [FR2], [FR3.3], [FR4], [FR5.2]; [NFR8]; [NFR5] for the injected clock.

## Assumptions & Open Questions

- [assumption] The 50 ms guardrail-overhead budget (NFR8.3) is proposed here, not given by the user; it keeps the wrapper from dominating the 1 s target and can be revised at the gate.
- [assumption] "Ordinary developer laptop" means a recent consumer machine with an SSD; the benchmark records the machine description in its output.
