# Integration Test Instructions

Scope: the key boundaries of the server. Standard test strategy: unit tests (see `../code-generation/unit-test-instructions.md`) plus integration tests at these boundaries.

## Boundaries and the specs that cover them

| Boundary | Spec | What it proves |
|----------|------|----------------|
| MCP client to stdio transport to wrapper to triage tool to audit file | `test/e2e/skeleton.test.ts` | End-to-end read call; exactly one audit line |
| Wrapper to write tool, `approve` client to admin socket, simulated CI | `test/e2e/approval-flow.test.ts` | Write refused without approval; approved write changes only the simulated CI; swapped inputs, expired approval, unwritable audit file and injected log text never cause a write |
| Optional live reader to tools (fake network) | `test/e2e/live-mode.test.ts` | Off by default makes no request; on, only the two allowed hosts, no credentials, bounded retries |
| Walkthrough over bundled snapshots | `test/e2e/walkthrough.test.ts` | The five documented outputs, offline |
| Loopback HTTP transport to wrapper | `test/transport/http.test.ts` | Host/Origin/token checks, per-token client names, body cap, failed-login queue, connection bound |
| Tool registry against real tools | `test/tools/registry.test.ts` | No unwrapped tool, no unapproved state-changing tool, no tool that issues approvals |
| Wrapper with real audit writer, five parallel clients | `test/guardrails/wrapper.test.ts`, `test/guardrails/audit.test.ts` | One call ID per call, no interleaved lines |

## Setup

- Same as unit tests: `npm ci`, then no network, no credentials. The test setup file `test/support/setup.ts` blocks outgoing network, datagram sockets and `fetch`; loopback and Unix sockets are allowed because the approval socket and the HTTP specs need them.
- Each spec uses a temporary folder for the audit file and approval socket and removes it afterwards.

## Commands

```bash
npx vitest run test/e2e
npx vitest run test/transport/http.test.ts test/tools/registry.test.ts
```

Expected: all pass. The full suite (`npm run test:coverage`) runs these together with the unit specs.

## Coverage expectation

- The integration specs contribute to the shared coverage run; no separate threshold. The gating thresholds are the project-wide ones: 90% overall lines, 100% lines and branches on `src/guardrails/**`.

## Not covered by these specs

- A real MCP client such as an agent product connecting to the built server over stdio (the specs use the SDK's in-process client).
- Running on GitHub Actions: the workflows have not executed yet.
