# Claude Orchestration Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the seven `~/.codex/skills/` orchestration skills to Claude Code, with Opus 5 orchestrating, native Fable/Opus subagents, Sol/Luna Codex seats via the existing wrappers, and Haoshoku deploying everything as plain file copies.

**Architecture:** All artifacts live in `configs/claude/` in the Haoshoku repo and deploy through the `PERSONAL_FILES` manifest in `src/helpers/configure_claude.js` → `syncClaudeConfig()`. Skills reach Codex seats only through `sol-wrapper`/`luna-wrapper` subagents; native planning/review use two new thin agent definitions. Static workflows are retired in favor of dynamically authored inline workflows.

**Tech Stack:** Markdown skills/agents (Claude Code format), Bash, Bun + bun:test (Haoshoku).

**Spec:** `docs/superpowers/specs/2026-08-15-claude-orchestration-migration-design.md`

## Global Constraints

- Every `SKILL.md` is hard-capped at **150 lines** (enforced by test in Task 1).
- `run-codex-task.sh` is **not modified**. Sol review runs stock review mode at xhigh.
- Skills never call `run-codex-task.sh` directly — only through `sol-wrapper` / `luna-wrapper`.
- `~/.codex/skills/` is left untouched.
- Working directory for all tasks: `/home/xzat/dev/Haoshoku` (branch `stable`). The repo has unrelated uncommitted changes — `git add` only the files named in each task, never `git add -A`.
- All test runs: `bun test tests/configure_claude.test.js` from the repo root. Expected baseline before Task 1: all pass.

---

### Task 1: Manifest guard tests (bundle completeness + 150-line cap)

**Files:**
- Modify: `tests/configure_claude.test.js` (inside the existing `describe("PERSONAL_FILES manifest", ...)` block, after the last `it` in that block)

**Interfaces:**
- Produces: two tests that make every later task RED/GREEN-able — adding a manifest entry without its file fails; a SKILL.md over 150 lines fails.

- [ ] **Step 1: Add the two tests**

Inside `describe("PERSONAL_FILES manifest", () => { ... })` add:

```js
	it("every manifest entry exists in the real source bundle", () => {
		const configsDir = path.resolve(import.meta.dir, "..", "configs", "claude");
		for (const file of PERSONAL_FILES) {
			expect(
				fs.existsSync(path.join(configsDir, file.src)),
				`missing bundle file: ${file.src}`,
			).toBe(true);
		}
	});

	it("keeps every bundled SKILL.md within the 150-line hard cap", () => {
		const configsDir = path.resolve(import.meta.dir, "..", "configs", "claude");
		for (const file of PERSONAL_FILES) {
			if (!file.src.endsWith("SKILL.md")) continue;
			const lines = fs
				.readFileSync(path.join(configsDir, file.src), "utf-8")
				.trimEnd()
				.split("\n").length;
			expect(lines, `${file.src} exceeds 150 lines`).toBeLessThanOrEqual(150);
		}
	});
```

(`fs` and `path` are already imported at the top of the file.)

- [ ] **Step 2: Run tests — expect PASS** (current manifest files all exist and current SKILL.md files are under the cap)

Run: `bun test tests/configure_claude.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/configure_claude.test.js
git commit -m "test: guard PERSONAL_FILES bundle completeness and 150-line SKILL.md cap"
```

---

### Task 2: Rename samvada-html-deliverables → html-explainer

**Files:**
- Rename: `configs/claude/skills/samvada-html-deliverables/` → `configs/claude/skills/html-explainer/`
- Delete: `configs/claude/skills/html-explainer/agents/openai.yaml` (codex-format leftover; the codex-side copy in `configs/codex/skills/` is untouched)
- Modify: `configs/claude/skills/html-explainer/SKILL.md` (frontmatter + authorship section)
- Modify: `src/helpers/configure_claude.js` (manifest)

- [ ] **Step 1: Update manifest first (RED)**

In `PERSONAL_FILES`, replace:

```js
	{ src: "skills/samvada-html-deliverables/SKILL.md" },
	{ src: "skills/samvada-html-deliverables/agents/openai.yaml" },
	{ src: "skills/samvada-html-deliverables/template.html" },
```

with:

```js
	{ src: "skills/html-explainer/SKILL.md" },
	{ src: "skills/html-explainer/template.html" },
```

