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
- UI changes: verify visually in a real browser via whatever browser-automation MCP is available (claude-in-chrome, Playwright, …)
- Infra changes: verify the deployment took effect — exit code 0 is not proof
- "Would a staff engineer approve this?" — if no, iterate before presenting

## External Lookups

Training data is stale. Before quoting a package version, library API, framework feature, or CLI tool flag:
- WebSearch (or WebFetch on the source URL) to verify current state
- For library/SDK docs specifically, prefer context7 MCP — it pulls live versions
- Never say "latest X" from memory; look it up

## Subagent model selection

When dispatching subagents via the `Agent` tool, **never use `haiku`**. Default to `sonnet` whenever a "fast and cheap" tier is needed, and `opus` only for tasks that genuinely require the strongest reasoning (architectural design, complex review, hairy debugging).

**Why:** Haiku produces work that needs more review iterations to reach acceptable quality, even on tasks that look mechanical on paper. The total round-trip time and review-loop overhead end up costing more than just running sonnet once. Sonnet is the floor for any code-touching subagent in this workspace.

**How to apply:** When a skill or guide says "use a fast cheap model" or "use the cheapest model that can do the job", read that as `sonnet`. Reserve `opus` for the few tasks where extra capability noticeably reduces failure rate (multi-file integration, novel architecture, code review of subtle logic).

**Fable:** never auto-dispatch `fable` subagents — sonnet/opus is the whole ladder for self-directed dispatch. Use fable in a subagent only when the user explicitly names that tier for a specific dispatch.

## Git Commits

- Semantic prefix (feat, fix, refactor, docs, test, chore), 50-char subject max
- One logical change per commit — keep a feature with its test, split a feature from a drive-by refactor

## Git Identity (GitHub attribution)

The `# userEmail` line auto-injected by Claude Code (`axatbhardwaj99@gmail.com`) is the **Anthropic account** email — it is NOT the GitHub commit-author identity and should never be used as `git config user.email`.

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
- **When approved to post, use the medium shape on GitHub:** Verdict + Severity table + Strengths (3–5 condensed bullets) + Issues (one short paragraph per finding — `file:line` + 2–3 sentences + suggested fix as prose, not a multi-line code block) + Recommendation + footer linking to the local file. Skip the ground-truth/verification appendix, file-read inventory, "couldn't verify" section, and multi-line suggested-fix code blocks. Never paste the whole local review file into the GitHub body.
- **Single-finding code-block detail → inline comment.** If one finding genuinely needs a verbatim code-block suggested fix on GitHub (the author needs to apply the patch directly), post that one finding as a targeted inline review comment on the file/line, not by expanding the top-level body.
- **Editing after the fact:** if the posted body needs trimming, use `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/reviews/{review_id}` with a `{body: …}` payload — review state (APPROVED/COMMENT/CHANGES_REQUESTED) is preserved across edits.
- **Local file location:** per-repo conventions live in that repo's project-scope CLAUDE.md (defi-com repos: `~/defi/CLAUDE.md`). In a repo with no established convention, confirm a location with the user the first time, then stay consistent.

## Task Routing — Superpowers

Superpowers is the default execution framework. Skills auto-trigger from their descriptions, but engage them deliberately — they exist to stop you from jumping straight to code.

**Skip Superpowers only for:** throwaway one-liners, edits to `~/.claude/` itself, pure factual questions, sub-30-second config tweaks. (This exempts skill *routing* only — todos still apply; see Skill discipline.)

### Every conversation
- `superpowers:using-superpowers` is auto-injected at session start — follow it from the first response (including before clarifying questions); don't re-invoke it via the Skill tool

### Before writing code
- New feature, component, or behavior change → `superpowers:brainstorming` (mandatory before any creative work)
- Multi-step task with a spec → `/shape-spec` (see Agent OS below)
- Implementation work → `superpowers:test-driven-development` (red/green TDD, before writing implementation)

### Doing the work
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

### Creating or editing skills
- `superpowers:writing-skills`

### Working artifacts

**No *tracked* artifacts.** Specs and plans are how we reach alignment, not what ships — the PR description, commit messages, and code carry the rationale future readers need, and working docs accumulate rounds of review noise that would bloat diffs. Plans live in conversation context and skill invocations; do **not** create `plan.md`, `spec.md`, `tasks.md`, `notes.md`, `research.md`, or per-feature `.planning/` directories in tracked paths. Three sanctioned gitignored locations:

1. **`BRANCH-NOTES.md`** at the worktree root, gitignored — branch-scoped status (the branch, not the conversation or repo, is what crosses session boundaries). Each session appends a dated line at session end: what shipped, what's blocked, what the next session needs to skip re-discovery (deployed envs, open PRs, current test state). Read it first thing on session start; if it grows past one screen, prune older entries.

2. **`~/ACTIVE-WORK.md`** — the single global index across all worktrees. One line per active branch: worktree path | branch | status of **~25 words max**; deep detail belongs in that worktree's BRANCH-NOTES.md, not here. Update on every context-switch between worktrees, and **remove an entry once its branch merges or its PR closes** — finished work doesn't belong in the index.

3. **`./superpowers/`** at the repo root (sibling of `app/`, `src/`, `lib/` — not under `docs/` or `.claude/`), gitignored — output of the brainstorming/planning skills and similar working docs, as self-contained dark HTML (see Deliverables below):
   - `./superpowers/specs/YYYY-MM-DD-<topic>-design.html`
   - `./superpowers/plans/YYYY-MM-DD-<feature>.html`
   - further subdirectories as needed (`research/`, etc.)

   A PreToolUse hook injects this output contract whenever a superpowers planning skill is invoked — the skills' own tracked-`docs/`-path markdown defaults never apply here. First setup step in any repo: add `/superpowers/` and `agent-os/` to `.gitignore`. If prior specs/plans were committed anywhere, `git rm` them and re-create them here.

