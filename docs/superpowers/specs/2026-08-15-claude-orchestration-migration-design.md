# Claude Orchestration Migration — Design

Date: 2026-08-15
Status: approved design, pending implementation plan

## Context and goal

Seven orchestration skills currently live in `~/.codex/skills/` and run with
Codex (Sol, gpt-5.6) as the chair, reaching Claude models through an elaborate
bridge (`run-claude-seat.sh`, PTY framing, model receipts, MCP section
publishing into a shared HTML workflow artifact). This migration flips the
topology: **Claude Code hosts and orchestrates; Codex models become external
seats.** Codex stays installed (UI moves to t3-code), but Claude Code is the
sole orchestrator.

Haoshoku's role is **backup/restore only**: it copies skills, agents,
workflows, and CLAUDE.md into `~/.claude/` via the `configure_claude.js` file
manifest. No runtime config layer, no templating.

## Topology and roles

| Role | Runs as | Model / effort |
|---|---|---|
| Orchestrator | Claude Code session | Opus 5 |
| Planning + adjudication | native Agent subagent | Fable (highest authority on plan/review judgment) |
| Code review | native Agent subagent | Opus |
| Panel breadth lenses, exploration | native Agent subagent | Sonnet |
| Implementation, plan review | Codex seat via `run-codex-task.sh` | Sol — implementation high/xhigh, review xhigh |
| Docs, HTML, mechanical/syntactic work, scouting | Codex seat via `run-codex-task.sh` | Luna — always max |

The core pipeline (implement-work): **Fable plans → Sol reviews the plan →
Fable adjudicates dissent → Sol implements the whole work → Opus reviews
before submission.**

`run-codex-task.sh` is **not modified**. Sol review runs stock review mode at
xhigh; the medium/high opt-down was considered and rejected to keep scope
down. Grok is dropped from the skill flows (Luna-at-max absorbs research);
`grok-wrapper.md` and its launcher stay deployed but unused.

## Not migrated (deleted concepts)

The entire Codex→Claude bridge dies: `run-claude-seat.sh` seat protocol, PTY
framing and `seat-stdin-ready`, model-receipt envelopes, `fork_turns`, the
transient-retry taxonomy prose, MCP `publish_*_section` choreography, and the
`agent-html-publisher.py` shared HTML workflow artifact. Native subagents
return results directly; the codex launcher's `report.json` is the receipt on
the seat side. `~/.codex/skills/` is left untouched.

## Dynamic workflow rule (inherent, conditional)

Every skill carries this shared boilerplate (2–3 lines):

> When a phase fans out — parallel lenses, per-item sweeps, anything ≥3
> concurrent agents — author an inline Workflow for that phase at dispatch
> time. Single-dispatch phases use direct Agent/seat calls. Never put
> approval gates, adjudication, or user decisions inside a workflow — those
> stay with the orchestrator between phases.

Consequences: review-pr's panel is always a dynamically authored workflow;
implement-work's chain never is (judgment between every link); brainstorm's
research fan-out qualifies; linear-ticketing and html-explainer rarely
trigger the rule. The static workflows `pr-review.js` and `review-station.js`
are **retired** — the panel spec lives in the skill, authored fresh per run.

## The skills

All live in `configs/claude/skills/<name>/SKILL.md`, deployed to
`~/.claude/skills/`. **Hard cap: 150 lines per SKILL.md.**

### implement-work
- Trivial bypass kept: local/reversible/low-risk/interface-neutral/small/
  unambiguous → orchestrator handles directly.
- Non-trivial: Fable (native) produces smallest-sufficient plan → Sol reviews
  the plan (`--mode review`, xhigh) → material dissent adjudicated by Fable →
  Sol implements the whole work (`--mode implementation`, TDD, detach+wait
  for long runs) → Opus (native) cold-reviews the diff + report → material
  findings loop back through Sol (bounded rounds) → done.
- KISS/YAGNI/SOLID retained as review criteria.

### review-pr
- Orchestrator pins base/head, diff, scope; owns the verdict.
- Panel authored as an inline workflow, six lenses with distinct angles:
  Opus (native, medium effort), Sol (seat, review mode xhigh),
  2× Luna (seat, max), 2× Sonnet (native).
- Orchestrator verifies findings against code, discards speculation, dedupes.
- GitHub PR targets: submit the review autonomously — APPROVE if no
  material finding remains, else REQUEST_CHANGES; never COMMENT. Non-PR
  targets get a local verdict report.

### create-pr
- Gates: confirmed scope/base/repo, explicit GitHub write authorization,
  fresh implement-work evidence covering exact base/HEAD.
- Size via `git diff --numstat` excluding binaries/generated/vendored/
  lockfiles; ≤1,500 LOC → `gh pr create --draft`; above → official
  `github/gh-stack`, bottom-to-top, each layer ≤1,500 LOC and independently
  reviewable; `submit --auto`.
- Luna (seat, max) writes per-layer PR copy (Summary/Why/Changes/
  Verification/Risks); orchestrator verifies claims, creates drafts, rereads
  GitHub state. Merging out of scope.

### brainstorm
- Grill first: frontier-round design-tree interview (adapted from
  mattpocock/skills `grilling`, MIT) — numbered questions with recommended
  answers; facts fetched by sub-agents, decisions put to the user; done
  when the frontier is empty.
