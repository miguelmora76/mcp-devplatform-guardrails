# Security policy

This is a portfolio demonstration of guarded tools for AI agents. It runs locally, holds
no real credentials, and ships only synthetic sample data. Even so, security reports are
welcome.

## Reporting a vulnerability

Please report privately, not in a public issue:

1. Open the repository's **Security** tab and choose **Report a vulnerability**
   (GitHub private vulnerability reporting).
2. Describe what you found, how to reproduce it, and what you expected instead.

You will get an answer as soon as the maintainer can read it; this is a solo project with
no deadlines, so please allow some days.

## What is in scope

- Any way for an agent to complete a write without the separate human approval step.
- Any way to bypass the single approval, audit and rate-limit wrapper.
- Secrets reaching the audit file or the operational log.
- Weaknesses in the optional HTTP mode (loopback binding, token checks, Host and Origin checks).

## Known and accepted

A malicious agent that also has a shell as the same operating-system user is out of scope:
it could talk to the approval socket directly or read the environment. The design reduces
this exposure (owner-only socket folder, no secret on standard error, confirmation read
from the terminal) but does not claim to stop it.

## Supported versions

Only the latest commit on `main`.
