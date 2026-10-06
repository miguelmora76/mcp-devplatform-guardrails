# Code Summary

The server was built in one pass (no Unit split) following the approved plan, in three phases by the developer: Steps 1-6 (setup, test runner, walking skeleton), Steps 7-13 (redaction and logging, audit writer, rate limiter, approval service, admin channel and `approve`, complete wrapper and registry, simulated CI), and Steps 14-20 (upgrade planning, triage, HTTP mode, live reader, shutdown, CI and security files, benchmark, walkthrough, README). All 21 plan steps were ticked, and a repair pass (Steps 22-28, loop-back 1 from Build and Test) followed. Nothing was committed, branched or pushed.

## Files created or modified

All paths are listed in `source-manifest.json`. By area:

| Area | Contents |
|------|----------|
| `src/core/` | ports (clock, ids, randomness, network, scheduler), config, canonical JSON, redactor, logger, identity, validator, sanitiser, errors, repository references, token helper, lifecycle, stats |
| `src/guardrails/` | wrapper (the single path for every tool), audit writer, rate limiter, approval service, admin channel (Unix socket), admin client (the human-side `approve` logic) |
| `src/data/` | snapshot store, CI data, dependency data, in-house semver, simulated CI, live GitHub reader |
| `src/tools/` | registry, `plan_dependency_upgrades`, `triage_ci_failure`, `get_ci_job` (read), `rerun_ci_job` (the only write) |
| `src/` (top level) | composition root (`app.ts`), server process logic (`serve.ts`), walkthrough logic (`walkthrough.ts`), benchmark logic (`bench.ts`) |
| `src/transport/`, `src/bin/` | stdio (with a per-message size guard) and HTTP transports, failed-login queue; thin process entry points `server`, `approve`, `new-token`, `walkthrough`, `bench` |
| `snapshots/` | three synthetic sample repositories (`sample-node-api`, `sample-web-app`, `sample-cli-tool`) with manifest, registry, advisories and CI runs |
| `test/` | one spec per module, end-to-end specs (skeleton, approval flow, live mode, walkthrough), shared fakes |
| Project files | `package.json`, lockfile, `tsconfig*.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, `.nvmrc`, `.gitignore`, `.gitleaks.toml`, `.github/` workflows and dependabot, `scripts/pre-commit-gitleaks.sh`, `README.md`, `SECURITY.md` |

## Key implementation decisions

- The SDK's low-level `Server` is used instead of the high-level tool registration, so every call, including malformed ones, reaches the wrapper and gets exactly one audit record.
- Pipeline order in the wrapper: identify, rate limit, validate, authorize, intent line, claim, execute, outcome line. Write tools can declare a precondition checked before any approval request exists, so nobody is asked to approve a re-run of a job that cannot be re-run.
- Approval: no code is printed anywhere; the human lists and confirms requests with the `approve` command (terminal required, escaped inputs and digest shown), over a per-process Unix socket in a 0700 per-user folder. The human-side logic lives in `src/guardrails/admin-client.ts` so it is held to 100% coverage; `src/bin/approve.ts` only opens the terminal.
- Audit: one JSON line per call, a write gets an intent line (fsynced) then an outcome line sharing one call ID; lock file, sticky 100 MiB cap, degraded start if the file is unusable.
- HTTP mode: loopback only, per-token client names, Host and Origin checks, constant-time token comparison, a serialised failed-login queue (200 ms each, 20 waiting), 50-connection and 64 KiB limits.
- Live reader: off by default, unauthenticated, two allowed hosts, no redirects, timeout and bounded retries; wired into triage only and returns run metadata without log lines.
- Test-only decisions: the offline guard in the test setup blocks outgoing network and datagram sockets and `fetch` but allows loopback and Unix sockets, because the approval socket and the HTTP specs need them. This is narrower than "any socket" in the plan.

## Test coverage summary

- 576 tests in 38 files, stable over repeated runs; `tsc --noEmit`, ESLint, Prettier and the build are clean.
- Coverage: `src/guardrails/**` 417/417 lines and 203/203 branches (100% and 100%); overall 99.37% lines and 94.77% branches against the 90% floor. No threshold was lowered.
- Benchmark on the development machine (real timers): reads p95 about 0.03-0.11 ms and max 1.6 ms, write path p95 4.3 ms, guardrail overhead p95 0.02 ms; all targets met.
- The walkthrough was run as a built child process with no terminal and an empty environment (and again under Node 24): it exited 0 and printed all five sections.

## Repair pass (Steps 22-28, from review findings R-01 to R-07)

- R-01 (Step 22): workflow, job, step and branch names from the live reader are sanitised (ANSI and control characters removed, whitespace collapsed) and capped at 120 characters before they reach the triage result; the triage report sanitises its workflow, job and step names too.
- R-02 (Step 23): the SDK's stdio reader closed the transport on an oversize buffer, and its limit counted bytes across messages. A guard in `src/transport/stdio.ts` now splits the input into lines itself. A message over 64 KiB (`MAX_STDIO_MESSAGE_BYTES`) is never parsed: the sender gets a JSON-RPC error (`-32600`, `data.code` `message_too_large`), one operational log line (`stdio.oversize`) and one audit record with outcome `invalid` (`GuardrailWrapper.rejectOversized`, rate-limited like a read); the server keeps serving.
  - Follow-up (review R-01): the error's request id comes from `IdScanner` (`src/transport/id-scanner.ts`), a small scanner that tracks string, escape and nesting state while the oversize line streams past, so only the message's own top-level `id` (a string up to 100 characters or a whole number up to 15 digits) is used, wherever it sits (the SDK client writes it last). A nested id, an id inside a string, an id of another type or a batch element gives `null`. The guard never holds more than 64 KiB of a message. A spec sends an oversize request through the real SDK client and gets a rejection with its own id instead of a timeout.
  - Follow-up (reviewer minors R-02/R-03): messages that arrive behind a pending oversize reply wait in a queue capped at 1000 messages or 1 MiB (`MAX_QUEUED_MESSAGES`, `MAX_QUEUED_BYTES`); beyond it the guard stops reading, logs one `stdio.queue_overflow` line and closes the transport. A slow consumer pauses the input and waits for `drain` instead of letting memory grow (the guarded stream buffers about one maximum-size message). A final oversize message that ends without a newline is reported at end of input, so it also gets its log line and `invalid` audit record before shutdown begins (the disconnect callback now runs after the guard has flushed).
- R-03 (Step 24): the mode shown by `approve` comes from the `mode` dependency, not from whether tokens are configured.
- R-07 (Step 25): live response bodies are checked against `Content-Length` first and then read as a stream with a running byte count, refused at 5 MiB plus 1 byte.
- R-05 (Step 26): the logic that was hiding in `src/bin/` moved to tested modules (`src/serve.ts`, `src/bench.ts`); the single remaining coverage exclusion (`src/bin/**`) now describes only thin process entry points.
- Node pin (Step 27): `.nvmrc` is `24`, `engines.node` is `24.x`, `@types/node` is exactly 24.19.1 (its dependency `undici-types` moved with it; the lockfile also picked up the `guardrails-new-token` bin entry). The full suite with coverage (576 tests, same coverage), `tsc --noEmit`, ESLint, the build, the walkthrough and the benchmark were run under Node 24.21.0 through `npx -y node@24`. The CI workflows read `.nvmrc`.
- R-06 (Step 28): traceability rows for NFR8.6 and NFR1.1 now point at the files that emit the operational log events and enforce the size limits; this summary and the source manifest were updated.

## Deviations from the plan and design

- The offline guard allows loopback and Unix sockets (see above).
- The failed-login throttle follows the design's serialised queue, not the original wording of NFR1.16 ("5 failures a minute"). Your agreement to that change was requested at the NFR Design gate and approved there.
- Single-use approvals are proven at wrapper level; in the end-to-end flow a replay stops earlier at the job precondition.
- The 120-second live deadline cannot be reached with the current retry waits, so it is a defensive guard, tested through a configurable value.
- Node: decided as 24 (see the repair pass).
- The SDK client's message schema has no null request id, so a spec-conforming error with `id: null` for an unreadable oversize message is not parseable by the SDK's own client; the specs use a tolerant test transport.

## Not verified here

- The GitHub Actions workflows have not run on GitHub; action SHAs were resolved from the real repositories.
- `gitleaks` is not installed locally, so the config and pre-commit hook were never run against a planted secret.
- Repository settings (branch protection with required checks, private vulnerability reporting, secret scanning with push protection) are not changed by this stage.

## Assumptions & Open Questions

- [assumption] The sample snapshots are synthetic and labelled as such (confirmed at Plan Approval by approving the plan).
- Open: opening the first pull request so CI runs; no branch, commit or PR was created.
