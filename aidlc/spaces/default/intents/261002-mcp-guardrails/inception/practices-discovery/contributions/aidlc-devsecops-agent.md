**Collaborator:** aidlc-devsecops-agent

## Contribution

Focus: lint/format, SAST/DAST, secret scanning, dependency scanning, supply chain. Context: the repo is PUBLIC, solo build, synthetic/public data only, and the product is an MCP server whose pitch is safe agent write access (approval gating, audit log, rate limits). Its own supply chain and secret hygiene are part of the portfolio claim.

### Gaps in the lead's draft

1. The draft has no security practices section. `Code Style` defers to a formatter/linter, but nothing covers SAST, secret scanning, dependency scanning, or supply chain. Phase rules in `construction.md` (Security) already mandate no hardcoded secrets, input validation at boundaries, and flagging auth bypass. These need an enforcement mechanism, not just prose. Suggest adding a `## Security Practices` block to `team-practices.md`. Note that only the five `team.md` sections are replaced by `practices-promote`, so durable security rules should be promoted as ALWAYS/NEVER entries in `## Mandated` / `## Forbidden`.
2. "Public repo" is stated, but its consequences are not. Secrets committed once are permanently exposed (git history, forks, scrapers), so prevention must run before push, not only in CI. The AI-DLC audit shards and records are also committed publicly; they must be covered by the same scanning (the brief already lists this as an acknowledged risk).
3. The draft is language-agnostic, which is fine for now, but tool choice depends on the language. The interview should capture the language and then I recommend the tools below.

### Recommended defaults (free, GitHub-native, solo-friendly)

Secret scanning:
- Enable GitHub secret scanning and push protection (free on public repos). This is a no-code, one-time setting.
- Local pre-commit hook with gitleaks (or detect-secrets), plus a gitleaks CI job over full history. Test fixtures must use obviously fake tokens; allowlist those explicitly rather than disabling rules.
- Policy: ALWAYS read credentials from environment or a secrets manager. If any secret is ever committed, treat it as compromised and rotate it. Rewriting history does not undo exposure.
- The `.mcp.json` passes credentials via environment only. Keep that rule for the project's own MCP configs. NEVER commit `.env` files (add to `.gitignore`; commit only `.env.example`).

SAST:
- GitHub CodeQL default setup (free on public repos) for JS/TS, Python, Go, and others. Add Semgrep OSS (`p/default`, plus rules for the chosen language) only if CodeQL does not support the language. Run on PRs and on `main`. Blocking threshold is a decision for the human (suggest: block on high/critical, warn on medium).
- DAST: for a stdio MCP server there is no HTTP attack surface, so conventional DAST (ZAP) does not apply. If hosting is later chosen (scope says Not Yet Decided), DAST re-enters scope for the HTTP transport. Suggested substitute: adversarial tests of the tool surface (prompt-injection strings in tool arguments, path traversal, oversized inputs, malformed JSON-RPC). These double as evidence for the "writes refused without approval" success measure and should be written as test cases, not a separate scanner.

Dependency scanning and supply chain:
- Enable Dependabot alerts and security updates, plus version updates grouped weekly. Add `dependency-review-action` on PRs to block newly introduced high-severity vulnerable or disallowed-license dependencies.
- Run the ecosystem audit in CI (`npm audit --omit=dev` / `pip-audit` / `govulncheck`, per language). Optionally OSV-Scanner for cross-ecosystem coverage.
- Always commit a lockfile and install from it in CI (`npm ci`, `uv sync --frozen`, `pip install --require-hashes` where practical). A lockfile does not exist yet.
- Pin GitHub Actions to full commit SHAs (Dependabot can update them), and set workflow `permissions: contents: read` at top level with job-level escalation only. Avoid `pull_request_target` with checkout of PR code. Public repos make Actions a real attack target.
- Keep the dependency set small. An MCP server needs the official MCP SDK and little else; each added package is portfolio-visible supply-chain surface. Suggested rule: justify every new runtime dependency in the PR description or ADR.
- OpenSSF Scorecard action plus a badge is a cheap, credible portfolio signal for a safe-agent project. Optional.
- SBOM (CycloneDX or SPDX via syft/`npm sbom`) and build provenance attestation (GitHub `attest-build-provenance`, npm provenance) at release time. Optional, only if a release artifact is published. Ask whether a package or release is intended at all.
- Enable branch protection on `main` (require passing status checks, no force-push) even solo. Because the trunk workflow may be PR-less for a solo builder, the interview must decide whether PRs are used as the CI gate. Without a PR or ruleset, "failure blocks merge" in the Code Style default cannot be enforced.
- Account hygiene: 2FA/passkey on the GitHub account, signed commits (optional), and a SECURITY.md stating the disclosure route (GitHub private vulnerability reporting, free).

