# Intent Capture & Framing — Questions

## Sources

- [desc] Initial description: "Build an MCP server in TypeScript that gives AI agents safe, auditable tools for a developer platform: repo dependency-upgrade planning and CI failure triage. Include guardrails (read-only by default, scoped write tools behind explicit approval, audit log, rate limits), tests, and a README that links the AI-DLC inception/construction records. Use only synthetic or public data."
- [scope] Workflow-selected scope: `mcp-guardrails-portfolio`.

Fill in each `[Answer]:` tag with a letter (A-E, or X for your own wording). Every question has a "not defined / not applicable" option, so you never have to invent detail.

## Q1. What problem is this project mainly meant to solve?

Why we ask: the description names the tools (dependency-upgrade planning, CI failure triage) and the guardrails, but not which problem matters most. The answer sets the problem statement.

- A. Developers lose time on dependency upgrades and CI failures, and AI agents could help but are not safe to give access to a developer platform
- B. Teams have no trustworthy, auditable way to let AI agents act on repos and pipelines
- C. Both A and B equally
- D. The main goal is to demonstrate safe-agent design (a portfolio piece), and the problem is secondary
- E. Not yet defined
- X. Other (please specify)

[Answer]: D

## Q2. Who is the intended user or audience of the finished MCP server?

Why we ask: this decides whose pain the intent statement describes. The description says to use only synthetic or public data, so there may be no real production users.

- A. Platform or DevOps engineers who would connect AI agents to their developer platform
- B. Application developers who would ask an AI agent to plan upgrades or triage CI failures
- C. Reviewers, hiring managers or peers who will read the project as a portfolio or reference example
- D. A mix of A, B and C
- E. Not yet defined
- X. Other (please specify)

[Answer]: D

## Q3. What pain does that audience have today?

Why we ask: success metrics are easier to set once the pain is stated in the user's own words. Pick all that apply (select all that apply).

- A. Manually reading changelogs and planning dependency upgrades takes too long
- B. Diagnosing CI failures is slow and repetitive
- C. Giving AI agents write access to repos or pipelines feels too risky without approval and an audit trail
- D. There is no clear example of guardrails (read-only default, approvals, audit log, rate limits) for agent tools
- E. Not yet defined
- X. Other (please specify)

[Answer]: A, B, C, D

## Q4. What does success look like for this project?

Why we ask: the description asks for tests and a README linking the AI-DLC records. We need to know which measurable outcomes you consider the finish line. Pick all that apply (select all that apply).

- A. Both tool areas (upgrade planning, CI triage) work end to end against synthetic or public data
- B. Every write tool is refused unless an explicit approval is given, and a test proves it
- C. Every tool call is recorded in an audit log, and rate limits demonstrably reject excess calls
- D. The README links the AI-DLC inception and construction records and lets a reader reproduce the results
- E. Not yet defined (no measurable targets chosen yet)
- X. Other (please specify, including any numeric targets such as test coverage)

[Answer]: A, B, C, D

## Q5. What triggered this initiative?

Why we ask: the "why now" goes into the intent statement.

- A. Growing use of AI agents and MCP servers with developer tooling, and a wish to show a safe approach
- B. A personal or team goal to build a portfolio example of AI-DLC applied to a real design problem
- C. A specific internal need or deadline
- D. Both A and B
- E. Not identified
- X. Other (please specify)

[Answer]: D

## Q6. Who are the stakeholders, and what does each care about most?

Why we ask: the stakeholder map must list only people and roles you confirm. Pick all that apply (select all that apply).

- A. You as the owner and builder (delivery, quality of the finished project)
- B. Future users or operators of the MCP server (safety, clarity, auditability)
- C. Reviewers or readers of the README and AI-DLC records (traceability, reproducibility)
- D. Security or compliance reviewers (guardrails, audit evidence)
- E. None beyond me / not identified
- X. Other (please specify roles and what they care about)

[Answer]: A, B, C, D

## Q7. Who decides scope and priority, and who only influences it?

Why we ask: the stakeholder map separates decision-makers from influencers.

- A. I decide everything; others only give feedback if I ask
- B. I decide, with specific named reviewers who influence priorities
- C. A team or committee decides
- D. Not yet defined
- X. Other (please specify)

[Answer]: A

## Q8. Does the workflow-selected scope match the product boundary you intend?

Why we ask: this workflow was started with the scope `mcp-guardrails-portfolio`, which runs a short plan (intent, scope definition, handoff, practices, requirements, then build and test). It is the process size, not necessarily your product boundary, so confirming it is separate from defining the boundary.

- A. Yes, confirm the workflow-selected scope: it matches what I want to build (an MCP server with the two tool areas and the guardrails named in the description)
- B. The boundary is different: it should be smaller (for example, one tool area first)
- C. The boundary is different: it should be larger (for example, more tool areas or deployment)
- D. Not yet defined: decide the boundary in Scope Definition
- X. Other (please specify the product boundary)

[Answer]: A


## Q9. Are there communication requirements or a reporting cadence? (follow-up)

Why we ask: the stakeholder map needs to say how and how often stakeholders hear about progress. You named yourself as the sole decision-maker (Q7) and several reader/reviewer audiences (Q6), but nothing about communication.

- A. None: no reporting cadence; the README and AI-DLC records are the only communication
- B. Updates at each AI-DLC approval gate only
- C. A regular cadence (for example weekly), to be defined later
- D. Not yet defined
- X. Other (please specify)

[Answer]: A


## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct
