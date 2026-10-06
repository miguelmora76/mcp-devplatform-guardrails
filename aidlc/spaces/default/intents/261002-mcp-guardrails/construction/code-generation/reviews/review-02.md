## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-05T23:53:19Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | src/transport/stdio.ts > findId, ID_SEARCH_BYTES; test/transport/stdio.test.ts > lineOfSize | The request id of an oversize message is read only from the first 8192 bytes. The MCP SDK client serialises requests as `{method, params, jsonrpc, id}` (node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js lines 666-670), so for a real client the id comes after the large params. I ran the regex on such a message: no match, so the reply carries `id: null` and the SDK client cannot correlate it; its request waits until timeout, which is close to the silence R-02 was meant to remove. The same regex also takes the first `"id"` anywhere in the head: a message with `params.arguments.id = 99` before the real id of 5 gets a reply for id 99, which can answer another in-flight request. The tests miss this because `lineOfSize` builds id-first messages by hand and no test sends an oversize request through the real client. | Find the top-level id only: keep a bounded tail (for example the last 8 KiB) as well as the head, or scan top-level keys by depth, and match only at depth 1. Add scenarios for an id-last message and a nested `id` in params, and one with the real SDK client sending an oversize call that expects an error response correlated to that call. | New |
| R-02 | Minor | src/transport/stdio.ts > guardMessages | There is no back-pressure. `input` is never paused while `onOversize` is pending (audit write plus reply), and `output.write` return values are ignored. Valid lines that arrive behind an oversize one are queued in `chain` as buffers of up to 64 KiB each, with no count or byte cap. Memory is bounded only by how fast the audit write finishes. | Pause the input while the chain is non-empty, or cap queued bytes and messages, and add a test. | New |
| R-03 | Minor | src/transport/stdio.ts > guardMessages 'end' handler | A final oversize message with no newline is dropped silently: no reply, no log, no audit record. This matches the SDK reader, which also needs a newline, but it is an unaudited drop. | Record it in a code comment or the README as a known edge, or emit the log line for it. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| npx vitest run --coverage | PASS: 37 files, 532 tests; overall lines 99.39%, branches 94.65%; no src/guardrails/** row listed (all 100%) and no threshold error | Meets 90% overall and 100% lines and branches on src/guardrails/**. Thresholds in vitest.config.ts are unchanged: lines 90 overall, guardrails 100/100. |
| tsc --noEmit | PASS, no output | Type check clean. |
| eslint . | PASS, no output | Lint clean. |
| prettier --check . | PASS | Format clean. |
| aidlc engine sensor-traceability (code-generation) | pass:true, 0 gaps, 0 orphans, 0 invalid targets | Every target file in traceability.json exists. |

### Repair verification (previous R-01 to R-07)

- Live-mode names (Step 22): `toJob` and `getRun` in src/data/live-github.ts apply `sanitizeUntrustedName`, and triage-ci-failure.ts re-sanitises workflow, job and step. test/data/live-github.test.ts (lines about 380-420) feeds ANSI, BEL, newline, instruction-like and over-long names, so removing the calls would fail the test. Fixed.
- Oversize stdio (Step 23): the guard is sound for byte accounting. A message of exactly 64 KiB passes, one byte more is reported, pieces are reassembled, multibyte input is safe because it works on Buffers, and a rejected reply does not stop the stream. Order is kept through the `waiting` counter and the chain. One audit record per oversize message comes from `rejectOversized`, which also counts against the read rate limit. Tests cover the log line, the audit record, the null id and continued service. Only the id extraction (R-01 above) is weak for real clients.
- Approve mode (Step 24): src/app.ts passes `deps.mode` to the admin channel. test/e2e/approval-flow.test.ts line 233 exports GUARDRAILS_TOKENS in a stdio harness and expects `stdio`. It would fail if the mode were guessed from tokens again. Fixed.
- Live body size (Step 25): `parseBody` checks Content-Length before reading, then counts streamed bytes and cancels the reader at 5 MiB plus 1. Fixed.
- Coverage exclusions (Step 26): only `src/bin/**` is excluded, with a reason I could check against the thin entry points. No thresholds were lowered. Fixed.
- Node pin (Step 27): .nvmrc is 24, engines.node is 24.x, @types/node is exactly 24.19.1 in package.json and the lockfile, and all workflows use `node-version-file: .nvmrc`. README says Node 24. Consistent. I ran the suite on the local Node 26.8.2, not Node 24; the summary reports a Node 24.21.0 run through npx and I did not repeat it.
- Traceability (Step 28): NFR8.6 now has four emitting files (lifecycle, http, wrapper, live-github) and NFR1.1 has validator, stdio and http. I spot-checked more than 10 rows across FR and NFR (FR2, FR4.1, FR8.1, FR6.3, NFR1.1, NFR1.11, NFR1.16, NFR3.3, NFR7.3, NFR8.6, NFR8.8). All targets exist. NFR1.11 points to snapshot-store.ts, while the live-body check sits in live-github.ts; this is acceptable as the size constant lives there.
- Rules regression check: all tools still go through the single wrapper; `rejectOversized` goes through `admit` and `refuse`, and its arguments are `_omitted` plus a byte count, so no message content or secret reaches the audit log. No write path was added.

### Summary

All seven earlier findings are fixed in code with tests that would fail without the fix, and the quality gates pass with the required coverage. The remaining concern is that the oversize reply carries a null or wrong id for real SDK clients (R-01), which weakens the intent of the earlier R-02 fix. It is one Major with two Minors, which is within the READY limit, but it should be fixed in this repair loop if iteration 2 is allowed.
