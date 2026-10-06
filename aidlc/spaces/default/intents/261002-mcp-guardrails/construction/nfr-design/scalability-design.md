# Scalability Design

Scope: the whole server. Component IDs (LC-nn) are in `logical-components.md`. Source tags: `[Qn]` = `nfr-design-questions.md`; `[NFRx.y]` = `../nfr-requirements/scalability-requirements.md`. This is a local tool: "scaling" means correct behaviour for up to 5 clients and bounded resource use.

## Architecture

- One Node.js process, one event loop, no workers, no queue, no partitioning. Vertical only; nothing to load balance. All shared state is process-local and bounded.
- Up to 5 clients, where a client is a token [Q5]. Local process mode serves one client (the session). More simultaneous clients exist only in HTTP mode.

## Per-client isolation [NFR1.8, NFR1.17]

- `RateLimiter` (LC-06) keeps a map `client -> {windowStart, reads, writes}`. Fixed 60 s window per client starting at its first call in that window; the 31st read or 4th write in a window is rejected; the counters reset when the window ends. Reads and writes are counted separately.
- Approvals (LC-07) are stored under the owning client and verified against it; one client cannot redeem another's.
- Audit lines carry the client name; the audit queue is shared but writes are serialised (below).

## Bounded state [NFR1.9]

| State | Bound | Clean-up |
|-------|-------|----------|
| Rate-limit entries | 5 clients (HTTP) or 1 (stdio) | Window reset on next call; idle entries dropped when their window has passed (swept every 60 s by the injected scheduler) |
| Approval records | At most 20 per client (pending, approved, consumed) | Expired (5 min) and consumed records discarded on sweep and on each access; a 21st pending request is refused with a defined error |
| HTTP connections | At most 50 open | Further connections closed at accept |
| Tokens | At most 5 configured | Startup refuses a sixth pair [Q5] |
| Snapshot cache | 8 documents | Least recently used evicted |
| Failed-login queue | At most 20 waiting failures, served one per 200 ms | Overflow connections closed at once; no per-source table |

The requirement's "sixth simultaneous client" is realised as a configuration limit: a sixth token cannot be configured, and an unknown token is an ordinary failed login (see `logical-components.md`, clarifications).

## Concurrency [NFR1.10]

- AuditWriter (LC-09) uses one promise-chain queue; each call awaits its append in call order, so 5 clients produce complete, non-interleaved lines and the count of call IDs equals the count of calls. A concurrency test drives 5 simulated clients through the real wrapper with the fake clock.
- No tool holds a lock across an `await` on the network; the live reader's retries use timers, not blocking waits.

## Data size limits [NFR1.11]

- A snapshot or log document larger than 5 MiB is refused with a defined error before it is read (size taken from `stat`); exactly 5 MiB is accepted. Never truncated.

## Audit growth [NFR1.18]

- Within limits, at most 180 lines a minute across 5 clients: 150 reads at one line each, plus 15 write-tool calls at up to two lines each (about 11 MB an hour at 1 KB a line). Every write-tool call counts against the 3-per-minute write limit, including the first call that only returns `approval_required`, so a client can complete at most one approve-and-execute pair plus one more request per minute; that follows from the 3-writes-per-minute requirement (FR7.1). Under a flood, refused calls also write one line each, so growth is bounded by the 100 MiB cap rather than by the rate limits: at the cap, writes are refused and reads return a reported audit failure (see `reliability-design.md`). Rotation is out of scope for the first version [Q3].

## Sources

- [Q3] A, [Q5] A; [NFR1.8]-[NFR1.11], [NFR1.17], [NFR1.18].

## Assumptions & Open Questions

- [assumption] The 20-approvals-per-client and 50-connection bounds and the 60 s sweep are design proposals, not user-confirmed.
