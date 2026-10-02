**Collaborator:** aidlc-developer-agent

## Contribution

### Gaps in the draft (code-style focus)

1. Code Style is the thinnest section. It says "no language chosen", but the original project description fixes TypeScript. Treat TypeScript as a stated fact (cite the project description), not an open question. The interview should confirm it and then resolve the toolchain. The org default (Prettier for JS/TS, ESLint, camelCase) already names the tools, so the question is whether to affirm them or choose alternatives such as Biome.
2. The draft says the team "defers to project configs", but the repo has none. In a greenfield repo the config files are created by Construction, so the affirmed practice must say which tools to create. Otherwise the org rule is circular.
3. The draft does not mention the type-check sensor (`aidlc-type-check.md`) or the linter sensor. A strict TypeScript setup should be affirmed so that sensor has something to enforce.
4. There is nothing on error handling. The construction phase rules require handling at integration boundaries and no silent failures. For an MCP server that gates writes, the practice must say how denials are represented.
5. There is nothing on layer boundaries or file organization. These affect the guardrail design, because the approval gate, audit log and rate limiter must not be bypassable by any tool handler.

### Suggested affirmed practices (proposals for the interview)

Code style and toolchain
- Language: TypeScript, `strict: true`, ESM, on a current Node LTS. Confirm the runtime and the package manager (npm, pnpm or bun). The AI-DLC tooling uses bun, but the product need not.
- Formatter: Prettier, run with `--check` in CI. Linter: ESLint with typescript-eslint (type-aware rules). Lint and format failures block merge, per org.md.
- Naming: camelCase for variables and functions, PascalCase for types and classes, kebab-case for file names, UPPER_SNAKE_CASE for constants. Tool names exposed over MCP are snake_case with a verb-noun prefix (for example `plan_dependency_upgrade`). Write-capable tools carry a distinguishing marker so the read-only versus write distinction is visible to the client.
- No `any` without a justifying comment. Prefer `unknown` with narrowing.

Layer boundaries
- Suggested layers: (a) transport and MCP registration; (b) guardrail pipeline (read-only default, call-rate limit, approval gate, audit log); (c) tool handlers (dependency planning, CI triage, writes); (d) adapters for external systems (public GitHub or fixtures). Handlers never call adapters directly for a write. All writes pass through the guardrail layer.
- Rule candidate: ALWAYS register every tool through one wrapper that applies the audit log, rate limit and approval checks. NEVER register a tool handler directly with the MCP SDK. This is the structural way to make "writes refused without approval" provable.
- Adapters take injected clients, so tests use synthetic fixtures. This supports the "synthetic or public data only" constraint.
- Domain logic stays free of MCP SDK types, so it can be unit-tested without a transport.

Error handling
- Use typed errors or a `Result` type for expected denials (approval missing, rate limit exceeded, read-only mode). Reserve thrown exceptions for programmer errors and fatal failures. The mapping to MCP error responses lives in one place, at the boundary.
- Denials must carry a stable machine-readable code (for example `APPROVAL_REQUIRED`, `RATE_LIMITED`, `READ_ONLY`) and must be audit-logged just like successes.
- Failure mode: the guardrails fail closed. If the audit log cannot be written or the approval state cannot be determined, the call is refused. NEVER swallow errors silently (matches construction.md).
- Validate all tool inputs at the boundary with a schema library such as zod. Candidate rule: ALWAYS validate input before any guardrail or handler logic runs.

Secrets and data
- ALWAYS read credentials from environment variables. NEVER commit tokens. The repo is public, so a pre-commit or CI secret scan is worth considering.
- Audit logs must not record secrets or sensitive arguments. Define a redaction rule.

File organization
- Suggested layout: `src/server/`, `src/guardrails/`, `src/tools/<area>/`, `src/adapters/`, `src/lib/`, `test/` (or tests colocated as `*.test.ts`), `fixtures/` for synthetic data. Confirm whether tests are colocated or in a separate tree.
- Single package, not a monorepo, unless the interview says otherwise (solo, no deadlines).

Testing interplay (my angle only)
- The 80 percent coverage floor in the draft is the org default for the scope families that add one. Confirm whether this scope falls into one. The construction phase rules also require happy-path plus at least two error or edge cases per test file.
- A runner choice (Vitest or Jest) belongs in Code Style or Tech Stack. The write-refusal test is a required acceptance test regardless of methodology. Suggest affirming it as a Mandated rule.

### Questions for the human interview

1. Confirm TypeScript. Which runtime and package manager (Node LTS plus npm or pnpm, or bun)? Which MCP SDK (the official `@modelcontextprotocol/sdk`)? Which transport (stdio, HTTP, or both)? The transport also settles the "hosting" question that the draft marks undecided.
2. Formatter and linter: affirm Prettier plus ESLint with typescript-eslint, or choose Biome? Should `tsc --noEmit` run as a CI gate?
3. Do you want the structural rule that every tool registers through a single guardrail wrapper (no direct SDK registration), with a lint or test enforcing it?
4. Error model: `Result` type for denials versus thrown typed errors? Should guardrails fail closed when the audit log is unavailable?
5. Audit log: what storage (append-only JSONL file, SQLite, or stdout)? What redaction policy? (Detail may belong to design, but the practice of "no secrets in logs" should be decided now.)
6. File organization: colocated tests or a `test/` tree? Single package? Preferred file-naming convention?
7. Should a pre-commit hook (lint, format, secret scan) run locally, given the repo is public and solo?
8. Dependency policy: pin exact versions or use ranges? Commit the lockfile (recommended)? Run `npm audit` or Dependabot, which fits a dependency-upgrade-planning project?
9. Commit message style: Conventional Commits, or Bolt-slug naming only? (org.md specifies squash by Bolt slug.)
10. Which hard constraints (candidates for Mandated/Forbidden): synthetic or public data only; no secrets in the repo or logs; no write path outside the guardrail wrapper; no `any` without justification.

### Evidence and accuracy notes on the draft

- The draft's evidence says the language is not chosen. The project description says TypeScript, so correct this in `evidence.md` and `team-practices.md`.
- Code Style should be a concrete proposed block, not only "defer to config", so the affirmation gate has something to confirm.
- discovered-rules.md is empty, which is fine for the first turn. The candidate rules above are the draft Mandated and Forbidden entries to propose after the interview.

## Positions

- OBJECT: The draft's Code Style says "no language ... chosen yet". The original description states TypeScript, so it should be recorded as a stated fact and only the toolchain left open.
- OBJECT: Code Style defers entirely to project config files that do not exist yet. Propose a concrete toolchain block (strict TypeScript, Prettier, ESLint, naming rules) for the human to affirm.
- OBJECT: The draft has no practices for error handling, layer boundaries or file organization. These must be covered, because the guardrail design depends on them.
- AGREE: Treating the org defaults as suggestions only, and leaving Mandated and Forbidden empty until the interview, is the right first-turn approach.
- AGREE: Raising the self-review question for a solo trunk-based workflow and the hosting uncertainty that affects the Deployment default.
