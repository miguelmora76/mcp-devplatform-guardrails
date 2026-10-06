# Performance Design

Scope: the whole server. Component IDs (LC-nn) are in `logical-components.md`. Source tags: `[NFRx.y]` = `../nfr-requirements/performance-requirements.md`. Targets: reads p95 <= 1 s and max <= 5 s on snapshot data; guardrail overhead p95 <= 50 ms.

## Latency budget for one read call

| Step | Budget (p95) | Design |
|------|--------------|--------|
| Transport and identity | 5 ms | In-memory token lookup; no I/O |
| Rate limit + validation | 5 ms | Map lookup; precompiled zod schema per tool |
| Handler (snapshot read + analysis) | 900 ms | Snapshot parsed once, cached; analysis is pure in-memory work |
| Audit append | 10 ms | One queued append, no fsync for reads |
| Result shaping and redaction | 10 ms | Single pass, output capped |

Guardrail overhead (everything except the handler) is budgeted at 30 ms against the 50 ms limit [NFR8.3]. For a write, the intent line adds one fsync; [assumption] it costs a few milliseconds on an SSD and fits the budget [NFR8.2]. The fsync runs inside the serial audit queue and so briefly delays other clients' appends; the benchmark measures this cost and the budget is revised if it does not hold.

## Techniques

- **Asynchronous I/O only** on the request path (no synchronous file calls after startup), so one slow call does not block others.
- **Snapshot cache** (LC-13): parsed snapshots held in a small least-recently-used cache (at most 8 documents, each at most 5 MiB), loaded on first use. Cold read is allowed to be the slowest and is still bounded by the 5 s maximum.
- **Precompiled validation**: zod schemas built once at startup.
- **Bounded output**: lists capped (at most 200 upgrades or log excerpts per result, excerpts at most 2 KiB each), so response size and time stay predictable.
- **No work for refused calls**: rate-limit and validation refusals return before any handler or file read.
- **Audit batching is not used**: each call writes its own line so a result is never returned before its record; the queue is serial but each append is a single small write.

## Measurement design [NFR8.1-NFR8.3]

- `npm run bench` runs in-process through the real wrapper using real timers, against bundled snapshots only: 100 calls per read tool, 100 for the write path with a pre-issued approval, 1000 through a no-op tool for overhead. It reports p50, p95, max, and fails locally when a target is missed. In GitHub Actions it runs as an informational job. It is separate from the unit suite so the unit suite keeps its injected clock.

## Live reading [NFR8.4]

- Not part of the targets. Bounded by the live reader's timeout, retry and deadline rules (`reliability-design.md`).

## Sources

- [NFR8.1]-[NFR8.4]; Q1 of the requirements stage; [NFR5.2] for the injected clock.

## Assumptions & Open Questions

- [assumption] The per-step budgets, cache size (8 documents) and output caps (200 items, 2 KiB excerpts) are design proposals; the benchmark confirms or revises them during Code Generation.
