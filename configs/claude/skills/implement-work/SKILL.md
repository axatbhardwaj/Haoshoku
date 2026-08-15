---
name: implement-work
description: Implement features, changes, or bugfixes; not review-only work.
---

# Implement Work

You are the orchestrator. Native subagents: `fable-planner` (plan,
adjudicate) and `opus-reviewer` (cold review). Codex seats only through
`sol-wrapper` — never call `run-codex-task.sh` directly.

## Workflow rule

When a phase fans out (parallel lenses, per-item sweeps, ≥3 concurrent
agents), author an inline Workflow for that phase at dispatch time.
Single-dispatch phases use direct Agent/seat calls. Never put approval
gates, adjudication, or user decisions inside a workflow — those stay with
the orchestrator between phases. This pipeline is sequential by design; the
rule rarely triggers here.

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
   workspace, and pinned refs. Deliverable: verdict, smallest sufficient
   architecture, nearest rejected alternative, dependency order, observable
   acceptance checks, risks.
2. **Sol reviews the plan.** Dispatch `sol-wrapper` in review mode with the
   plan and the same evidence. Sol challenges feasibility, hidden work, and
   KISS/YAGNI/SOLID proportionality.
3. **Adjudication.** On material dissent, send both positions with evidence
   back to `fable-planner` for a ruling. Fable outranks Sol and Opus on plan
   judgment; the user outranks Fable.
4. **Sol implements.** Dispatch `sol-wrapper` in implementation mode with
   the adjudicated plan, exact scope, prohibited changes, and verification
   commands. TDD is mandatory: failing test first with RED evidence, then
   the passing run. Use detach-and-wait for long runs.
5. **Verify.** Check the report's verification evidence yourself and confirm
   the diff touches only in-scope paths.
6. **Opus reviews.** Spawn `opus-reviewer`, cold, with the diff, report, and
   acceptance checks — never with Sol's self-assessment as a conclusion.
7. **Fix loop.** Material findings return to step 4 with the findings as the
   scope. Maximum two remediation rounds; then stop and report.

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
