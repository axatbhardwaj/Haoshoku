---
name: paseo-pr-review
description: Use when the user requests a six-angle PR review through Paseo, or a substantial high-risk peer PR needs justified distinct review coverage.
---

# Paseo PR review

Ordinary peer PR review uses `review-code`. Use this six-angle workflow when the user explicitly selected this skill or requested six angles, or when substantial high-risk work needs genuinely distinct coverage; document the distinct coverage upfront. The main conversation then drives six independent reviews of one immutable PR revision, validates the evidence and consolidates it. Use `paseo` for session mechanics and `model-routing` for capability checks and recovery. An explicit request for `code-review` retains its opt-in two-axis subagent method.

## Review seats

| Angle | Paseo profile | Focus |
| --- | --- | --- |
| Security and trust boundaries | `pr-security` | Authorization, validation, secrets, abuse paths |
| Correctness and failure paths | `pr-correctness` | Logic, edge cases, races, retries, partial failures |
| Integration and regressions | `pr-integration` | Callers, contracts, compatibility, migrations, test gaps |
| Requirements and user behavior | `pr-requirements` | Acceptance criteria, missing behavior, confusing scenarios |
| Architecture and maintainability | `pr-architecture` | Boundaries, abstractions, coupling, repository conventions |
| Complexity and simplicity | `pr-complexity` | Apply the shared [simplicity checklist](../model-routing/references/simplicity-review.md) |

Exact model, effort and mode settings live in Paseo profiles. Resolve the six selected profiles once per unchanged task context, retain only their selected capability fields, and validate the required reviewer capabilities before costly work. Cache that discovery and verified workspace ownership; refresh on configuration, host, model or mode change, ambiguous launch, or capability error. Missing capability is an explicit blocked seat. Report a known quota outage from existing evidence without repeating the same probe or silently substituting. Ready seats may proceed independently. A listed model is not proof of successful authentication or execution.

## Prepare and dispatch

1. Resolve the PR URL, repository, number, current head SHA, target base SHA and merge-base. Fetch those objects and verify the checkout HEAD matches the recorded head. For stacked PRs use the actual PR target and inspect the gh stack so ancestor changes are not accidentally attributed to this PR.
2. Read the PR description, linked issue/spec and applicable repository instructions and standards. Give every seat a compact source-linked brief with the same source snapshot and diff range; for later rounds send changed evidence instead of transcript copies. If intent is missing or contradictory, surface the gap to the user; other angles may proceed while requirements coverage remains incomplete. If the user confirms there is no spec, explicitly bound that angle to the agreed PR intent and report the limitation.
3. Create separate checkouts pinned to the same head for the six seats. Use task-owned scratch paths for outputs and tests. Apply `model-routing`'s shared [workspace-placement reference](../model-routing/references/workspace-placement.md), resolve the existing project that owns the reviewed repository, and register every pre-created checkout with `paseo workspace create --project <project-id> --isolation local --path <checkout> --title <review-angle> --json`. A checkout is ready only when MCP `list_workspaces` reports `workspace.projectId == project-id`; otherwise the seat is blocked. Each brief includes PR identity, head/base/merge-base, diff command, source pointers, profile notes, assigned angle, checkout path and return contract below. Tests must run without modifying another seat's checkout.
4. Launch six Paseo agents independently with completion notifications using `paseo run --workspace <workspace-id> ...` or the equivalent `create_agent` call with that verified ID. The launch receipt must record the resolved project ID and returned workspace ID before the next seat starts. For pre-created review checkouts, the combined `paseo run --new-workspace ... --cwd ...` form is unsafe because it cannot carry project ownership; do not reuse it from an earlier handoff. Materialize the profile settings using `paseo`; record each angle's agent/workspace IDs and launch settings in one concise handoff artifact. Workers directly perform their assigned review: they do not invoke `code-review`, launch another team, edit product code or submit reviews. Keep initial findings private from other seats until all initial reports arrive. Report important cross-angle discoveries with their angle tags rather than discarding them.

## Return contract and synthesis

