# CI Configuration

Scope: the whole server. The pipeline files already exist in the project folder (written in Code Generation, Step 19, and unchanged since); this document describes them, records the decisions in `ci-pipeline-questions.md` (Q1-Q3), and lists what is not yet in place on GitHub. Nothing on GitHub was changed by this stage. Sources: `[Qn]` = `ci-pipeline-questions.md`; `[TP]` = `aidlc/spaces/default/memory/team.md`; `[BT]` = `../build-and-test/`.

## Tool and branch strategy

- CI tool: GitHub Actions, public repository `MAM-AI-Projects/mcp-devplatform-guardrails` [TP].
- Branch strategy: trunk-based with short-lived branches and pull requests, squash-merged to `main` [TP]. Decision [Q1 A]: create `main` on the remote from the current tip of `ideation-records`, make it the default branch, then open the first pull request from a short-lived branch into it. Today the remote has only `ideation-records`.
- Node version: every job reads `.nvmrc` (`24`), the same file local setup uses; `engines.node` is `24.x` [BT].

## Triggers and permissions

| Workflow | Triggers | Permissions |
|----------|----------|-------------|
| `ci.yml` | every pull request; push to `main` | `contents: read` |
| `codeql.yml` | every pull request; push to `main`; weekly schedule (Monday 04:23 UTC) | `contents: read` at top level; job-level permissions for security events |
| `dependency-review.yml` | every pull request | `contents: read` |
| `dependabot.yml` | weekly updates for `npm` and `github-actions`, at most 5 open pull requests each | (Dependabot service) |

`ci.yml` cancels an in-progress run of the same ref when a new commit arrives.

## Jobs (`ci.yml`)

| Job name (status check) | Command | Blocks merge |
|-------------------------|---------|--------------|
| Format check | `npm run format:check` | yes |
| Lint | `npm run lint` | yes |
| Type check | `npm run typecheck` | yes |
| Tests and coverage | `npm run test:coverage` (fails below 90% lines overall or below 100% lines and branches on `src/guardrails/**`); uploads the `coverage` artifact | yes |
| Build | `npm run build` | yes |
| Secret scan (gitleaks) | gitleaks action with `.gitleaks.toml`, full history | yes |
| Benchmark (informational) | `npm run bench` | no (`continue-on-error`; shared runners are too noisy to enforce the targets, which are enforced locally) |

Other required checks: `Analyze (JavaScript and TypeScript)` (CodeQL, `javascript-typescript`, `build-mode: none`) and `Review new dependencies` (dependency review, fails on high severity or above).

Every job uses `npm ci`, so the committed `package-lock.json` is the single source of dependency versions, and `actions/setup-node` caches npm downloads.

## Pinned actions

All `uses:` references are pinned to full 40-character commit SHAs with the release tag in a trailing comment (checked by grep; no exception found):

| Action | Tag |
|--------|-----|
| `actions/checkout` | v7.0.1 |
| `actions/setup-node` | v7.0.0 |
| `actions/upload-artifact` | v7.0.1 |
| `gitleaks/gitleaks-action` | v2.3.9 |
| `github/codeql-action` (init, analyze) | v4.38.2 |
| `actions/dependency-review-action` | v4.9.0 |

The SHAs were resolved from the real repositories by the developer; nobody has re-checked each one against its tag comment since.

## Artifacts and publishing [Q3 A]

- Nothing is published: no registry, no container image, no tagged release in the first version. The only artifact is the `coverage` upload from the test job, kept for the default retention period. No artifact repository is configured.

## Merge protection to apply on `main` [Q2 A]

Decided, not yet applied. Settings for `main` once it exists:

- Require a pull request before merging, with zero approving reviews (solo build).
- Require status checks to pass, and require the branch to be up to date: Format check, Lint, Type check, Tests and coverage, Build, Secret scan (gitleaks), Analyze (JavaScript and TypeScript), Review new dependencies.
- Block force pushes and branch deletion.
- Squash merge only.

A status check can only be selected after it has run once, so the first pull request must run all workflows before protection can list them. Applying the settings (a repository administrator action in the GitHub settings, or `gh api` calls) is outside this stage and waits for the human's go-ahead.

## Repository settings still to enable

Read-only queries on 2026-10-05 showed: secret scanning `disabled`, push protection `disabled`, Dependabot security updates `disabled`, private vulnerability reporting `false`, no branch protection, and no `main` branch. The team practices require the first four to be on [TP].

## Risks and gaps

- The workflows have never run on GitHub; the first pull request is their first real check (syntax, action versions, permissions).
- `gitleaks/gitleaks-action` requires a licence key (`GITLEAKS_LICENSE`) when the repository belongs to an organisation account; this repository is under the organisation `MAM-AI-Projects`. Without the key the secret-scan job will fail on the first run. Either obtain the key or replace the action with the gitleaks command-line tool run directly in the job (a pinned release with a checked checksum). This is an open decision for the first pull request.
- The pre-commit hook `scripts/pre-commit-gitleaks.sh` fails the commit when gitleaks is not installed, and gitleaks is not installed on this machine.
- CodeQL results appear only after the first analysis on the default branch.

## Sources

- [Q1 A], [Q2 A], [Q3 A]; `team.md` (Way of Working, Deployment); `.github/` files; `../build-and-test/build-and-test-summary.md`.

## Assumptions & Open Questions

- [assumption] The check names listed above are the job names currently in the workflows; they must be re-read from the first run before protection is configured.
- Open: gitleaks licence versus running the command-line tool (see Risks).
- Open: whether the assistant may apply the repository settings and create `main` through the GitHub API once you give the go-ahead, or you do it in the web settings.