- Research fan-out (inline workflow when ≥3 agents): Luna (seat, research
  mode, max) for primary-source facts + native Explore/Sonnet agents for
  codebase and breadth. No Grok.
- Separate verified facts / inference / signals / contradictions / unknowns.
- Cross-model validation: Fable (native) formalizes the smallest workable
  plan → Sol (seat, review mode) checks it cold → Fable adjudicates
  material dissent.

### babysit-pr
- Long-lived orchestrator loop via `/loop` (self-paced wakeups); push
  authority granted once, explicitly, at skill start.
- Watch tick: `gh` for CI, review threads, head SHA. Exactly one fix cycle in
  flight; events queue behind it.
- Fix cycle (sequential; workflows explicitly forbidden here):
  1. Pin remote head SHA.
  2. Classify (trivial vs non-trivial).
  3. Sol implements in the PR worktree (`--mode implementation`,
     `--detach` + `--wait`).
  4. Orchestrator verifies `report.json` evidence and diff scope.
  5. Opus (native) cold-reviews; one bounded remediation round; second
     failure → stop and notify, never push.
  6. Push gate: remote head must still equal pinned SHA (else discard and
     restart against new head); never force-push; push, reread GitHub,
     report the SHA.
- Single-mutator invariant: only the fix cycle commits/pushes; all review
  agents read-only. The Opus gate is structural — push is unreachable except
  through a passing review.
- Stop: merged (success), closed unmerged, two consecutive failed cycles, or
  head-churn indicating a human is working — each ends with a notification.

### linear-ticketing
- Orchestrator writes Linear directly via the Linear MCP; confirm intent,
  destination, write authority; search duplicates/adjacent issues first.
- Smallest tree; split only independently assignable/verifiable deliverables;
  pointers: Problem, Outcome, Scope, Acceptance criteria, Verification,
  Dependencies (omit empty).
- Trivial standalone ticket: orchestrator handles. Technical/ambiguous/
  multi-ticket: Opus (native) reviews the draft tree first; preview
  multi-ticket trees to the user before writing.
- After partial mutation: stop, reread state, report exactly what succeeded.

### html-explainer
- Content = `samvada-html-deliverables` (design system: output contract,
  `:root` tokens verbatim, SVG figure rules, mistakes table, `template.html`),
  renamed; `create-html-explainer` is retired (it was pure Codex delegation
  choreography).
- Luna (seat, implementation mode, max) authors the HTML; orchestrator
  validates: metadata JSON, offline/self-contained, desktop+mobile,
  reduced-motion, foot stamp.

## Agents

`configs/claude/agents/` — deployed to `~/.claude/agents/`:
- **Kept**: `sol-wrapper.md`, `luna-wrapper.md`, `grok-wrapper.md`,
  `run-codex-task.sh`, `validate-codex-wrapper.sh`,
  `codex-result.schema.json`, `madhyastha.md`, `anveshaka.md`. Skills reach
  Codex seats only through the wrappers, never the launcher directly.
  One amendment: `sol-wrapper.md` and `luna-wrapper.md` frontmatter effort
  rises `low` → `medium` (verification judgment: report-vs-workspace checks,
  failure classification); `grok-wrapper.md` stays at `low`.
- **Added**: `fable-planner.md` (model: fable — planning/adjudication prompt)
  and `opus-reviewer.md` (model: opus — cold-review prompt), so skills
  reference stable agents instead of repeating prompts.
- **Removed from manifest**: `workflows/pr-review.js`,
  `workflows/review-station.js` (retired with the static-workflow approach).
  `prepare-pr-review-render-workspace.sh` is **kept**: luna-wrapper's
  implementation mode is built around its staged-write mechanism (Luna
  writes to a temp workspace; the caller publishes verified bytes to the
  declared destination), which html-explainer and create-pr depend on.

## Haoshoku integration

`src/helpers/configure_claude.js`: extend the copy manifest with the seven
skill directories and two new agent files; rename the
`samvada-html-deliverables` entries to `html-explainer`; drop the retired
workflow/render-workspace entries. Update `tests/configure_claude.test.js`
to match. No other Haoshoku changes.

## Acceptance checks

1. `haoshoku` deploy (or the configure_claude path) places all seven skills
   and both new agents under `~/.claude/`; retired files are not deployed.
2. Every SKILL.md ≤150 lines; frontmatter name/description valid.
3. `bun test` passes, including the updated configure_claude manifest test.
4. Dry runs: implement-work on a toy change exercises Fable→Sol→Opus;
   review-pr on a small PR authors a six-lens inline workflow; html-explainer
   produces a valid offline page from the template.
5. babysit-pr dry run against a test PR: fix cycle pushes only after Opus
   pass and head re-pin; stop conditions fire.

## Risks and notes

- Sol/Luna seat availability depends on Codex CLI auth remaining valid;
  seat failure blocks the affected phase (no silent fallback to native
  models — surfaced to the user instead).
- Dynamically authored panel workflows trade per-run variability for zero
  static-file maintenance; the panel composition in the skill text is the
  contract, and the workflow journal is the debugging surface.
- `~/.claude/skills/` currently only contains the omarchy symlink, so no
  collision handling is needed on first deploy.
