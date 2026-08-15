## Codex Compatibility Layer

This file is the Codex version of the Claude guidance. Keep the intent identical, but translate Claude-specific mechanics into Codex-native ones:

- **AGENTS.md role:** Codex reads `AGENTS.md` guidance before work and layers project-specific files by directory scope. Treat this file as global/default behavior, overridden by closer repo `AGENTS.md` files and direct user instructions.
- **Skills:** When a rule names a skill such as `superpowers:systematic-debugging`, use Codex Skills semantics: select the skill by name/description, read the relevant `SKILL.md` completely before acting, and follow any referenced instructions needed for the task. If the current harness exposes a direct skill invocation UI, use it; otherwise reading `SKILL.md` from the installed skill path is the invocation.
- **Tasks/todos:** When this file says `TaskCreate`, `TodoWrite`, or "todos", use Codex `update_plan` with one entry per required checklist item. Keep statuses current (`pending` -> `in_progress` -> `completed`). Do not leave stale pending plan items at turn end.
- **Subagents:** When this file says `Agent tool`, use available Codex subagent or multi-agent tools only if they exist and the work is genuinely independent. If no subagent tool is available, continue directly and state that limitation only when it affects the outcome.
- **Slash commands/plugins:** Claude slash commands such as `/plugin` are workflow names unless the Codex harness exposes an equivalent. Prefer installed Codex plugins, MCP tools, or local skill files over literal Claude commands.
- **Browser/UI verification:** Use whatever browser automation is available in Codex, especially Playwright MCP/tools when present. `claude-in-chrome` references mean "browser automation", not that exact tool.
- **Docs and handoff text:** Any sentence saying "paste back to Claude" or "updated by Claude" means "paste back to the current agent/Codex" in this environment.
- **Model tiers:** Claude model names (`haiku`, `sonnet`, `opus`, `fable`) apply only when a tool actually exposes those tiers. If Codex-native subagents do not expose a model selector, ignore the tier names while preserving the quality bar.

## Autonomous Execution

The following are pre-authorized — proceed without asking:
- Bug reports: diagnose and fix end-to-end (route via `superpowers:systematic-debugging`)
- Failing CI: read the logs, find the cause, fix it
- PR review comments: address them (route via `superpowers:receiving-code-review`)
- "Check now" / "try now" / "do it": re-evaluate current state and act

Still confirm for: force-push, branch deletion, dependency removal, schema changes, anything touching shared infra.

When told "do not try to fix it just yet" — comply. Investigate only.

## Code Discipline

Distilled from Karpathy's LLM-coding-pitfalls rules (his 4th — goal-driven, test-first, loop-until-verified — is deliberately omitted: the TDD and verification skills already enforce it harder; don't re-add it here).

- **Surface, don't assume.** State assumptions explicitly; if multiple interpretations exist, present them instead of picking silently; if a simpler approach exists than what was asked, say so before building it. Don't hide confusion — name what's unclear. Autonomous Execution still applies: this governs *how* you proceed, not whether.
- **Simplicity first.** Minimum code that solves the problem: no unrequested features, abstractions, configurability, or error handling for impossible scenarios. No abstraction for single-use code. "Would a senior engineer call this overcomplicated?" — if yes, rewrite before presenting.
- **Surgical diffs.** Touch only what the request requires: no "improving" adjacent code, comments, or formatting; no refactoring what isn't broken; match existing style even where you'd do it differently. Remove orphans YOUR change created (imports, variables, functions); pre-existing dead code gets mentioned, not deleted. The test: every changed line traces to the request.

## Verification That Counts

`superpowers:verification-before-completion` enforces this for code completion. The principle generalizes:

- Run the test that motivated the change, not just the full suite
- UI changes: verify visually in a real browser via whatever browser automation is available, especially Playwright MCP/tools when present
- Infra changes: verify the deployment took effect — exit code 0 is not proof
- "Would a staff engineer approve this?" — if no, iterate before presenting

## External Lookups

Training data is stale. Before quoting a package version, library API, framework feature, or CLI tool flag:
- WebSearch or WebFetch on the source URL to verify current state
- For library/SDK docs specifically, prefer context7 MCP — it pulls live versions
- Never say "latest X" from memory; look it up

## Subagent Model Selection

When dispatching subagents through tools that expose Claude-style model tiers, **never use `haiku`**. Default to `sonnet` whenever a "fast and cheap" tier is needed, and `opus` only for tasks that genuinely require the strongest reasoning (architectural design, complex review, hairy debugging). If the Codex subagent tool has no model selector, ignore the tier names while preserving the quality bar.

**Why:** Haiku produces work that needs more review iterations to reach acceptable quality, even on tasks that look mechanical on paper. The total round-trip time and review-loop overhead end up costing more than just running sonnet once. Sonnet is the floor for any code-touching subagent in this workspace.

