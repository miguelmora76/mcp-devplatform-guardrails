# Intent Statement

## Problem Statement

- The project's main purpose is to demonstrate safe-agent design as a portfolio piece; the developer-platform problem it addresses is secondary. [Q1]
- The deliverable is an MCP server in TypeScript that gives AI agents safe, auditable tools for a developer platform, covering repo dependency-upgrade planning and CI failure triage. [desc]
- The server includes guardrails: read-only by default, scoped write tools behind explicit approval, an audit log, and rate limits. [desc]

## Target Customer

- The intended audience is a mix of platform/DevOps engineers who would connect AI agents to their developer platform, application developers who would ask an agent to plan upgrades or triage CI failures, and reviewers or peers who read the project as a portfolio or reference example. [Q2]
- Pains this audience has today:
  - Manually planning dependency upgrades takes too long. [Q3]
  - Diagnosing CI failures is slow and repetitive. [Q3]
  - Giving AI agents write access to repos or pipelines feels too risky without approval and an audit trail. [Q3]
  - There is no clear example of guardrails (read-only default, approvals, audit log, rate limits) for agent tools. [Q3]
- The project uses only synthetic or public data. [desc]

## Success Metrics

| Outcome | Pass/fail check | Source |
|---------|-----------------|--------|
| Both tool areas work end to end | Upgrade planning and CI triage each run end to end against synthetic or public data | [Q4] |
| Writes require approval | Every write tool is refused unless explicit approval is given, and a test proves it | [Q4] |
| Audit log and rate limits work | Every tool call is recorded in the audit log, and rate limits demonstrably reject excess calls | [Q4] |
| README links the records | The README links the AI-DLC inception and construction records and lets a reader reproduce the results | [Q4] |

- The project also includes tests and a README that links the AI-DLC inception/construction records. [desc]

## Initiative Trigger

- The trigger is growing use of AI agents and MCP servers with developer tooling and a wish to show a safe approach, together with a goal of building a portfolio example of AI-DLC applied to a real design problem. [Q5]

## Initial Scope Signal

- Workflow-selected scope: `mcp-guardrails-portfolio` (workflow-selected). [scope]
- User-confirmed product boundary: the scope matches the intended boundary, an MCP server with the two tool areas and the guardrails named in the description. [Q8]

## Assumptions & Open Questions

None.
