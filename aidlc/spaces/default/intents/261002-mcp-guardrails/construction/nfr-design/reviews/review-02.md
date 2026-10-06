## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-05T21:57:41Z
**Iteration:** 2

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/security-design.md > Approval design, Rules | Revised: no approval code exists; stderr carries only "approval pending: tool, client, ref requestId" (non-secret). A grep of all design files finds no remaining code-on-stderr text except the historical Q1 option wording in nfr-design-questions.md. | None. | Resolved |
| R-02 | Major | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/security-design.md > Approval design, Trust model | Revised: the trust model states that a same-user shell agent is out of scope, repeated in logical-components.md (blast radius) and in the threat table as an accepted risk. The /dev/tty confirmation is kept and the wrong-code limiter is gone. The residual exposure is honest and consistent. | None. | Resolved |
| R-03 | Major | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/security-design.md > Admin socket (LC-08) | Revised: 0700 directory with owner, mode and symlink checks, `<pid>.sock`, discovery, stale cleanup and multi-server listing. reliability-design.md (failure table and shutdown) and logical-components.md agree. | None. | Resolved |
| R-04 | Major | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/security-design.md > HTTP mode, Failed-login throttle | Revised: serialised 200 ms failed-login queue capped at 20, no per-source table, valid tokens never wait, `http.conn_limit` event present in observability-design.md. scalability-design.md and logical-components.md match. No per-connection throttle text remains in the design files. The change to the approved NFR1.16 wording is flagged for the user at the gate. | None beyond the user's agreement at the gate. | Resolved |
| R-05 | Major | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/security-design.md > Secrets and redaction | Revised: fixed ID shapes, a skip rule for them, exact configured tokens redacted, and tests. See R-12 for a tightening of the skip rule. | See R-12. | Resolved |
| R-06 | Minor | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/reliability-design.md > Audit file safety | Revised: the queue continues after a failure, and verify-and-claim is synchronous with the claim released on a failed intent write. The atomic stale-lock replacement claim is not actually atomic; see R-13. | See R-13. | Resolved |
| R-07 | Minor | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/reliability-design.md > Durability | Revised: tagged assumption with the macOS fsync caveat. | None. | Resolved |
| R-08 | Minor | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/scalability-design.md > Audit growth | Revised: 180 lines a minute, about 11 MB an hour, first approval_required call counted against the write limit, and growth under a flood bounded by the 100 MiB cap. | None. | Resolved |
| R-09 | Minor | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/security-design.md > Approval display | Revised: escaping, digest shown, and control characters rejected by the validator (also recorded as a clarification of NFR1.1). | None. | Resolved |
| R-10 | Minor | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/reliability-design.md > Failure handling table | Revised: refusal behaviour with an unwritable audit file, plus a documented recovery step. | None. | Resolved |
| R-11 | Minor | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/logical-components.md > Test seams and quality gates | Revised: LC-08 is in the 100% line and branch list. | None. | Resolved |
| R-12 | Minor | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/security-design.md > Secrets and redaction, second bullet | The skip rule reads "the run rule skips text carrying those prefixes". Read literally, a secret written as `call_` followed by 40 or more characters, or any run containing `sha256:`, escapes rule (b). The shapes are fixed (prefix plus exactly 26 base32 characters, or exactly 12 hex), so the skip can be anchored. | State that the skip applies only to a full-token match of `call_`/`req_` plus exactly 26 base32 characters, or `sha256:` plus exactly 12 hex characters, with word boundaries. Add a test that `call_` followed by a 50-character secret-like run is redacted. | New |
| R-13 | Minor | aidlc/spaces/default/intents/261002-mcp-guardrails/construction/nfr-design/reliability-design.md > Audit file safety, Lock | The claim "two processes starting at once cannot both win" does not hold. Re-reading the old content and then renaming a temporary file over the lock is a check followed by an unconditional replace. Two starters can both pass the check and both rename, and each believes it holds the lock. The consequence is limited (append-mode lines stay whole) but the stated guarantee is false. | Reword the stale-lock takeover so that only one process can win. For example, rename the stale lock to a unique name (only one rename can succeed because the source then disappears), then do the exclusive create. Or soften the claim and accept the race as a documented assumption. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| NFR ID coverage check (all NFR IDs found in ../nfr-requirements/*.md against traceability.json) | 54 IDs found, 0 missing | All 54 NFR IDs remain covered. |
| Stale-text grep (approval code, wrong-code, per-connection, per-source, stderr, throttle) | Design files are clean | The only leftovers are the historical Q1 option wording (nfr-design-questions.md) and a stage bookkeeping line (memory.md), which are not design contradictions. |

### Summary

All eleven prior findings are resolved, and the revisions are consistent across the security, reliability, scalability, observability and logical-components files. The 54 NFR IDs remain covered, and no stale approval-code or per-connection throttle text contradicts the design. Two new Minor items (R-12, R-13) tighten the redactor skip rule and the stale-lock claim. They do not block. The proposed change to the approved NFR1.16 wording still needs the user's agreement at the gate.