Run: `bun test tests/configure_claude.test.js`
Expected: FAIL — `missing bundle file: skills/html-explainer/SKILL.md`

- [ ] **Step 2: Move the directory and drop the codex agent file (GREEN)**

```bash
git mv configs/claude/skills/samvada-html-deliverables configs/claude/skills/html-explainer
git rm configs/claude/skills/html-explainer/agents/openai.yaml
rmdir configs/claude/skills/html-explainer/agents 2>/dev/null || true
```

- [ ] **Step 3: Edit SKILL.md frontmatter and add the authorship section**

Change the frontmatter to:

```yaml
---
name: html-explainer
description: Use when creating HTML files for human readers, including reports, explainers, specs, plans, reviews, audits, research write-ups, and status pages.
---
```

Change the H1 from `# Samvada HTML Deliverables` to `# HTML Explainer`. Then insert, immediately after the `## Overview` section:

```markdown
## Authorship

Dispatch `luna-wrapper` (implementation mode) to author the page; delegate
only the declared destination file and give it this skill's output contract
plus `template.html` as evidence. Validate the result yourself before
delivery: metadata JSON, fully self-contained offline page (no external
loads; citation links allowed), desktop and mobile widths, reduced-motion,
print, and the foot stamp.
```

The rest of the file (output contract, quick reference, SVG rules, minimal example, common mistakes) stays verbatim.

- [ ] **Step 4: Run tests — expect PASS**

Run: `bun test tests/configure_claude.test.js`
Expected: PASS (file exists again; ~85 lines, under cap).

- [ ] **Step 5: Commit**

```bash
git add -A configs/claude/skills/html-explainer configs/claude/skills/samvada-html-deliverables src/helpers/configure_claude.js
git commit -m "feat: rename samvada-html-deliverables skill to html-explainer with luna authorship"
```

---

### Task 3: Retire static workflows and the render-workspace script

**Files:**
- Delete: `configs/claude/workflows/pr-review.js`, `configs/claude/workflows/review-station.js`, `configs/claude/agents/prepare-pr-review-render-workspace.sh`
- Modify: `src/helpers/configure_claude.js` (manifest)

- [ ] **Step 1: Remove the three manifest entries**

Delete these lines from `PERSONAL_FILES`:

```js
	{ src: "agents/prepare-pr-review-render-workspace.sh" },
	{ src: "workflows/pr-review.js" },
	{ src: "workflows/review-station.js" },
```

- [ ] **Step 2: Delete the files**

```bash
git rm configs/claude/workflows/pr-review.js configs/claude/workflows/review-station.js configs/claude/agents/prepare-pr-review-render-workspace.sh
rmdir configs/claude/workflows 2>/dev/null || true
```

- [ ] **Step 3: Check for dangling references**

Run: `grep -rn "pr-review.js\|review-station\|prepare-pr-review" --exclude-dir=node_modules --exclude-dir=.git . | grep -v "docs/superpowers"`
Expected: no hits outside historical docs/specs. If a helper or test references them, remove that reference in the same commit.

- [ ] **Step 4: Run tests — expect PASS**

Run: `bun test tests/configure_claude.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A configs/claude/workflows configs/claude/agents/prepare-pr-review-render-workspace.sh src/helpers/configure_claude.js
git commit -m "feat: retire static pr-review workflows in favor of inline-authored panels"
```

---

### Task 4: Raise sol-wrapper and luna-wrapper effort to medium

**Files:**
- Modify: `configs/claude/agents/sol-wrapper.md` (frontmatter line `effort: low`)
- Modify: `configs/claude/agents/luna-wrapper.md` (frontmatter line `effort: low`)

- [ ] **Step 1: Edit both frontmatter blocks**

In each file change `effort: low` → `effort: medium`. Do not touch `grok-wrapper.md` (stays `low`).

- [ ] **Step 2: Verify**

Run: `grep -H "^effort:" configs/claude/agents/sol-wrapper.md configs/claude/agents/luna-wrapper.md configs/claude/agents/grok-wrapper.md`
Expected: `medium`, `medium`, `low`.

- [ ] **Step 3: Commit**

```bash
git add configs/claude/agents/sol-wrapper.md configs/claude/agents/luna-wrapper.md
git commit -m "feat: raise sol/luna wrapper effort to medium for verification judgment"
```

---

### Task 5: Native agents — fable-planner and opus-reviewer