Lint/format:
- Defaults per org: Prettier+ESLint (TS), Ruff (lint + format; replaces Black) for Python, gofmt+golangci-lint for Go. Add security-oriented lint rules: `eslint-plugin-security` (or `bandit` rules via Ruff `S` rules for Python, `gosec` for Go). Strict type checking (`tsc --strict` or mypy/pyright strict) is cheap and catches input-handling bugs.
- Enforcement: pre-commit for fast checks (format, lint, secrets) and CI as the authority. Failures block merge, per the org default.
- Because AI assistants write much of the code, add AI-code hygiene: review generated dependencies (hallucinated or typosquatted package names are a known slopsquatting risk). The dependency-review gate and the "justify every new dependency" rule address this.

Security design rules specific to the product (candidates for ALWAYS/NEVER, to be affirmed):
- NEVER log secrets or tokens in the audit log. Redact known token patterns and sensitive argument fields before write.
- ALWAYS validate and schema-check tool arguments at the MCP boundary and treat tool results fetched from external sources (CI logs, dependency changelogs, issue text) as untrusted input that may carry prompt injection. Never let such content directly trigger a write action.
- ALWAYS default to read-only and require explicit approval for writes (already a scope requirement; restate as a Mandated rule so it survives into Construction).
- NEVER use real credentials, private repos, or production data in tests or fixtures (restates the scope data constraint as Forbidden).
- Use least-privilege tokens for any live-GitHub access: fine-grained, read-only by default, scoped to public repos.

### Evidence-sensor caution

Tool names above reflect widely used free options and my own knowledge. Versions and free-tier terms were not verified against current documentation in this review. Treat them as candidates to confirm during Code Generation, not as researched facts.

### Questions for the human interview

1. Language and runtime: which will the server use (TypeScript, Python, Go, other)? This fixes the lint, SAST, and audit tooling. Options: A. TypeScript, B. Python, C. Go, X. Other.
2. Merge gate: do you work through PRs on short-lived branches (so CI and branch protection can block merges), or push to `main` directly? If direct, the "failure blocks merge" rule should become "pre-push hook + CI alerts".
3. Security scanning baseline: accept the free GitHub-native set (secret scanning with push protection, CodeQL, Dependabot, dependency-review) as mandatory, with gitleaks as a pre-commit hook? Which findings block (suggest high and critical)?
4. Supply-chain depth: is the baseline above enough (lockfile, SHA-pinned Actions, minimal dependencies), or do you also want SBOM, provenance, and Scorecard as portfolio signals? Is any package or release artifact going to be published?
5. Hosting and DAST: if the server may later be hosted over HTTP, should DAST be deferred to that decision, with adversarial tool-surface tests used until then?
6. Is a SECURITY.md and private vulnerability reporting wanted for the public repo?
7. Forbidden/Mandated rules to affirm: which of the product-specific rules above (no secrets in audit log, treat tool-fetched content as untrusted, read-only default, synthetic data only in fixtures) should be promoted as ALWAYS/NEVER?
8. Does the human accept that already-committed AI-DLC records get scanned with the same secret scanner (including a one-time history scan before the first public push of new branches)?

### Suggested integration

- Add a `## Security Practices` block to `team-practices.md` (draft) and, after affirmation, promote the confirmed items into `## Mandated` / `## Forbidden` in `discovered-rules.md`.
- In `evidence.md`, record that no CI, lockfile, scanner config, or `.gitignore` for secrets was found (the draft lists no CI or lockfile, but did not check `.gitignore` or GitHub repository settings, which are unverified from the working tree).
- The `Deployment` section: add that CI security gates (secret scan, SAST, dependency review) run before any "deploy on merge" step; if there is no hosted deployment, treat release tagging as the gated action.

## Positions

- OBJECT: team-practices.md omits security practices (secret scanning, SAST, dependency scanning, supply chain); on a public repo for a safety-themed project these must be asked and recorded, not left implicit.
- OBJECT: `Code Style` "failure blocks merge" is unenforceable if the solo workflow has no PRs or branch protection; the interview must resolve the merge gate.
- OBJECT: `evidence.md` lists "language, formatter, linter, CI platform not chosen" but not repository security settings or `.gitignore` state; mark them as unverified.
- AGREE: Testing Posture is correctly labelled as unaffirmed org fallback, and the "writes refused without approval" test is correctly recorded as a success measure.
- AGREE: Leaving Mandated/Forbidden empty until the interview is correct; nothing should be promoted before human affirmation.
