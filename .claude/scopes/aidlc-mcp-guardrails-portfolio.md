---
name: mcp-guardrails-portfolio
depth: Standard
keywords: []
description: Greenfield solo MCP server build with guardrails, tests and CI
guard_policy: strict
---

# mcp-guardrails-portfolio scope

Composed plan for a greenfield, solo portfolio build: an MCP server with
read-only-by-default tools, approval-gated writes, an audit log and rate
limits. Intent and scope are captured, requirements and non-functional
design are written, then code is generated, built, tested and wired into CI.

Guard Policy is strict: any input that changes after approval reopens the
plan for re-approval.

## Membership

Executes initialization, intent-capture, scope-definition, approval-handoff,
practices-discovery, requirements-analysis, nfr-requirements, nfr-design,
code-generation, build-and-test and ci-pipeline. Everything else is SKIP:
no UI, no deployment, no multi-unit decomposition, no production operations.
