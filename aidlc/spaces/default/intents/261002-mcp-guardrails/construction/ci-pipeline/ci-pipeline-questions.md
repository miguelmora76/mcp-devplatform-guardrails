# CI Pipeline — Questions

Context carried over (not re-asked): the CI tool is GitHub Actions on a public GitHub repository, with trunk-based work through short-lived branches and pull requests (`team.md`). The required checks are format, lint, type-check, tests with coverage, and security checks (CodeQL, dependency review, automatic dependency updates, secret scanning). The workflows already exist in `.github/` (written during Code Generation, actions pinned to full commit SHAs) and read the Node version from `.nvmrc` (Node 24). Deployment is local, so there is no deployment pipeline.

Build and Test found that GitHub does not yet match these rules: the remote has no `main` branch (its only branch is `ideation-records`), no branch protection, secret scanning and push protection are off, and private vulnerability reporting is off. The three questions below decide how the CI pipeline definition closes that gap. This stage only records the decisions; it changes nothing on GitHub. The first option in each is my recommendation.

## Q1. How should the trunk branch `main` be created on GitHub?

Why we ask: the team rules merge everything to `main` through pull requests, but the remote has only `ideation-records`, and the workflows trigger on pull requests into `main`.

- A. Create `main` on the remote from the current tip of `ideation-records` (which holds the AI-DLC records and, once committed, the code), make it the default branch, and open the first pull request from a short-lived branch into it
- B. Make `ideation-records` the default branch and treat it as the trunk, and change the workflows to trigger on it
- C. Create an empty `main`, so the first pull request carries all the project's files
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q2. How strict should the merge protection on `main` be for a solo build?

Why we ask: the team practice is a pull request with required automatic checks "even though we are a solo build with one reviewer", so the setting must not make you wait on an approval no one else can give.

- A. Require a pull request and passing status checks (format, lint, type-check, tests with coverage, gitleaks, CodeQL, dependency review), require the branch to be up to date, block force pushes and deletion, and require zero approving reviews
- B. The same as A, but also require one approving review (you could not merge your own pull request unless an administrator bypass is allowed)
- C. Require only the status checks, with no pull request requirement
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q3. Should the pipeline publish anything (package, container image, release)?

Why we ask: the project is a local demonstration server with no hosted service; this confirms the pipeline stops at "checks pass".

- A. No: the pipeline only runs checks; nothing is published to a registry, and there are no tagged releases in the first version
- B. Create a GitHub release with a tag for each version, without publishing a package
- C. Publish the package to a registry
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct
