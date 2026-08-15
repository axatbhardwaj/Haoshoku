---
name: linear-ticketing
description: Use for creating, updating, or organizing Linear tickets and ticket trees.
---

# Linear Ticketing

You write Linear directly through the Linear MCP tools. Confirm intent,
destination (team/project), ownership, and write authority first; block if
Linear tools are unavailable.

## Draft

- Search duplicates and adjacent issues first; inspect candidate parents,
  blockers, downstream dependents, and repository evidence.
- Draft the smallest tree; split only independently assignable and
  independently verifiable deliverables; keep steps inside their owner.
- Ticket pointers: Problem, Outcome, Scope, Acceptance criteria,
  Verification, Dependencies. Omit empty sections.

## Review

- A trivial standalone ticket: write it yourself.
- Technical, ambiguous, dependency-heavy, or multi-ticket work: spawn
  `opus-reviewer` (read-only) with the draft tree and evidence to challenge
  duplication, scope, decomposition, acceptance criteria, blocker
  direction, and KISS/YAGNI. Verify its claims yourself.
- Preview every new multi-ticket tree to the user before writing. An
  explicit single-ticket request skips the extra preview after review.

## Write

- Create and update tickets with parent / blockedBy / blocks / related
  links; preserve unspecified fields; reread state after writing.
- After a partial mutation: stop, reread state, and report exactly what
  succeeded and what did not.

## Workflow rule

When a phase fans out (≥3 concurrent agents), author an inline Workflow at
dispatch time. Single-dispatch phases use direct Agent/seat calls. Never put
approval gates, adjudication, or user decisions inside a workflow. This
skill rarely triggers it.