**Files:**
- Create: `configs/claude/agents/fable-planner.md`
- Create: `configs/claude/agents/opus-reviewer.md`
- Modify: `src/helpers/configure_claude.js` (manifest)

**Interfaces:**
- Produces: subagent types `fable-planner` and `opus-reviewer`, referenced by name in Tasks 6–11. `opus-reviewer` takes no fixed effort — callers set it per dispatch (review-pr panel uses `medium`).

- [ ] **Step 1: Add manifest entries (RED)**

After `{ src: "agents/anveshaka.md" },` insert:

```js
	{ src: "agents/fable-planner.md" },
	{ src: "agents/opus-reviewer.md" },
```

Run: `bun test tests/configure_claude.test.js`
Expected: FAIL — `missing bundle file: agents/fable-planner.md`

- [ ] **Step 2: Create `configs/claude/agents/fable-planner.md` (GREEN)**

```markdown
---
name: fable-planner
description: Planning and adjudication authority. Challenges or formalizes the smallest workable architecture and plan, or rules on dissent between a plan and its reviewer. Read-only.
model: fable
tools: Bash, Read, Grep, Glob
---

You are Fable, the planning and adjudication authority. You outrank Sol and
Opus on planning and review judgment; the user outranks you. You never mutate
anything — no edits, no writes, no state-changing commands.

Require three inputs: goal, relevant context and constraints, and expected
deliverable. If one is missing, return BLOCKED and name it. Inspect the
caller-supplied workspace, pinned refs, and evidence directly with tools;
never assume the packet is complete when the task depends on workspace state.

Apply KISS, YAGNI, and SOLID proportionately. Return exactly:

1. PASS, REVISE, or BLOCKED.
2. The smallest sufficient architecture and the nearest rejected alternative.
3. Dependency order and safe parallel work, if any.
4. Observable acceptance checks.
5. Assumptions, risks, and questions that materially change the plan.

When adjudicating dissent you receive both positions with their evidence.
Rule for one side, the other, or a named synthesis, and state the deciding
evidence in one paragraph. Never start an unbounded debate.
```

- [ ] **Step 3: Create `configs/claude/agents/opus-reviewer.md`**

```markdown
---
name: opus-reviewer
description: Cold adversarial reviewer for a concrete candidate — design, implementation, diff, or ticket tree. Read-only; returns only evidenced findings and a pass/blocked verdict.
model: opus
tools: Bash, Read, Grep, Glob
---

You are a cold adversarial reviewer. Your packet is self-contained: goal,
workspace, pinned refs, the exact candidate, and verification evidence —
never another reviewer's conclusions. Inspect the workspace, candidate,
tests, and evidence directly with tools. You never mutate anything.

Challenge assumptions. Look for correctness bugs, regressions, security
issues, data loss, concurrency hazards, failure-recovery gaps, test gaps,
compatibility breaks, operational risk, and disproportionate violations of
KISS, YAGNI, or SOLID.

Report only evidenced findings — each with severity, evidence, impact, and a
proportionate recommendation. Silence is preferable to speculation. End with
a verdict line: `pass` if no material finding remains, else `blocked`, with
blocking findings listed first.
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `bun test tests/configure_claude.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add configs/claude/agents/fable-planner.md configs/claude/agents/opus-reviewer.md src/helpers/configure_claude.js
git commit -m "feat: add native fable-planner and opus-reviewer agent definitions"
```

---

### Task 6: implement-work skill

**Files:**
- Create: `configs/claude/skills/implement-work/SKILL.md`
- Modify: `src/helpers/configure_claude.js` (manifest)

**Interfaces:**
- Consumes: `fable-planner`, `opus-reviewer` (Task 5), `sol-wrapper` (existing).
- Produces: the evidence contract other skills cite — "fresh implement-work evidence" means an Opus `pass` verdict plus Sol's `report.json` covering the exact base/HEAD.

- [ ] **Step 1: Add manifest entry (RED)**

After the `discovering-work` entries in `PERSONAL_FILES` insert:

```js
	{ src: "skills/implement-work/SKILL.md" },
```

Run: `bun test tests/configure_claude.test.js` — Expected: FAIL (missing file).

- [ ] **Step 2: Create `configs/claude/skills/implement-work/SKILL.md` (GREEN)**

```markdown
---
name: implement-work
description: Use for implementing features, changes, or bugfixes; not for review-only work. Runs the Fable-plan, Sol-review, Sol-implement, Opus-review pipeline.
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

## Trivial bypass

Handle directly (no pipeline) only if the change is local, reversible,
low-risk, interface-neutral, small, unambiguous, and obviously verifiable.
When uncertain, take the pipeline.

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
- Completion evidence = Opus `pass` + Sol's report covering the exact
  base/HEAD. Downstream skills (create-pr) require it fresh.
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `bun test tests/configure_claude.test.js`
Expected: PASS (file present, ~62 lines).

- [ ] **Step 4: Commit**

```bash
git add configs/claude/skills/implement-work src/helpers/configure_claude.js
git commit -m "feat: add implement-work skill (fable plan, sol review+implement, opus review)"
```

---

### Task 7: review-pr skill

**Files:**
- Create: `configs/claude/skills/review-pr/SKILL.md`
- Modify: `src/helpers/configure_claude.js` (manifest)

**Interfaces:**
- Consumes: `opus-reviewer` (with per-dispatch `effort: 'medium'`), `sol-wrapper`, `luna-wrapper`, native sonnet agents.

- [ ] **Step 1: Add manifest entry (RED)**

```js
	{ src: "skills/review-pr/SKILL.md" },
```

Run: `bun test tests/configure_claude.test.js` — Expected: FAIL (missing file).

- [ ] **Step 2: Create `configs/claude/skills/review-pr/SKILL.md` (GREEN)**

```markdown
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
- With explicit user authorization, submit one review under 200 lines:
  APPROVE if no material finding remains, else REQUEST_CHANGES; never
  COMMENT. Never auto-submit.

## Workflow rule

When a phase fans out (≥3 concurrent agents), author an inline Workflow at
dispatch time. Single-dispatch phases use direct Agent/seat calls. Never put
approval gates, adjudication, or user decisions inside a workflow.
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `bun test tests/configure_claude.test.js`
Expected: PASS (~48 lines).

- [ ] **Step 4: Commit**

```bash
git add configs/claude/skills/review-pr src/helpers/configure_claude.js
git commit -m "feat: add review-pr skill with six-lens inline-workflow panel"
```

---

### Task 8: create-pr skill

**Files:**
- Create: `configs/claude/skills/create-pr/SKILL.md`
- Modify: `src/helpers/configure_claude.js` (manifest)

**Interfaces:**
- Consumes: implement-work's evidence contract (Task 6), `luna-wrapper`.

- [ ] **Step 1: Add manifest entry (RED)**

```js
	{ src: "skills/create-pr/SKILL.md" },
```

Run: `bun test tests/configure_claude.test.js` — Expected: FAIL (missing file).

- [ ] **Step 2: Create `configs/claude/skills/create-pr/SKILL.md` (GREEN)**

```markdown
---
name: create-pr
description: Use when local changes are ready to become GitHub pull requests; not for PR review or babysitting.
---

# Create PR

## Gates — all must pass before any push

- Confirm scope, base branch, repository, and explicit GitHub write
  authorization; preserve unrelated work.
- Require fresh implement-work evidence (Opus `pass` + Sol report) covering
  the exact base/HEAD. Material findings block push and PR.

## Sizing

- Size with `git diff --numstat` (additions + deletions), excluding
  binaries, generated files, vendored code, and lockfiles.
- ≤1,500 LOC: `gh pr create --draft`.
- Above 1,500 LOC: require the official `github/gh-stack` extension only
  (install if absent; verify local `submit --help` shows `--auto` drafts).
  Stack bottom-to-top; each layer independently reviewable, independently
  testable, ≤1,500 LOC; submit with `--auto`; never `--open`.
- Missing stack access or no safe decomposition blocks — never open an
  oversized PR.

## PR copy

- Dispatch `luna-wrapper` (implementation mode) writing only a declared
  local copy file. Its packet carries per-layer evidence: ranges and
  numstats, commits and hunks, linked issues, checks, risks, and the stack
  map. Reject path-only packets.
- Luna returns per-layer title and body: Summary / Why / Changes /
  Verification / Risks, plus the stack review order.
- Verify Luna's claims against git yourself, create the drafts, apply the
  copy, then reread GitHub state to confirm.

## Workflow rule

When a phase fans out (≥3 concurrent agents), author an inline Workflow at
dispatch time. Single-dispatch phases use direct Agent/seat calls. Never put
approval gates, adjudication, or user decisions inside a workflow.