## Skill discipline

The routing rules above are gates, not suggestions. If the rule says "Implementation work → TDD" and you find yourself rationalizing ("simple change, types pass, manually verified"), stop — that thought is the rationalization the rule exists to override. Same shape: if a plan exists in conversation (not just in a spec doc) and you're about to drive every edit yourself, dispatch subagents instead.

**Re-check the gates before any Edit/Write tool call that modifies code.** Brainstorming approval is not a license to skip TDD — each implementation increment is its own gate-check; a multi-step task does not collapse into one continuous "work" period after the plan is approved.

**Todos:** every request involving tool work starts with TaskCreate entries before the work begins — a one-step task gets exactly one todo, statuses update live (`in_progress` → `completed`), and ending a turn with stale pending todos is a defect. This applies even to tasks on the skip list above — that list exempts skill routing, not todo tracking. When invoking a Superpowers skill with a checklist, create one task per checklist item first: the user sees the workflow actually being followed, and writing the steps down is what stops you from collapsing them or losing your place mid-skill. (A UserPromptSubmit hook re-injects these gates on every prompt.)

## Agent OS — Standards & Planning Layer

Agent OS v3 supplies durable convention memory. It layers UNDER Superpowers' execution discipline — it never replaces the gates (TDD, debugging, verification, review). All `agent-os/` output is gitignored; nothing Agent-OS-generated is committed.

Layers:
- **Standards** — `agent-os/standards/` + `index.yml`. The payload. `/discover-standards` mines a repo's conventions; `/inject-standards` pulls matching ones into context before planning AND before implementation. Cross-repo standards live in `~/agent-os/profiles/default/standards/<category>/`; `~/agent-os/scripts/project-install.sh` propagates them into a repo's `agent-os/standards/`.
- **Product** (optional) — `/plan-product` → mission/roadmap/tech-stack.
- **Spec** — `/shape-spec` supersedes `superpowers:writing-plans`: it is writing-plans made standards-aware, customized to emit a single dark HTML plan to `./superpowers/plans/`, never `agent-os/specs/*.md`.

Flow: `superpowers:brainstorming` → `/shape-spec` (standards-injected) → `superpowers:test-driven-development` → verification → review.

Engine note: Claude Code uses the slash commands (installed to `.claude/commands/agent-os/`). Codex has no slash commands — see AGENTS.md, which routes it to read and follow the same `~/agent-os/commands/agent-os/*.md` files directly.

## Deliverables — HTML over Markdown

Markdown files are not the primary way to communicate work product ([Thariq's "the unreasonable effectiveness of HTML"](https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html)). Any document produced for a human to read — specs, plans for approval, research/ADRs, reports, audits, PR reviews, todo/status views — is a **single self-contained dark-mode HTML file**. Conversation replies stay plain text; this rule is about files.

**Format source (mandatory):** every HTML deliverable is authored via the `dvandva:html-deliverables` skill (ships in the Dvandva plugin — house tokens, components, diagram rules, and a fill-in `template.html`). Invoke it before writing the file; never restyle from scratch. If the plugin is missing in a session, install it (`cargo install dvandva && dvandva install`) or copy the token block from an existing deliverable — never invent a new palette. The quality bar below is what that skill implements.

Quality bar, every file:
- **Dark mode, always** — near-black background, comfortable contrast, one accent color, no flash-of-white.
- **Beautiful** — real typography, generous whitespace, syntax-highlighted code, polished tables; it should look designed, not generated.
- **Intuitive** — sticky nav/TOC past one screen, clear hierarchy, status/severity badges; the reader never scroll-hunts.
- **Interactive where it earns its keep** — collapsible sections, filterable tables, tabs for side-by-side comparisons, checkboxes on todo views.
- **Visual, not transcribed** — when the content has structure, flow, or relationships, *draw* it instead of describing it: flowcharts, architecture / sequence / state diagrams, timelines, dependency graphs, comparison matrices, annotated call-outs. Default to hand-authored **inline SVG** (dark-themed, self-contained, renders offline, zero dependencies); semantic HTML/CSS for timelines, bars, and grids. The test: anything you'd sketch on a whiteboard to explain it belongs in the file as a drawing, not a bullet list about it.
- **Self-contained** — inline all CSS/JS, no CDNs, no build step; must render offline via `file://`.

Anti-pattern — **markdown-in-a-box**: HTML that's only prose + tables a `.md` could have held wastes the medium. Every non-trivial deliverable must earn its HTML through at least one of — a diagram, a deliberate visual layout/hierarchy, or interactivity — and usually *leads* with the visual, using prose to annotate it, not replace it. Concretely: a debugging report shows the causal chain as a flow (symptom → hypotheses ruled out → root cause → fix); a spec shows architecture + a sequence diagram; a review shows a severity matrix and the affected call paths; a plan shows phases on a timeline. (Need an auto-laid-out graph too large to hand-draw? Vendor the library inline — never a CDN; inline SVG covers nearly everything else.)

State rule: browser-side interaction (checked boxes, filters, sliders) does not persist into the file. Interactive state worth keeping gets an **export button** ("copy as prompt" / "copy as JSON") so it can be pasted back to Claude; the file's content stays the single source of truth, updated by Claude at checkpoints. Live todo tracking stays in the harness task system — an HTML todo/plan view is a rendered snapshot of it.

Stays plain text (machine-read every session or platform-native — HTML is pure token tax there): `BRANCH-NOTES.md`, `~/ACTIVE-WORK.md`, memory files, CLAUDE.md itself, commit messages, and anything posted to GitHub or Linear.