Each worker returns the reviewed SHAs, angle, inspected paths and scenarios, checks actually run and their results, limitations, and either findings or an explicit no-findings result. Every finding includes severity, file/line, concrete trigger, consequence, evidence and a suggested correction. Tag documented-standard and specification findings distinctly. Architecture preferences are suggestions unless supported by a concrete defect or documented rule. Lack of evidence is an uncertainty, not a finding.

Use repository severity definitions when present; otherwise use P0 critical, P1 high, P2 medium and P3 low, with suggestions separate. A seat may report no executable checks, with the reason; required checks blocked by its mode go to the driver for targeted validation. Read-only review is a task constraint, not a claim that every provider enforces a filesystem sandbox. Verify checkout cleanliness on return and investigate unexpected product changes before accepting the report.

The driver waits for all six reports or records the blocked seats. Validate actionable findings against the pinned code, merge duplicate root causes while retaining angle attribution, and resolve contradictions through focused follow-ups to the existing reviewers. Evidence determines the result; model votes do not. Targeted validation is synthesis, not a seventh complete review. Incomplete or failed seats cannot produce a clean overall verdict. On interruption, inspect the recorded Paseo sessions and resume existing agents before creating replacements.

Apply the shared [HUMAN_DECISION reference](../model-routing/references/human-decisions.md) when a proposed response would go beyond the accepted specification by changing a trust/security boundary, taking an irreversible action, or materially changing direction. Finish the technical review, keep the persistent owner, and hold `APPROVE` while pending. A relay receipt is not action authority; the driver revalidates it and the live revision.

For an explicit transient launch failure, inspect the recorded session and retry once; authentication or unsupported-capability errors block the seat immediately. Long-running agents are not failures: use completion notifications, and inspect liveness on a reported error or missed agreed deadline. If a focused follow-up leaves a material disagreement unresolved, the driver records the uncertainty and marks the result INCOMPLETE; advisory escalation uses `paseo-committee` when needed.

Deliver one report with PR identity and reviewed SHA, recommendation, severity-ordered findings, distinguishable Standards and Spec findings, six-angle coverage, validation and limitations. A recommendation is separate from CI/merge readiness. Refresh the PR head, base and checks before final delivery. If the candidate changed, reuse the same reviewers to inspect the exact delta plus affected coverage and obtain refreshed SHA receipts. Run a full six-angle re-review for substantive scope, base or behavior change, and whenever the user's explicit full or six-angle request requires it; otherwise retain unchanged coverage without redoing it.

Use COMPLETE, INCOMPLETE or STALE as the report's coverage status, separate from its recommendation. Reuse the same reviewer sessions for a changed candidate. Automatically refresh review once after revision movement under the rule above. If it moves again, return STALE with the reviewed and current SHAs and await a stable target instead of looping indefinitely. Never reuse approval without a refreshed SHA receipt.

## GitHub delivery

When the user asks for a PR review, automatically submit the consolidated GitHub review after synthesis, then return the review link and a concise summary in the conversation. This is the user's standing submission preference; no separate confirmation is needed. An explicit report-only, draft-only or do-not-submit instruction overrides this default. Merge needs its own authorization.

Immediately before submission, recheck head/base and bind the review to the reviewed head. Submit `APPROVE` when the completed review has no blocking findings, or `REQUEST_CHANGES` for validated blocking findings; include non-blocking findings and material limitations in the body, at most 399 lines and 7500 characters. If the body exceeds either cap, keep every finding and tighten prose rather than dropping findings; move long-form evidence to the conversation summary. If the PR moved, re-review first. Incomplete coverage alone is not a code defect: continue the missing work or report the blocker rather than inventing a change request or approval. If the user accepts an explicitly disclosed narrower review scope, assess completion within that scope and retain the exclusions in the submitted body.

Verify the resulting review ID, actor, state, commit and exact body. If a submission has an ambiguous outcome, inspect existing reviews before retrying so the same review is not posted twice.

Example invocation: `$paseo-pr-review https://github.com/OWNER/REPO/pull/123`