**How to apply:** When a skill or guide says "use a fast cheap model" or "use the cheapest model that can do the job", read that as `sonnet`. Reserve `opus` for the few tasks where extra capability noticeably reduces failure rate (multi-file integration, novel architecture, code review of subtle logic).

**Fable:** never auto-dispatch `fable` subagents — sonnet/opus is the whole ladder for self-directed dispatch. Use fable in a subagent only when the user explicitly names that tier for a specific dispatch.

## Git Commits

- Semantic prefix (feat, fix, refactor, docs, test, chore), 50-char subject max
- One logical change per commit — keep a feature with its test, split a feature from a drive-by refactor

## Git Identity (GitHub Attribution)

If a `# userEmail` line is auto-injected by Claude Code (`axatbhardwaj99@gmail.com`) or copied from Claude context, it is the **Anthropic account** email — it is NOT the GitHub commit-author identity and should never be used as `git config user.email`. In Codex, do not infer git identity from account metadata either.

**Verified emails on the GitHub account `axatbhardwaj`** (either is valid for commit attribution):
- `axatbhardwaj@outlook.com`
- `axatbhardwaj@gmail.com`

GitHub username: `axatbhardwaj`

**Rules:**
- Use one of the two verified emails above for `git config user.email` in any repo whose work should appear on the GitHub profile.
- If a repo has a `user.email` override that doesn't match one of these, flag it — commits will land as an unattributed grey avatar on github.com.
- Never assume an email from the auto-injected `# userEmail` block is a usable git identity. Treat that block as account metadata only.

## Worktree Awareness

- Worktrees are sibling directories of the main repo (e.g. `monorepo-DEF-573` next to `monorepo`)
- New worktree: copy `.env` files and re-check `.gitignore` — they don't carry over. Dependencies may need reinstalling.
- Always know which worktree you're in and what branch it tracks.
- "Bring changes to this worktree" → cherry-pick or merge. Don't suggest switching worktrees as the fix.

## PR Reviews

Applies to **any PR review, any repo**. The local review file is the canonical deliverable; the GitHub review is a notification surface. New reviews are authored as dark self-contained HTML per the Deliverables section below (collapsible findings, filterable severity table); pre-June-2026 `.md` reviews stay as they are — don't convert them.

- **Never auto-post.** Posting to a PR (review body, top-level comment, inline comment, sub-agent posts) requires **explicit per-session user approval** — and even then, confirm the *form* (full / medium / specific finding) before posting. If a post happens without approval, delete it rather than edit it.
- **Local file is the deliverable.** Write the review to a local HTML file with the full structure (verdict, severity table, strengths, issues with file:line refs + suggested fixes, ground-truth verification appendix). This is what gets re-read, refined for round 2 (append a dated round section, same as before), and cited. The GitHub medium shape is rendered to markdown from it at post time.
- **When approved to post, use the medium shape on GitHub:** Verdict + Severity table + Strengths (3-5 condensed bullets) + Issues (one short paragraph per finding — `file:line` + 2-3 sentences + suggested fix as prose, not a multi-line code block) + Recommendation + footer linking to the local file. Skip the ground-truth/verification appendix, file-read inventory, "couldn't verify" section, and multi-line suggested-fix code blocks. Never paste the whole local review file into the GitHub body.
- **Single-finding code-block detail → inline comment.** If one finding genuinely needs a verbatim code-block suggested fix on GitHub (the author needs to apply the patch directly), post that one finding as a targeted inline review comment on the file/line, not by expanding the top-level body.
- **Editing after the fact:** if the posted body needs trimming, use `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/reviews/{review_id}` with a `{body: ...}` payload — review state (APPROVED/COMMENT/CHANGES_REQUESTED) is preserved across edits.
- **Local file location:**
  - **defi-com repos** → `~/defi/misc/reviews/`, named per-repo: plain `review-PR-<num>.html` means `monorepo` *by definition*; the other repos are always prefixed — `review-azure-next-hybrid-PR-<num>.html`, `review-contracts-PR-<num>.html` (PR numbers collide across repos; never drop the prefix, never prefix monorepo). Legacy reviews are `.md`; leave them. If readable, use `~/.claude/projects/-home-xzat-defi-monorepo/memory/reference_pr_review_convention.md` for the mandatory header structure, `Reviewed:` SHA pin, and round-2 severity-row vocabulary; otherwise infer from the latest existing local review.
  - **Other repos:** confirm a location with the user the first time, then stay consistent.

## Task Routing — Superpowers

Superpowers is the default execution framework. Skills auto-trigger from their descriptions, but engage them deliberately — they exist to stop you from jumping straight to code.

