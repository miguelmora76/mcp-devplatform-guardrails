# Practices Discovery — Interview

Context: this is a solo build with AI assistants, in a public GitHub repo, with no deadlines. Your description says the server is written in TypeScript. The release engineer, quality engineer, developer and security engineer each reviewed a first draft. Their suggestions below are suggestions only; nothing becomes a practice until you pick it.

Fill in each `[Answer]:` tag with a letter (A-E, or X for your own wording). Every question has a "not yet defined" option.

## Q1. How should your work get merged into the main branch?

Why we ask: with one person there is no peer reviewer, so a pull request with automatic checks (tests, lint) is the only independent gate. The org default is short-lived feature branches merged into `main`.

- A. Short-lived branch and a pull request, with required automatic checks before merging, even though I'm the only reviewer
- B. Short-lived branch merged by me without a pull request; checks run but don't block
- C. Commit straight to `main`; checks run afterwards
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q2. Build a thin end-to-end slice first? A walking skeleton is a minimal version that runs the whole way through, built first to prove the pieces connect before the real features go in.

Why we ask: it decides whether the first piece of building is a tiny working slice (for example, a read-only call that leaves an audit record and a write that gets refused) before filling in the rest.

- A. Yes, build the thin end-to-end slice first
- B. No, build the capabilities one at a time without a slice first
- C. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q3. How should tests be written relative to the code?

Why we ask: the project must prove by test that writes are refused without approval, every call is logged, and rate limits reject excess calls. The quality engineer suggests writing those guardrail tests first, and testing the read-only tools after.

- A. Mixed: tests first for the guardrails (approval, audit log, rate limits), tests after for the read-only tools
- B. Tests first for everything (test-driven)
- C. Behaviour-style tests (Given/When/Then wording) written alongside the code
- D. Tests after the code for everything (the org default)
- E. Not yet defined
- X. Other (please specify)

[Answer]: C

## Q4. What test-coverage target should apply?

Why we ask: the org default is an 80% line-coverage floor. The quality engineer notes that line coverage alone can miss the refusal and rejection paths, which are the point of this project.

- A. 80% overall, plus 100% line and branch coverage on the guardrail code (approval, audit log, rate limits)
- B. 80% overall only
- C. A different target (please give it under X)
- D. Not yet defined
- X. Other (please specify)

[Answer]: X. 90% overall, plus 100% line and branch coverage on the guardrail code (user wording: "90% + 100% on guardrails")

## Q5. How should the project be released?

Why we ask: hosting the server as a running service is still undecided from Scope Definition. The org default assumes a staging and production setup, which may not apply.

- A. No hosted deployment; release by tagging `main` once automatic checks pass
- B. Deploy to a staging environment on merge, with production behind a manual approval (the org default)
- C. Not yet defined; decide when hosting is decided
- X. Other (please specify)

[Answer]: X. Local deployment, with instructions in README.md on how to set it up (user wording: "Local deployment with instructions in README.md on how to set that up")

## Q6. What code style and tooling should apply?

Why we ask: the developer suggests strict TypeScript, Prettier for formatting, ESLint for linting, and a type-check step, all enforced in automatic checks. Names would follow normal TypeScript habits (camelCase, PascalCase, kebab-case file names).

- A. Accept that suggestion (strict TypeScript, Prettier, ESLint, type-check as automatic checks)
- B. Same idea but with different tools (please name them under X)
- C. Not yet defined; settle the exact tools later
- X. Other (please specify)

[Answer]: A

## Q7. Which security checks should run on the public repo? (select all that apply)

Why we ask: committed secrets on a public repo are exposed permanently, and this project's pitch is safe agent access. The security engineer suggests free GitHub-native options.

- A. Secret scanning with push protection, plus a local secret scanner before each commit
- B. Code scanning (CodeQL), automatic dependency updates, and a check on new dependencies in pull requests
- C. A committed lockfile, pinned GitHub Actions versions, and a small justified set of dependencies
- D. A SECURITY.md and private vulnerability reporting
- E. None / not yet defined
- X. Other (please specify)

[Answer]: A, B, C, D

## Q8. Which hard rules should always or never apply? (select all that apply)

Why we ask: hard rules you state here are promoted into the project rules and bind every later stage. Only the ones you pick are recorded.

- A. ALWAYS route every tool through a single approval, audit and rate-limit wrapper, with read-only as the default; NEVER add a write tool that bypasses the approval step
- B. ALWAYS have automated tests for refused writes, one audit record per call, and rate-limit rejection
- C. NEVER use real credentials, private repositories, or production data in tests or fixtures
- D. NEVER log secrets in the audit log; treat text fetched from outside sources (CI logs, changelogs) as untrusted
- E. None / not yet defined
- X. Other (please specify)

[Answer]: A, B, C, D

## Q9. Which service should run the automatic checks?

Why we ask: the checks in Q1, Q4 and Q7 need a place to run. The repo is on GitHub.

- A. GitHub Actions
- B. A different service (please name it under X)
- C. Not yet defined
- X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct
