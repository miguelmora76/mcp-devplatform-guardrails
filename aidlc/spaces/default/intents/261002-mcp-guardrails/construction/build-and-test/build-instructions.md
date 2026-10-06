# Build Instructions

Scope: the whole server (one implementation pass). All commands run from the project root. Evidence for the run recorded on 2026-10-05 is in `test-results.md`.

## Prerequisites

- Node.js: the version in `.nvmrc` (currently `26`; the Node pin is an open decision, see `build-and-test-summary.md`). `package.json` `engines` says `>=22`.
- npm (ships with Node). No other tools are needed to build and test. `gitleaks` is needed only for the pre-commit hook and the CI secret scan.
- No network and no credentials are needed for the build, the tests, the benchmark or the walkthrough.

## Install

```bash
npm ci
```

Installs exactly what `package-lock.json` pins. Runtime dependencies: `@modelcontextprotocol/sdk` and `zod` only.

## Environment variables (all optional for build and tests)

| Variable | Purpose |
|----------|---------|
| `GUARDRAILS_TOKENS` | HTTP mode only: comma-separated `name=token` pairs (at most 5, tokens at least 128 bits); create one with `npm run new-token` |
| `GUARDRAILS_HTTP_PORT` | HTTP mode port (default 8787) |
| `GUARDRAILS_AUDIT_PATH` | Audit file (default `./audit/audit.jsonl`) |
| `GUARDRAILS_LOG_LEVEL` | `error`, `warn`, `info` (default) or `debug` |
| `GUARDRAILS_LIVE` | Turns on the optional live GitHub reader (off by default) |
| `GUARDRAILS_SOCKET_DIR` | Folder for the approval socket (default per-user `~/.mcp-guardrails/run/`, mode 0700) |

## Build

```bash
npm run build
```

Compiles with `tsc -p tsconfig.build.json` into `dist/`. Expected result: exit code 0, no output.

## Build verification

```bash
npm run typecheck
npm run lint
npm run format:check
npm run walkthrough
```

- `typecheck`, `lint` and `format:check` must exit 0.
- `walkthrough` builds first, then prints five sections (upgrade plan, CI triage, refused write, rate-limited call, audit record) and exits 0, offline and without a terminal.

## Run the server

```bash
npm start            # stdio mode, started by the agent
npm run start:http   # optional HTTP mode on 127.0.0.1 (needs GUARDRAILS_TOKENS)
npm run approve      # in a separate terminal: list and confirm pending write approvals
```

## Troubleshooting

- `npm ci` fails with an engine or lockfile message: use the Node version in `.nvmrc` and do not edit `package-lock.json` by hand.
- Server refuses to start with an audit-lock message: another server is using the same audit file; stop it or set `GUARDRAILS_AUDIT_PATH` to a different file.
- Server refuses to start about the socket folder: the folder must be a real directory owned by you with mode 0700 and not a symlink.
- Audit file full (100 MiB): writes are refused and reads report an audit failure; stop the server, move the file aside, restart.
- Tests fail with a "network access" message from the test setup: a test tried to reach the network; tests must use the injected fakes.