**Skip Superpowers only for:** throwaway one-liners, edits to agent config directories themselves (`~/.codex/`, `~/.claude/`), pure factual questions, sub-30-second config tweaks. This exempts skill routing only — todos still apply; see Skill Discipline.

### Every Conversation

- `superpowers:using-superpowers` is available as a Codex skill — follow it from the first response, including before clarifying questions. In Codex, this means loading/reading the skill instructions rather than looking for Claude's `Skill` tool.

### Before Writing Code

- New feature, component, or behavior change → `superpowers:brainstorming` (mandatory before any creative work)
- Multi-step task with a spec → `/shape-spec` procedure (standards-aware; supersedes `superpowers:writing-plans` — see Agent OS below)
- Implementation work → `superpowers:test-driven-development` (red/green TDD, before writing implementation)

### Doing The Work

- Plan exists, executing in this session → `superpowers:subagent-driven-development`
- Plan exists, executing in a separate session with checkpoints → `superpowers:executing-plans`
- 2+ independent tasks with no shared state → `superpowers:dispatching-parallel-agents`
- Feature needs workspace isolation from current branch → `superpowers:using-git-worktrees`

### Debugging

- Any bug, test failure, or unexpected behavior → `superpowers:systematic-debugging` *before* proposing fixes

### Finishing

