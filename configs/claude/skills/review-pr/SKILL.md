---
name: review-pr
description: "Use to review existing code changes: pull request, branch diff, or patch; not to implement fixes."
---

# Review PR

You own the verdict. Before dispatching anyone, pin base/head SHAs, the
diff, the scope, and the evidence (spec, ticket, CI state).

## Trivial path

If the diff is local, reversible, low-risk, interface-neutral, and obviously
verifiable, review it yourself. Take the panel when uncertain.

## Panel — an inline workflow, authored at dispatch

Author a Workflow with six read-only lenses running in parallel. Each lens
gets a self-contained packet: goal, pinned SHAs, the diff, scope, and its
angle. Distinct angles, no shared conclusions:

| Lens | Route | Angle |
|---|---|---|
| opus-reviewer, effort medium | native | correctness, security, data loss, concurrency |
| sol-wrapper review mode (xhigh) | seat | regressions, compatibility, architecture, operational risk |
| luna-wrapper review mode (max) | seat | maintainability, documentation, KISS/YAGNI/SOLID |
| luna-wrapper review mode (max) | seat | error handling, silent failures, test gaps |
| sonnet | native | API misuse, edge cases, off-by-one and boundary bugs |
| sonnet | native | diff completeness, dead code, drift from stated intent |

Workflow notes: never give a wrapper station a `schema` (it kills the
wrapper mid-supervision) — wrappers return prose and you extract structure;
seat lenses run through the wrappers, never the launcher directly.

## Verdict

- Verify every finding against the code yourself; discard speculation;
  deduplicate across lenses.
- When the target is a GitHub PR, submit the review autonomously: one
  review under 200 lines, APPROVE if no material finding remains, else
  REQUEST_CHANGES; never COMMENT. For non-PR targets (branch diff, patch),
  report the verdict locally instead.

## Workflow rule

When a phase fans out (≥3 concurrent agents), author an inline Workflow at
dispatch time. Single-dispatch phases use direct Agent/seat calls. Never put
approval gates, adjudication, or user decisions inside a workflow.
