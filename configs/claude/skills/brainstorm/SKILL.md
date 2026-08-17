---
name: brainstorm
description: Research, compare, or validate an idea; any grill request.
---

# Brainstorm

You stay user-facing throughout. Never exceed three concurrent children.

## Grill first

Interview the user relentlessly until you reach a shared understanding.
(Technique adapted from mattpocock/skills `grilling`, MIT.)

- Map the idea as a **design tree**: every decision branches into the
  decisions that hang off it.
- Work in **rounds**. The **frontier** is every decision whose
  prerequisites are already settled — the questions you can ask now
  without guessing at unheard answers. Ask the whole frontier in one
  round, interactively, via `AskUserQuestion`: put your recommended
  answer first with `(Recommended)` in the label, and give each real
  alternative its own option. The tool caps a call at four questions, so
  a wider frontier is several back-to-back calls in the same round —
  keep calling until the round is covered, then wait.
- Only drop to prose for a question that genuinely has no option set —
  open-ended naming, a number, a free-form constraint. Then number it and
  give your recommended answer:

  ```
  ❓ **Q1** — **<question title>**: <body, choices welcome>

  ➡️ <your recommended answer>
  ```

- A question whose answer depends on another still-open question belongs
  to a later round. Each answered round reshapes the tree; recompute the
  frontier and ask the next round.
- Facts are your job, never the user's: when a frontier question needs a
  fact from the environment, dispatch a sub-agent or start the research
  fan-out below instead of asking — only downstream questions wait on it.
- Grilling is done when the frontier is empty: every branch visited,
  nothing left silently assumed.

## Research fan-out

Spawn concurrently (as an inline Workflow when ≥3 agents):

- `luna-max-wrapper` research dispatch (read-only, effort max): primary-source
  facts with citations and freshness.
- Native Explore/sonnet agents: codebase reality, prior art, constraints.

Each packet is self-contained: the question, why it matters, and the
expected deliverable. Reject path-only packets.

## Synthesis

Separate verified facts, inference, signals, contradictions, freshness, and
unknowns. Never present a single-source or unverified claim as fact.

## Cross-model validation

1. Spawn `fable-planner` with the grilled decisions and the synthesis:
   challenge the idea and formalize the smallest workable plan — verdict,
   smallest sufficient architecture, nearest rejected alternative,
   observable acceptance checks, risks, and open questions that materially
   change the plan.
2. Dispatch `sol-high-wrapper` in review mode, cold, with the formalized plan
   and the same evidence — an independent check by a different model
   family.
3. Material dissent returns to `fable-planner` for adjudication. Fable
   outranks Sol and Opus on plan judgment; the user outranks Fable.

## Workflow rule

When a phase fans out (≥3 concurrent agents), author an inline Workflow at
dispatch time. Single-dispatch phases use direct Agent/seat calls. Never put
approval gates, adjudication, or user decisions inside a workflow — the
grilling rounds and final plan acceptance stay with you and the user.
