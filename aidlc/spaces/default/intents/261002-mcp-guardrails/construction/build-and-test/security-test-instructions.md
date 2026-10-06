# Security Test Instructions

Scope: the security requirements and design (`../nfr-requirements/security-requirements.md`, `../nfr-design/security-design.md`). The server is a local process with no hosted service; there is no web application to scan with a DAST tool.

## Automated checks

| Check | Command | Expected |
|-------|---------|----------|
| Security behaviours in the unit and integration specs (approval, audit, redaction, injection, HTTP) | `npm run test:coverage` | All pass; 100% lines and branches on `src/guardrails/**` |
| Static analysis for types and lint | `npm run typecheck` and `npm run lint` | Exit 0 |
| Known vulnerabilities in runtime dependencies | `npm audit --omit=dev` | 0 vulnerabilities |
| Actions pinned to full commit SHAs | `grep -rn "uses:" .github \| grep -vE "@[0-9a-f]{40}"` | No output |
| Runtime dependency set | `node -e "console.log(Object.keys(require('./package.json').dependencies))"` | Only `@modelcontextprotocol/sdk` and `zod` |
| Secret scan | `gitleaks detect --source . --config .gitleaks.toml` | No findings (needs gitleaks installed; also runs in CI) |
| Static security analysis | CodeQL workflow `.github/workflows/codeql.yml` | Runs on GitHub on pull requests and the default branch |

## Behaviours that must stay covered by named tests

- Refused writes: missing, reused, expired, swapped-input and wrong-client approvals; unwritable audit file (`test/e2e/approval-flow.test.ts`, `test/guardrails/approval.test.ts`, `test/guardrails/wrapper.test.ts`).
- Exactly one call ID per call for allowed, refused, rate-limited and error outcomes.
- Rate-limit rejection: 30 reads and 3 writes per window per client.
- Prompt-injection text in a CI log (`run-1002`) and an advisory summary never causes a write.
- Redaction of tokens, keys and the configured token values in audit lines and logs; call IDs and digests survive.
- HTTP mode: missing and wrong tokens refused identically; foreign Host or Origin refused; failed-login queue bounded; body and connection limits.
- No tool, route or CLI can issue an approval except the separate `approve` command.

## Manual checks (not automatable here)

- Run `npm run approve` in a real terminal against a running server and confirm the request is listed with escaped inputs and its digest, and that nothing approves without typing `yes`.
- Confirm in the GitHub repository settings: secret scanning with push protection, private vulnerability reporting, required status checks on pull requests into the default branch.

## Out of scope

- A malicious agent that has a shell as the same operating-system user (accepted risk, see the security design).
- DAST and penetration testing: nothing is deployed.
