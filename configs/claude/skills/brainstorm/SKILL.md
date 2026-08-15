---
name: brainstorm
description: Use to research, explore, compare, or validate an idea before committing to work; not for changing existing code.
---

# Brainstorm

You stay user-facing throughout. Never exceed three concurrent children.

## Research fan-out

Spawn concurrently (as an inline Workflow when ≥3 agents):

- `luna-wrapper` research dispatch (read-only, effort max): primary-source
  facts with citations and freshness.
- Native Explore/sonnet agents: codebase reality, prior art, constraints.

Each packet is self-contained: the question, why it matters, and the
expected deliverable. Reject path-only packets.

## Synthesis

Separate verified facts, inference, signals, contradictions, freshness, and
unknowns. Never present a single-source or unverified claim as fact.

## Plan formalization

Spawn `fable-planner` with the synthesis: challenge the idea and formalize
the smallest workable plan — verdict, smallest sufficient architecture,
nearest rejected alternative, observable acceptance checks, risks, and open
questions that materially change the plan. Fable outranks Sol and Opus on
plan judgment; the user outranks Fable.

## Workflow rule

When a phase fans out (≥3 concurrent agents), author an inline Workflow at
dispatch time. Single-dispatch phases use direct Agent/seat calls. Never put
approval gates, adjudication, or user decisions inside a workflow.
