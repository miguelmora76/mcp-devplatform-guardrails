# Team Practices

## Way of Working

- We use trunk-based development. Work merges to `main` through short-lived feature branches, resolved within 1-2 days.
- Every change goes through a short-lived branch and a pull request with required automatic checks before merging, even though we are a solo build with one reviewer.
- Bolt branches are squash-merged into `main`, one commit per Bolt, named by the Bolt slug. The worktree base and merge target are `main`.
- GitHub Actions runs the automatic checks (format, lint, type-check, tests, coverage, security checks) on every pull request.
- The project is a solo build with AI assistants, in a public GitHub repository, with no deadlines.

## Walking Skeleton

- We build a thin end-to-end slice first, before the remaining features, to prove the pieces connect.
- The skeleton is verified with a Construction Verification Command that demonstrates the real end-to-end result. That command is not yet defined and is set when Construction begins.

## Testing Posture

- **Methodology**: bdd
- **Ordering**: Tests are written alongside the code they cover, in the same change, with each behaviour scenario (Given/When/Then) written before or together with the code that satisfies it.
- Coverage target: 90% overall, plus 100% line and branch coverage on the guardrail code (approval gate, audit log, rate limiter).
- Coverage floors are never weakened to make a step pass.
- Automated tests run in GitHub Actions before merge.

## Deployment

- Deployment is local. The README.md gives setup instructions for running the server locally.
- There is no hosted service, and therefore no staging or production pipeline.
- Security checks in GitHub Actions: CodeQL code scanning, automatic dependency updates, and a check on new dependencies in pull requests.
- Secret scanning with push protection is enabled on the repository.
- Supply chain: a committed lockfile, pinned GitHub Actions versions, and a small, justified set of dependencies.
- SECURITY.md is present, with private vulnerability reporting enabled.

## Code Style

- Language: TypeScript with strict mode enabled.
- Formatter: Prettier. Linter: ESLint. A type-check step runs too. All three run as automatic checks, and failures block merge.
- Naming follows normal TypeScript habits: camelCase for variables and functions, PascalCase for types and classes, kebab-case for file names.
- A local secret scanner runs before each commit, in addition to repository secret scanning with push protection.
