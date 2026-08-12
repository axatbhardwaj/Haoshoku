---
name: discovering-work
description: Use when a request needs discovery or intake before implementation, especially when scope, constraints, success criteria, ambiguity, external research, architecture, or approval boundaries must be made explicit.
---

# Discovering Work

## Overview

Produce one compact decision record before execution. Keep three decisions independent: local clarity determines planning, external uncertainty determines research, and consequence determines approval.

## Output contract

Return these fields in order:

1. **Goal** — requested outcome in one sentence.
2. **Constraints** — scope, prohibitions, authority, and relevant local state.
3. **Success checks** — observable proof of the outcome.
4. **Unknowns** — facts that could change the work; use `none` when empty.
5. **Local discovery** — repository or environment evidence needed first.
6. **External research needed** — `yes` or `no` with one reason. Use `yes` only for a load-bearing external, current, uncertain, or disputed fact. If `yes`, name questions for independent Codex and Grok research; researchers gather evidence and never decide.
7. **Designed work needed** — `yes` or `no` with one reason. Use `yes` while architecture, interfaces, data ownership, security boundaries, or cross-component dependencies remain open. A clear bounded edit stays `no` even when consequences are critical.
8. **Approval boundary** — `none` or the exact newly discovered action requiring approval. Existing explicit authorization carries through.
9. **Next route** — `Codex implementation → verification → Opus acceptance` or `Fable plan → Sol review → Fable corrections → fresh Codex review if Sol changed the plan → Opus Workflow execution`.

Mention implementation details only when they expose a user decision.

## Decision reference

| Question | Trigger | Effect |
| --- | --- | --- |
| Is the change locally clear and bounded? | Goal, behavior, and checks need no invented design. | Yes: Codex. No: Fable. |
| Is a load-bearing fact external or unstable? | Current docs, laws, versions, prices, APIs, or conflicting claims decide the work. | Yes: Codex and Grok research. |
| Is a new critical action outside authority? | Destruction, credentials, funds, trust, publication, shared infrastructure, schema, or migration. | Yes: stop at that boundary. |

## Example

Request: “Use the newest beta CLI flag; two snippets disagree.”

- **Goal:** Use the supported beta flag.
- **Constraints:** Preserve the installed version unless evidence requires an upgrade.
- **Success checks:** Official source, local `--help`, targeted test, representative invocation.
- **Unknowns:** Which flag applies to the installed version.
- **Local discovery:** Inspect the version and current invocation.
- **External research needed:** yes — current and disputed; Codex and Grok verify primary sources.
- **Designed work needed:** no — bounded compatibility edit unless evidence reveals a migration.
- **Approval boundary:** dependency upgrade, if required and unauthorized.
- **Next route:** Codex implementation → verification → Opus acceptance.

## Common mistakes

- Treating criticality as architecture complexity.
- Researching facts the repository can answer.
- Asking twice for an authorized action.
- Calling work straightforward before naming success checks.
- Expanding discovery into a speculative plan.