Merging is out of scope.
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `bun test tests/configure_claude.test.js`
Expected: PASS (~48 lines).

- [ ] **Step 4: Commit**

```bash
git add configs/claude/skills/create-pr src/helpers/configure_claude.js
git commit -m "feat: add create-pr skill with sizing gates and luna PR copy"
```

---

### Task 9: brainstorm skill

**Files:**
- Create: `configs/claude/skills/brainstorm/SKILL.md`
- Modify: `src/helpers/configure_claude.js` (manifest)

**Interfaces:**
- Consumes: `luna-wrapper` (research dispatch), native Explore/sonnet agents, `fable-planner`.

- [ ] **Step 1: Add manifest entry (RED)**

```js
	{ src: "skills/brainstorm/SKILL.md" },
```

Run: `bun test tests/configure_claude.test.js` — Expected: FAIL (missing file).

- [ ] **Step 2: Create `configs/claude/skills/brainstorm/SKILL.md` (GREEN)**

```markdown
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
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `bun test tests/configure_claude.test.js`
Expected: PASS (~41 lines).

- [ ] **Step 4: Commit**

```bash
git add configs/claude/skills/brainstorm src/helpers/configure_claude.js
git commit -m "feat: add brainstorm skill (luna research, explore agents, fable plan)"
```

---

### Task 10: babysit-pr skill

**Files:**
- Create: `configs/claude/skills/babysit-pr/SKILL.md`
- Modify: `src/helpers/configure_claude.js` (manifest)

**Interfaces:**
- Consumes: `sol-wrapper` (implementation mode, detach/wait), `opus-reviewer`, `/loop` skill, `gh` CLI.

- [ ] **Step 1: Add manifest entry (RED)**

```js
	{ src: "skills/babysit-pr/SKILL.md" },
```

Run: `bun test tests/configure_claude.test.js` — Expected: FAIL (missing file).

- [ ] **Step 2: Create `configs/claude/skills/babysit-pr/SKILL.md` (GREEN)**

```markdown
---
name: babysit-pr
description: Use to watch an existing GitHub PR through CI and review feedback, autonomously fixing and pushing after Opus review; not for creating or initially reviewing a PR.
---

# Babysit PR

## Authority

Push authority is granted once, explicitly, when the skill starts (e.g.
"babysit PR #123 and push fixes"). Record it. Nothing escalates beyond it
mid-run: review submission, merging, labels, reruns, and secrets each need
separate explicit authority.

## Loop

Run as a `/loop` with self-paced wakeups. Each tick: query `gh` for CI
status, review threads, and the head SHA. Nothing actionable → sleep.
Actionable → enter one fix cycle. Exactly one fix cycle in flight, ever;
new events queue behind it.

## Fix cycle — sequential; inline workflows are forbidden here

1. **Pin** the remote head SHA the fix is based on.
2. **Classify** trivial (lint, typo, format) vs non-trivial.
3. **Sol implements** in the PR worktree: `sol-wrapper` implementation mode
   with exact scope, prohibited changes, and verification commands; use
   detach-and-wait for long runs. One dispatch fixes all currently known
   issues — never fan out mutators against one worktree.
4. **Verify** the report's verification evidence yourself; the diff must
   touch only in-scope paths.
5. **Opus reviews**: spawn `opus-reviewer`, cold, with the diff and report.
   A material finding gets one remediation round through Sol. A second
   failure stops the cycle and notifies the user — never push.
6. **Push gate**: the remote head must still equal the pinned SHA;
   otherwise discard the local result and restart the cycle against the new
   head. Never force-push. Push, reread GitHub, report the commit SHA.

## Invariants

- Single mutator: only this fix cycle commits or pushes to the worktree;
  every review agent is read-only.
- The Opus gate is structural: the push step is unreachable except through
  a `pass` verdict.
- Stop conditions, each ending the loop with a notification: PR merged
  (success); PR closed unmerged; two consecutive failed fix cycles; head
  churn showing a human actively working.
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `bun test tests/configure_claude.test.js`
Expected: PASS (~52 lines).

- [ ] **Step 4: Commit**

```bash
git add configs/claude/skills/babysit-pr src/helpers/configure_claude.js
git commit -m "feat: add babysit-pr skill with single-mutator fix cycle and opus push gate"
```

---

### Task 11: linear-ticketing skill

