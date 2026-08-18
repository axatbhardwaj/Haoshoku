---
name: implement-work
description: Implement features, changes, or bugfixes; not review-only work.
---

# Implement Work

You are the orchestrator. Native subagents: `fable-planner` (plan,
adjudicate) and `opus-reviewer` (cold review). Codex seats only through
`sol-high-wrapper` — never call `run-codex-task.sh` directly.

## Workflow rule

When a phase fans out (parallel lenses, per-item sweeps, ≥3 concurrent
agents), author an inline Workflow for that phase at dispatch time.
Single-dispatch phases use direct Agent/seat calls. Never put approval
gates, adjudication, or user decisions inside a workflow — those stay with
the orchestrator between phases. The pipeline is sequential by default;
the parallel fan-out below is where this rule can trigger.

## Trivial bypass — budgeted per request, not per edit

Handle directly only if the change is local, reversible, low-risk,
interface-neutral, small, unambiguous, and obviously verifiable. When
uncertain, take the pipeline.

The budget is cumulative across the whole request, not reset per edit.
Take the pipeline for the remainder of the request as soon as any of these
becomes true:

- bypassed edits have touched **3 or more files**;
- a **second related change** follows the first (a sequence of small edits
  serving one goal is one non-trivial change, not many trivial ones);
- a rename, move, or delete crosses a file boundary others reference;
- you are about to edit something an agent, launcher, or test resolves by
  path or digest.

Re-justifying triviality edit by edit is the failure mode this budget
exists to stop. Count what you have already done before claiming the next
edit is small.

## Pipeline

1. **Fable plans.** Spawn `fable-planner` with goal, constraints, absolute
   workspace, and pinned refs. The packet states that parallel
   decomposition is a requirement. Deliverable: verdict, smallest
   sufficient architecture, nearest rejected alternative, dependency
   order, observable acceptance checks, risks, and either parallel groups
   with per-task write scopes or the named reason parallelization is
   infeasible (see Parallel fan-out). A sequential plan with no stated
   reason goes back to Fable.
2. **Sol reviews the plan.** Dispatch `sol-medium-wrapper` in review mode with
   the plan and the same evidence. Sol challenges feasibility, hidden work, and
   KISS/YAGNI/SOLID proportionality. Medium is the right seat here: a plan
   critique writes no code and is reversible. Escalate to `sol-high-wrapper`
   only if the plan itself turns on an escalation trigger.
3. **Adjudication.** On material dissent, send both positions with evidence
   back to `fable-planner` for a ruling. Fable outranks Sol and Opus on plan
   judgment; the user outranks Fable.
4. **Sol implements.** Dispatch `sol-medium-wrapper` by default, or
   `sol-high-wrapper` when the task hits an escalation trigger (irreversible,
   unknown shape, handed back from medium, or cross-cutting — see CLAUDE.md
   §1). Pass the adjudicated plan, exact scope, prohibited changes, and
   verification commands. TDD is mandatory: failing test first with RED evidence, then
   the passing run. Use detach-and-wait for long runs. When the
   adjudicated plan marks a parallel group, use the parallel fan-out
   instead of a single dispatch.
5. **Verify.** Check the report's verification evidence yourself and confirm
   the diff touches only in-scope paths.
6. **Intermediate checks — Sol, not Opus.** On multi-phase requests, each
   intermediate dispatch is checked by `sol-medium-wrapper` in review mode
   against its exact scope and acceptance checks. This is same-model
   self-review and is acceptable only because step 7 stays cross-model and
   full-diff; Opus is never spent on per-dispatch deltas.
7. **One cold Opus review per request.** After the final dispatch, spawn
   `opus-reviewer`, cold, with the full base..HEAD diff, reports, and
   acceptance checks — never per-dispatch deltas alone, and never with
   Sol's self-assessment as a conclusion. Same rule the parallel fan-out
   uses for per-task diffs. Exactly one Opus pass per request.
8. **Fix loop.** Material findings return to step 4 with the findings as the
   scope. `sol-medium-wrapper` verifies each remediation against the
   specific findings it was sent to address; re-run Opus only if the fix
   was cross-cutting or architectural. Maximum two remediation rounds;
   then stop and report.

## Parallel fan-out — step 4 variant

Parallel execution is the default, not an option. A valid parallel group
is two or more tasks with no dependency edges between them and disjoint
write scopes, each substantial enough to justify worktree overhead.
Shared files (lockfiles, barrel/index files, generated code, shared
types) are assigned to exactly one task or the touching tasks serialize.

Sequential is the exception and must be earned: the plan names which
infeasibility applies — a hard dependency chain, scopes that cannot be
made disjoint, or tasks too small for the overhead. "Sequential is
simpler" is not a reason. The split always comes from the adjudicated
plan; never improvise one at dispatch time, and never accept a
manufactured split that fails the validity tests above.

1. **Fan out.** Create one temporary git worktree per task, each on its
   own branch off the same base SHA, named after the plan's task id. At
   two tasks, dispatch both `sol-high-wrapper`s directly in one message. At
   three or more, the Workflow rule triggers: author an inline Workflow
   at dispatch time from the plan's parallel groups — one `agent()` per
   task with `agentType: 'sol-high-wrapper'`, the task's worktree as its
   workspace, a schema forcing the structured report shape, and one
   phase per group. The workflow covers dispatch and per-task collection
   only; merge, adjudication, and the review gate never go inside it.
   Each wrapper's report, RED/GREEN evidence, and scope check are
   verified per task as in step 5, within the three-child cap per
   concurrent batch.
2. **Integrate.** The orchestrator merges the task branches into one
   integration branch in plan dependency order. A clean merge is
   orchestrator plumbing — no code is authored, so it does not breach
   "the orchestrator does not implement". Any conflict is evidence the
   write scopes were not disjoint: dispatch `sol-high-wrapper` with the
   conflict as its exact scope; never hand-resolve in the main thread.
   Opus never merges — a reviewer who performed the integration is no
   longer cold.
3. **Verify the union.** Green per-worktree runs do not prove the merged
   result works; cross-task interactions exist only after the merge. Run
   the verification commands once on the integration branch before
   review.
4. **One cold Opus review** of the integrated base..HEAD diff — never
   per-task diffs alone. If the combined diff is too large for one
   attentive pass, review per subsystem plus a final integration-seams
   pass. Map each finding back to the owning task's write scope; the fix
   loop re-dispatches per scope, in parallel again when findings are
   disjoint, with remediations verified by `sol-medium-wrapper` per
   pipeline step 8.
5. **Failure isolation.** A failed sibling never blocks the others. Its
   task is review debt: re-dispatch before integrating, or integrate the
   partial set and declare the gap to Opus.

Remove the temporary worktrees after integration.

## Rules

- At most three concurrent children.
- Task packets are self-contained: goal, evidence, constraints, deliverable.
  Reject path-only packets.
- A seat failure blocks its phase and is reported; never silently fall back
  to a native model for implementation.
- **Your own green test run is not the Opus gate.** Passing tests are an
  input to step 6, never a substitute for it. "Tests pass, done" skips the
  gate; a bare self-approval is not evidence.
- Completion evidence = Opus `pass` + Sol's report covering the exact
  base/HEAD. Downstream skills (create-pr) require it fresh.