- About to claim "done", "fixed", "passing" → `superpowers:verification-before-completion` — always run verification commands and confirm output before any success claim
- Implementation complete, deciding integration → `superpowers:finishing-a-development-branch`
- Want review before merge → `superpowers:requesting-code-review`
- Receiving review feedback → `superpowers:receiving-code-review` (verify, don't blindly implement)

### Creating Or Editing Skills

- `superpowers:writing-skills`

### Working Artifacts

**No *tracked* artifacts.** Specs and plans are how we reach alignment, not what ships — the PR description, commit messages, and code carry the rationale future readers need, and working docs accumulate rounds of review noise that would bloat diffs. Plans live in conversation context and skill invocations; do **not** create `plan.md`, `spec.md`, `tasks.md`, `notes.md`, `research.md`, or per-feature `.planning/` directories in tracked paths. Three sanctioned gitignored locations:

1. **`BRANCH-NOTES.md`** at the worktree root, gitignored — branch-scoped status (the branch, not the conversation or repo, is what crosses session boundaries). Each session appends a dated line at session end: what shipped, what's blocked, what the next session needs to skip re-discovery (deployed envs, open PRs, current test state). Read it first thing on session start; if it grows past one screen, prune older entries.

2. **`~/ACTIVE-WORK.md`** — the single global index across all worktrees. One line per active branch: worktree path | branch | status of **~25 words max**; deep detail belongs in that worktree's `BRANCH-NOTES.md`, not here. Update on every context-switch between worktrees, and **remove an entry once its branch merges or its PR closes** — finished work doesn't belong in the index.

3. **`./superpowers/`** at the repo root (sibling of `app/`, `src/`, `lib/` — not under `docs/`, `.claude/`, or `.codex/`), gitignored — output of the brainstorming/planning skills and similar working docs, as self-contained dark HTML (see Deliverables below):
   - `./superpowers/specs/YYYY-MM-DD-<topic>-design.html`
   - `./superpowers/plans/YYYY-MM-DD-<feature>.html`
   - further subdirectories as needed (`research/`, etc.)

   Those skills default to a tracked `docs/superpowers/...` path and markdown format — **override both: write under gitignored `./superpowers/` as self-contained dark HTML** (see Deliverables below), pushing back if a skill redirects to a tracked path. First setup step in any repo: add `/superpowers/` and `agent-os/` to `.gitignore` (Agent OS output — standards, product, specs — is gitignored wholesale; nothing Agent-OS-generated is committed). If prior specs/plans were committed anywhere, `git rm` them and re-create them here.

## Skill Discipline

The routing rules above are gates, not suggestions. If the rule says "Implementation work → TDD" and you find yourself rationalizing ("simple change, types pass, manually verified"), stop — that thought is the rationalization the rule exists to override. Same shape: if a plan exists in conversation (not just in a spec doc) and you're about to drive every edit yourself, dispatch subagents instead.

**Re-check the gates before any Edit/Write tool call that modifies code.** Brainstorming approval is not a license to skip TDD — each implementation increment is its own gate-check; a multi-step task does not collapse into one continuous "work" period after the plan is approved.

**Todos:** every request involving tool work starts with `update_plan` entries before the work begins — a one-step task gets exactly one todo, statuses update live (`in_progress` → `completed`), and ending a turn with stale pending todos is a defect. This applies even to tasks on the skip list above — that list exempts skill routing, not todo tracking.

**Always create tasks for every Superpowers skill step.** When invoking any Superpowers skill that has a checklist (brainstorming, writing-plans, executing-plans, TDD, debugging, etc.), immediately create one `update_plan` item per checklist item before doing the work. Update statuses (`in_progress` → `completed`) as you go. Two reasons: (1) the user can see the workflow you're executing instead of guessing whether the skill is actually being followed; (2) writing the steps down is what stops you from collapsing them, skipping a gate, or losing your place mid-skill. This applies even for "small" tasks — if a skill is invoked, its checklist gets plan items. No exceptions for perceived simplicity.

## Agent OS — Standards & Planning Layer

Agent OS v3 supplies durable convention memory. It layers UNDER Superpowers' execution discipline — it never replaces the gates (TDD, debugging, verification, review). All `agent-os/` output is gitignored; nothing Agent-OS-generated is committed.

Layers:
- **Standards** — `agent-os/standards/` + `index.yml`. The payload. `/discover-standards` mines a repo's conventions; `/inject-standards` pulls matching ones into context before planning AND before implementation. Cross-repo standards live in `~/agent-os/profiles/default/standards/<category>/`; `~/agent-os/scripts/project-install.sh` propagates them into a repo's `agent-os/standards/`.
- **Product** (optional) — `/plan-product` → mission/roadmap/tech-stack.
- **Spec** — `/shape-spec` supersedes `superpowers:writing-plans`: it is writing-plans made standards-aware, customized to emit a single dark HTML plan to `./superpowers/plans/`, never `agent-os/specs/*.md`.

Flow: `superpowers:brainstorming` → `/shape-spec` (standards-injected) → `superpowers:test-driven-development` → verification → review.

Engine note: Claude Code uses the slash commands installed to `.claude/commands/agent-os/`. Codex has no slash commands — consume Agent OS by reading and following the same `~/agent-os/commands/agent-os/*.md` files directly.

## Deliverables — HTML Over Markdown

Markdown files are not the primary way to communicate work product ([Thariq's "the unreasonable effectiveness of HTML"](https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html)). Any document produced for a human to read — specs, plans for approval, research/ADRs, reports, audits, PR reviews, todo/status views — is a **single self-contained dark-mode HTML file**. Conversation replies stay plain text; this rule is about files.

**Format source (mandatory):** every HTML deliverable uses the bundled `html-explainer` skill. Read `~/.codex/skills/html-explainer/SKILL.md` and `template.html` from that same directory before writing; never restyle from scratch. Each deliverable declares its `artifact-meta` JSON block with a `artifact.*` schema. The quality bar below is what that skill implements.

Quality bar, every file:
- **Dark mode, always** — near-black background, comfortable contrast, one accent color, no flash-of-white.
- **Beautiful** — real typography, generous whitespace, syntax-highlighted code, polished tables; it should look designed, not generated.
- **Intuitive** — sticky nav/TOC past one screen, clear hierarchy, status/severity badges; the reader never scroll-hunts.
- **Interactive where it earns its keep** — collapsible sections, filterable tables, tabs for side-by-side comparisons, checkboxes on todo views.
- **Visual, not transcribed** — when the content has structure, flow, or relationships, *draw* it instead of describing it: flowcharts, architecture / sequence / state diagrams, timelines, dependency graphs, comparison matrices, annotated call-outs. Default to hand-authored **inline SVG** (dark-themed, self-contained, renders offline, zero dependencies); semantic HTML/CSS for timelines, bars, and grids. The test: anything you'd sketch on a whiteboard to explain it belongs in the file as a drawing, not a bullet list about it.
- **Self-contained** — inline all CSS/JS, no CDNs, no build step; must render offline via `file://`.

Anti-pattern — **markdown-in-a-box**: HTML that's only prose + tables a `.md` could have held wastes the medium. Every non-trivial deliverable must earn its HTML through at least one of — a diagram, a deliberate visual layout/hierarchy, or interactivity — and usually *leads* with the visual, using prose to annotate it, not replace it. Concretely: a debugging report shows the causal chain as a flow (symptom → hypotheses ruled out → root cause → fix); a spec shows architecture + a sequence diagram; a review shows a severity matrix and the affected call paths; a plan shows phases on a timeline. Need an auto-laid-out graph too large to hand-draw? Vendor the library inline — never a CDN; inline SVG covers nearly everything else.

State rule: browser-side interaction (checked boxes, filters, sliders) does not persist into the file. Interactive state worth keeping gets an **export button** ("copy as prompt" / "copy as JSON") so it can be pasted back to the current agent/Codex; the file's content stays the single source of truth, updated by the agent at checkpoints. Live todo tracking stays in the harness task system — an HTML todo/plan view is a rendered snapshot of it.

Stays plain text (machine-read every session or platform-native — HTML is pure token tax there): `BRANCH-NOTES.md`, `~/ACTIVE-WORK.md`, memory files, `AGENTS.md`/`CLAUDE.md` themselves, commit messages, and anything posted to GitHub or Linear.