**Files:**
- Create: `configs/claude/skills/linear-ticketing/SKILL.md`
- Modify: `src/helpers/configure_claude.js` (manifest)

**Interfaces:**
- Consumes: Linear MCP tools (`mcp__claude_ai_Linear__*`), `opus-reviewer`.

- [ ] **Step 1: Add manifest entry (RED)**

```js
	{ src: "skills/linear-ticketing/SKILL.md" },
```

Run: `bun test tests/configure_claude.test.js` — Expected: FAIL (missing file).

- [ ] **Step 2: Create `configs/claude/skills/linear-ticketing/SKILL.md` (GREEN)**

```markdown
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
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `bun test tests/configure_claude.test.js`
Expected: PASS (~44 lines).

- [ ] **Step 4: Commit**

```bash
git add configs/claude/skills/linear-ticketing src/helpers/configure_claude.js
git commit -m "feat: add linear-ticketing skill with opus tree review"
```

---

### Task 12: Deploy to ~/.claude and sync the policy repo

**Files:**
- No repo files modified. Deploys the bundle to `~/.claude/` and cleans retired files there.

**Interfaces:**
- Consumes: `syncClaudeConfig({ srcDir, claudeHome })` from `src/helpers/configure_claude.js`; the `~/.claude` git policy repo (standing push authorization exists for it).

- [ ] **Step 1: Run the full test suite once more**

Run: `bun test`
Expected: PASS (all files, not just configure_claude).

- [ ] **Step 2: Deploy the bundle**

```bash
cd ~/dev/Haoshoku && bun -e 'const m = await import("./src/helpers/configure_claude.js"); await m.syncClaudeConfig();'
```

Expected: "Copied ..." lines for the new skills/agents. Note: `syncClaudeConfig` skips files tracked by the `~/.claude` git repo — the wrapper effort bumps may be skipped. Handle next step.

- [ ] **Step 3: Force-copy the two tracked wrappers (sync skips tracked files)**

```bash
cp ~/dev/Haoshoku/configs/claude/agents/sol-wrapper.md ~/.claude/agents/sol-wrapper.md
cp ~/dev/Haoshoku/configs/claude/agents/luna-wrapper.md ~/.claude/agents/luna-wrapper.md
```

- [ ] **Step 4: Remove retired files from ~/.claude**

```bash
cd ~/.claude
git rm --ignore-unmatch workflows/pr-review.js workflows/review-station.js agents/prepare-pr-review-render-workspace.sh
git rm -r --ignore-unmatch skills/samvada-html-deliverables
rm -rf workflows/pr-review.js workflows/review-station.js agents/prepare-pr-review-render-workspace.sh skills/samvada-html-deliverables
```

- [ ] **Step 5: Verify the deployed layout**

Run: `ls ~/.claude/skills/ ~/.claude/agents/ | sort`
Expected: skills include `babysit-pr`, `brainstorm`, `create-pr`, `discovering-work`, `html-explainer`, `implement-work`, `linear-ticketing`, `review-pr` (plus the `omarchy` symlink); agents include `fable-planner.md`, `opus-reviewer.md`, the three wrappers, `run-codex-task.sh`, `validate-codex-wrapper.sh`; no `samvada-html-deliverables`, no retired workflow files.

- [ ] **Step 6: Commit and push the ~/.claude policy repo** (standing authorization)

```bash
cd ~/.claude
git add -A skills agents workflows
git commit -m "feat: deploy claude orchestration skills (migrated from codex)"
git push
```

- [ ] **Step 7: Smoke-check skill visibility**

Run: `claude -p --max-turns 1 "List the names of the skills you can invoke, one per line" 2>/dev/null | head -30`
Expected: the seven new skill names appear. (If the CLI session does not list user skills this way, instead verify each `~/.claude/skills/*/SKILL.md` has valid frontmatter: `head -4 ~/.claude/skills/*/SKILL.md`.)

---

## Verification (post-plan, from the spec's acceptance checks)

Dry runs are intentionally not tasks in this plan — they need live PRs/tickets and user supervision:

1. implement-work on a toy change (exercises Fable→Sol→Opus end to end).
2. review-pr on a small real PR (panel authored as an inline workflow, six lenses).
3. html-explainer producing a valid offline page from the template.
4. babysit-pr against a test PR (push only after Opus pass + head re-pin; stop conditions fire).

Run these with the user in the loop after deployment.
