# Evidence

## Inspected (by participant)

- Lead: the five relevant sections of `aidlc/spaces/default/memory/org.md` (used as suggested defaults only); `team.md` (empty) and `project.md` (no stack or practice decisions, two Ideation corrections); the Ideation initiative brief and scope document; the repository root. Only `aidlc/` exists: no application code, CI config, formatter config, or lockfile. Git history has one commit, `f2ed7ac`.
- Quality: the draft against the scope's success measures. Proposed guardrail-first test thinking, refusal and rejection path coverage, no live network in tests, and "CI green then tag" instead of a deploy pipeline. Tool names are from general knowledge, not verified.
- Developer: the draft against the project description (TypeScript is stated). Proposed strict TypeScript, Prettier, ESLint, type-check, error handling for denials, and a single guardrail wrapper. Not verified against any repository config, since none exists.
- DevSecOps: the draft for security gaps. Proposed secret scanning, CodeQL, dependency updates and review, supply-chain hygiene, SECURITY.md, and branch protection. Free-tier terms and versions were not verified.

## Inferred

- Solo contributor with AI assistants, no deadlines, public repository, synthetic or public data only (initiative brief).
- The current branch `ideation-records` is consistent with short-lived branches, but one commit is too little history to confirm a practice.

## Interview decisions (all confirmed by the human)

- Q1: A. Short-lived branch and pull request with required automatic checks, even solo.
- Q2: A. Thin end-to-end walking skeleton first.
- Q3: C. Behaviour-style (Given/When/Then) tests written alongside the code. Recorded as Methodology bdd.
- Q4: X. 90% overall, plus 100% line and branch coverage on guardrail code.
- Q5: X. Local deployment with setup instructions in README.md. No hosted service.
- Q6: A. Strict TypeScript, Prettier, ESLint, type-check as automatic checks; normal TypeScript naming.
- Q7: A, B, C, D. Secret scanning with push protection plus a local scanner; CodeQL, dependency updates, new-dependency check; lockfile, pinned Actions, small dependency set; SECURITY.md with private vulnerability reporting.
- Q8: A, B, C, D. All four hard-rule groups, split into single-line ALWAYS and NEVER rules.
- Q9: A. GitHub Actions.
- Consolidated summary: Looks correct.

## Unresolved Uncertainty

- Exact tool versions (TypeScript, Prettier, ESLint, CodeQL, scanners, Actions) were not verified; they are chosen in Construction.
- The Construction Verification Command is not yet defined.
- The audit-failure policy (what happens when audit writing fails) and numeric thresholds (rate limits, timeouts) are deferred to Requirements Analysis.
- Repository security settings (secret scanning, push protection, private vulnerability reporting, branch protection) and the `.gitignore` state are unverified from the working tree.
- Package manager, Node version, and local secret scanner tool are not chosen.
- Contribution suggestions the human did not pick (for example branch protection details, adversarial tests, error-handling conventions) are not recorded as practices.
