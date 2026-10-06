# Performance Test Instructions

Scope: the NFR performance targets (`../nfr-requirements/performance-requirements.md`, `../nfr-design/performance-design.md`). Performance is checked by a benchmark script outside the deterministic unit suite, because it needs real timers while unit tests use an injected clock.

## Targets

| Target | Expected |
|--------|----------|
| NFR8.1 read tools on bundled snapshots | p95 <= 1 s and max <= 5 s |
| NFR8.2 write path (request, approval check, execute) | p95 <= 1 s and max <= 5 s, excluding human approval time |
| NFR8.3 guardrail overhead | p95 <= 50 ms per call |

Live GitHub reading is excluded (network-bound); it is bounded by the timeout, retry and deadline rules tested in `test/data/live-github.test.ts`.

## Run

```bash
npm run bench
```

Builds, then runs `dist/bin/bench.js` in process through the real wrapper and a real audit file, with real timers and no network: 100 calls per read tool, 100 write sequences (two calls each) with a pre-issued approval, 1000 calls through a no-op tool. Prints p50, p95 and max per case and exits 1 when a target is missed.

## Environment

- An ordinary developer laptop with an SSD, no other heavy load. The fsync on the write path's intent line is part of what is measured.
- In GitHub Actions the benchmark runs as an informational, non-blocking job: shared runners are too noisy to enforce the targets there. Enforcement is local.

## Regression handling

- A miss locally is a failure to investigate before merge. Do not loosen the targets in `src/bin/bench.ts` to make a run pass.

## Out of scope

- Load or soak testing: the server serves at most 5 clients with 30 reads and 3 writes a minute each, so there is no throughput target.
