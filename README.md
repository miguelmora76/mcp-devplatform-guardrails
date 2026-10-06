# MCP developer-platform guardrails

A sample [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI
agents **guarded, auditable tools** for two developer-platform jobs: planning dependency
upgrades and triaging failed CI runs. The point is the guardrails around the tools, not
the tools themselves:

- **Read-only by default.** Every tool is read-only unless it is registered as a write tool.
- **One path for every tool.** A single wrapper applies the rate limit, input validation,
  the human approval check and the audit record. A test fails if a tool bypasses it.
- **Approval-gated writes.** The only write is re-running a failed job in a **simulated** CI
  system inside this project. The agent can only _ask_; a person approves in a separate
  terminal step the agent has no tool for.
- **Audit log.** Every call leaves a redacted, append-only record in a local file.
- **Untrusted outside text.** CI logs and advisory text are only ever quoted as data and can
  never select a tool or grant an approval.

All data is **synthetic**: the three bundled sample repositories in `snapshots/` were written
for this project and are labelled as such (`"synthetic": true`). Nothing contacts a real CI
system, and no real credentials, private repositories or production data are used.

## Tools

| Tool                       | Kind  | What it does                                                                                          |
| -------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `plan_dependency_upgrades` | read  | Lists outdated dependencies with a patch/minor/major rating, advisories each upgrade fixes, and order |
| `triage_ci_failure`        | read  | Classifies a failed run, names the failing step, quotes key log lines, says if it happened before     |
| `get_ci_job`               | read  | Shows the status and attempt of a job in the simulated CI                                             |
| `rerun_ci_job`             | write | Re-runs a failed job in the simulated CI **only after a human approval**                              |

## Setup

You need Node.js 24, the version pinned in [`.nvmrc`](.nvmrc) and in `engines` (for example `nvm use`), then:

```bash
npm ci
```

Nothing else is required: no network, no credentials, no database.

## Run the tests

```bash
npm test
```

This runs the whole suite offline. `npm run test:coverage` adds the coverage report and
enforces the thresholds (90% overall; 100% lines and branches for the guardrail code in
`src/guardrails/`). `npm run check` runs type-check, lint, format check and the coverage run.

## Try the walkthrough

```bash
npm run walkthrough
```

It builds the project, then shows five outputs against the bundled snapshots, offline and
with no terminal: an upgrade plan, a CI triage, a write refused for lack of approval, a
rate-limited call, and the audit record that results. `npm run bench` measures the
performance targets with real timers (reads p95 under 1 s, guardrail overhead p95 under 50 ms).

## Use it with an agent

The agent starts the server as a local process and talks to it over standard input and output:

```bash
npm run build
node dist/bin/server.js
```

For example, in an MCP client configuration use the command `node` with the argument
`/path/to/this/repo/dist/bin/server.js`. Operational logs (JSON lines) go to standard
error; standard output carries only the protocol.

Each protocol message may be at most 64 KiB. A larger one is never parsed: the server
answers with a JSON-RPC error (code `-32600`, `data.code` `message_too_large`; the request
id is used when it can be found near the start of the message, otherwise `null`), writes one
log line and one audit record with outcome `invalid`, and keeps serving.

### Approving a write

1. The agent calls `rerun_ci_job`. With no approval it gets `approval_required` and a
   **request reference** (`req_...`). The server logs a one-line notice on standard error
   (tool, client, reference); it carries no secret.
2. A person runs the approve command **in a terminal**:

   ```bash
   npm run approve            # lists pending requests, shows the exact action, asks for `yes`
   npm run approve -- req_... # go straight to one request
   ```

   It shows the tool, client, the exact inputs (control characters escaped) and an input
   digest, and approves only if you type `yes`. It refuses to run without a terminal.

3. The agent calls `rerun_ci_job` again with the same arguments plus
   `approvalRequestId: "req_..."`. The approval is **single use**, valid for **5 minutes**
   from the moment you approve, and bound to the exact tool, client and inputs. It is
   refused if reused, expired, or presented for different inputs.

The approval travels over a Unix socket in `~/.mcp-guardrails/run/` (owner-only folder, one
socket per server process), never through an MCP tool or HTTP route. macOS and Linux only.

The socket path (`<GUARDRAILS_SOCKET_DIR>/<pid>.sock`) must fit the operating system's limit:
103 bytes on macOS, 107 on Linux. With a long `HOME` or `GUARDRAILS_SOCKET_DIR` the server
refuses to start and says so in one log line that names the setting and the limit (set
`GUARDRAILS_SOCKET_DIR` to a short folder such as `/tmp/guardrails-run`). For any other
unexpected startup failure the log line carries only the Node error code (for example
`EACCES`), never the message or a path, so you can search for it.

A write is also refused up front if it cannot succeed (for example the job did not fail),
so you are never asked to approve something impossible.

### Optional HTTP mode

For more than one client, run the server on the loopback address with one token per client
(at most 5):

```bash
npm run new-token                      # prints a new token once; stores nothing
export GUARDRAILS_TOKENS="alice=mgt_<token from new-token>,bob=mgt_<another token>"
node dist/bin/server.js --http         # listens on 127.0.0.1:8787 (GUARDRAILS_HTTP_PORT)
```

Send `POST /mcp` with `Authorization: Bearer <token>`. The token's name is the client name
used for the audit record and rate limits. Requests with a non-loopback `Host` or `Origin`
are refused, bodies over 64 KiB are refused, and failed logins go through a serialised
throttle so a valid token is never delayed. Tokens exist only in the environment and never
reach the audit file or logs.

### Configuration (environment variables)

| Variable                | Default                 | Meaning                                     |
| ----------------------- | ----------------------- | ------------------------------------------- |
| `GUARDRAILS_AUDIT_PATH` | `./audit/audit.jsonl`   | Audit file location                         |
| `GUARDRAILS_LOG_LEVEL`  | `info`                  | `error`, `warn`, `info` or `debug`          |
| `GUARDRAILS_TOKENS`     | none                    | HTTP clients, `name=token` pairs, at most 5 |
| `GUARDRAILS_HTTP_PORT`  | `8787`                  | Loopback port for `--http`                  |
| `GUARDRAILS_SOCKET_DIR` | `~/.mcp-guardrails/run` | Folder for the approval socket              |
| `GUARDRAILS_LIVE`       | off                     | `1` or `true` turns on live GitHub reading  |

## The audit file

Every tool call writes to `./audit/audit.jsonl` (override with `GUARDRAILS_AUDIT_PATH`), one
JSON object per line with `ts`, `callId`, `phase`, `tool`, `client`, `inputs` (redacted) and
`outcome`. A call has one call ID: one line for reads and refusals, and for an approved write
an `intent` line (flushed to disk before anything changes) followed by an `outcome` line.
If the audit file cannot be written, writes are refused and reads return their result with
an audit-failure flag. Lines are never rewritten, and a lock file keeps a second server from
writing the same file.

**When the 100 MiB cap is reached** the file counts as not writable: writes are refused and
reads report the failure. Nothing is dropped or truncated. To recover, stop the server, move
or archive the file (for example `mv audit/audit.jsonl audit/audit-2026-10.jsonl`), and start
it again. If a crash left a stale `audit.jsonl.lock`, the next start replaces it when its
process no longer exists.

## Live GitHub reading (optional, off by default)

With `GUARDRAILS_LIVE=1` the server may read a **public** repository's workflow run through
the unauthenticated GitHub API (`owner/name` instead of a snapshot name). Limits:

- Only `triage_ci_failure` supports it, and only run and job **metadata**: raw CI logs need
  a login and a redirect, so they are not available live. Such a triage has no log lines to
  quote and is reported as `unclassified`. Upgrade planning uses the bundled snapshots only.
- It sends no credentials, contacts only `api.github.com` and `github.com`, never follows
  redirects, times out after 10 s and retries transient failures at most 3 times.
- With it off (the default) no tool makes any network call.

## Trust model and accepted risk

The approval step holds against everything the agent can reach through the protocol: the MCP
tools, the stdio stream and every HTTP route. A **malicious agent that also has a shell as
the same operating-system user is out of scope**: it could talk to the approval socket
directly or read the environment. The design reduces the exposure but does not claim to
stop it. See [`SECURITY.md`](SECURITY.md) for how to report a vulnerability privately.

## Project checks

GitHub Actions runs format, lint, type-check (a separate job), tests with coverage, a build,
gitleaks, CodeQL and dependency review on every pull request; the benchmark runs as an
informational job. Actions are pinned to full commit SHAs and the Node version comes from
`.nvmrc`. A pre-commit gitleaks script is in `scripts/pre-commit-gitleaks.sh` (install it
yourself: `ln -s ../../scripts/pre-commit-gitleaks.sh .git/hooks/pre-commit`).

## How it was built (AI-DLC records)

This project was built with the AI-DLC workflow. The records of what was decided and why are
in [`aidlc/spaces/default/intents/261002-mcp-guardrails/`](aidlc/spaces/default/intents/261002-mcp-guardrails/):

- Ideation: [`ideation/`](aidlc/spaces/default/intents/261002-mcp-guardrails/ideation/) (intent, scope, approval hand-off)
- Inception: [`inception/`](aidlc/spaces/default/intents/261002-mcp-guardrails/inception/)
  ([requirements](aidlc/spaces/default/intents/261002-mcp-guardrails/inception/requirements-analysis/requirements.md),
  [practices](aidlc/spaces/default/intents/261002-mcp-guardrails/inception/practices-discovery/))
- Construction: [`construction/`](aidlc/spaces/default/intents/261002-mcp-guardrails/construction/)
  ([NFR requirements](aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-requirements/),
  [NFR design](aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/),
  [code generation](aidlc/spaces/default/intents/261002-mcp-guardrails/construction/code-generation/))
