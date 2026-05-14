## Task Routing — Superpowers

Superpowers is the default execution framework. Skills auto-trigger from their descriptions, but engage them deliberately — they exist to stop you from jumping straight to code.

**Skip Superpowers only for:** throwaway one-liners, edits to `~/.claude/` itself, pure factual questions, sub-30-second config tweaks.

### Every conversation
- Open with `superpowers:using-superpowers` — invoke before any other response, including clarifying questions

### Before writing code
- New feature, component, or behavior change → `superpowers:brainstorming` (mandatory before any creative work)
- Multi-step task with a spec → `superpowers:writing-plans`
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

### Token discipline
Superpowers replaces the heavier GSD framework specifically because it skips persisted artifact files. Don't reintroduce that pattern: keep state in conversation context and skill invocations, not in scattered `.md` files in the repo.

### Branch-scoped continuity (narrow exception to the no-artifacts rule)

The unit of work that actually crosses session boundaries is the **branch**, not the conversation and not the repo. Two — and only two — persistent files are allowed:

- **`BRANCH-NOTES.md`** at the worktree root, gitignored. One screen, append-only-ish: each session writes a dated line covering what shipped, what's blocked, and what the next session needs to know to skip re-discovery (deployed envs, open PRs, current test state). Read it first thing on session start; append at session end. If it grows past one screen, prune older entries.
- **`~/ACTIVE-WORK.md`** as a single global index across all worktrees. 2–3 lines per active branch: worktree path, branch name, one-line status. Update whenever you context-switch between worktrees.

This is **not** GSD. Do **not** create `plan.md`, `spec.md`, `tasks.md`, `notes.md`, `research.md`, or per-feature `.planning/` directories — those still belong in conversation context and skill invocations. Plans live in conversation; *status* lives in these two files.

### Superpowers spec/plan artifacts — local-only, never committed

Specs and plans from the brainstorming and writing-plans skills go to a **gitignored, root-level `./superpowers/` directory** in every repo. Specifically:

- `./superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- `./superpowers/plans/YYYY-MM-DD-<feature>.md`

`superpowers/` lives at the **repo root** as a sibling of `app/`, `src/`, `lib/`, etc. It is **not** under `docs/`, **not** under `.claude/`, **not** anywhere else. The directory and everything inside it must be in `.gitignore` so nothing under it ever enters version control.

The brainstorming and writing-plans skills default to writing under a tracked `docs/superpowers/...` path — **override that default and write to `./superpowers/...` instead.** If a skill or tool tries to redirect you to a tracked path, push back and use the gitignored root-level location.

Why local-only:

- Specs and plans are working artifacts of the brainstorming + planning loop — they're how we reach alignment, not what ships. The PR description, commit messages, and the code itself carry the design rationale that future readers need.
- These docs accumulate adversarial-review iterations (4+ rounds is normal). Committing them bloats the diff with noise and mixes "what we proposed at every step" with "what we shipped." Reviewers don't need the negotiation history.

When starting work in a repo: first add `/superpowers/` to `.gitignore` as a setup step. When inheriting a repo where prior specs/plans were committed (anywhere), `git rm` them and re-create under the gitignored `./superpowers/` so they remain locally for reference without polluting the repo.

## Skill discipline

The rules above are gates. Run the `using-superpowers` checklist before implementation work, not as theater. If the rule says "Implementation work → TDD" and you find yourself rationalizing ("simple change, types pass, manually verified"), stop — that thought is the rationalization the rule exists to override. Same shape: if a plan exists in conversation (not just in a spec doc) and you're about to drive every edit yourself, dispatch subagents instead.

**Re-check the gates before any Edit/Write tool call that modifies code.** Brainstorming approval is not a license to skip TDD. Each implementation increment is its own gate-check — a multi-step task does not collapse into one continuous "work" period after the plan is approved.

**Always create tasks for every Superpowers skill step.** When invoking any Superpowers skill that has a checklist (brainstorming, writing-plans, executing-plans, TDD, debugging, etc.), immediately create one TaskCreate entry per checklist item before doing the work. Update statuses (`in_progress` → `completed`) as you go. Two reasons: (1) the user can see the workflow you're executing instead of guessing whether the skill is actually being followed; (2) writing the steps down is what stops you from collapsing them, skipping a gate, or losing your place mid-skill. This applies even for "small" tasks — if a skill is invoked, its checklist gets tasks. No exceptions for perceived simplicity.

## Worktree Awareness

- Worktrees are sibling directories of the main repo (e.g. `monorepo-DEF-573` next to `monorepo`)
- New worktree: copy `.env` files and re-check `.gitignore` — they don't carry over. Dependencies may need reinstalling.
- Always know which worktree you're in and what branch it tracks.
- "Bring changes to this worktree" → cherry-pick or merge. Don't suggest switching worktrees as the fix.

## Autonomous Execution

The following are pre-authorized — proceed without asking:
- Bug reports: diagnose and fix end-to-end (route via `superpowers:systematic-debugging`)
- Failing CI: read the logs, find the cause, fix it
- PR review comments: address them (route via `superpowers:receiving-code-review`)
- "Check now" / "try now" / "do it": re-evaluate current state and act

Still confirm for: force-push, branch deletion, dependency removal, schema changes, anything touching shared infra.

When told "do not try to fix it just yet" — comply. Investigate only.

## Verification That Counts

`superpowers:verification-before-completion` enforces this for code completion. The principle generalizes:

- Run the test that motivated the change, not just the full suite
- UI changes: verify visually with Playwright MCP when available
- Infra changes: verify the deployment took effect — exit code 0 is not proof
- "Would a staff engineer approve this?" — if no, iterate before presenting

## External Lookups

Training data is stale. Before quoting a package version, library API, framework feature, or CLI tool flag:
- WebSearch (or WebFetch on the source URL) to verify current state
- For library/SDK docs specifically, prefer context7 MCP — it pulls live versions
- Never say "latest X" from memory; look it up

## Context Retention

If the user references a prior decision, check the conversation history before asking them to repeat themselves.

## Subagent model selection

When dispatching subagents via the `Agent` tool, **never use `haiku`**. Default to `sonnet` whenever a "fast and cheap" tier is needed, and `opus` only for tasks that genuinely require the strongest reasoning (architectural design, complex review, hairy debugging).

**Why:** Haiku produces work that needs more review iterations to reach acceptable quality, even on tasks that look mechanical on paper. The total round-trip time and review-loop overhead end up costing more than just running sonnet once. Sonnet is the floor for any code-touching subagent in this workspace.

**How to apply:** When a skill or guide says "use a fast cheap model" or "use the cheapest model that can do the job", read that as `sonnet`. Reserve `opus` for the few tasks where extra capability noticeably reduces failure rate (multi-file integration, novel architecture, code review of subtle logic).

## Git Commits

- Semantic prefix (feat, fix, refactor, docs, test, chore), 50-char subject max
- One logical change per commit — keep a feature with its test, split a feature from a drive-by refactor

## PR Reviews

Applies to **any PR review, any repo**. The local markdown file is the canonical deliverable; the GitHub review is a notification surface.

- **Never auto-post.** Posting to a PR (review body, top-level comment, inline comment, sub-agent posts) requires **explicit per-session user approval** — and even then, confirm the *form* (full / medium / specific finding) before posting. If a post happens without approval, delete it rather than edit it.
- **Local file is the deliverable.** Write the review to a local markdown file with the full structure (verdict, severity table, strengths, issues with file:line refs + suggested fixes, ground-truth verification appendix). This is what gets re-read, refined for round 2, and cited.
- **When approved to post, use the medium shape on GitHub:** Verdict + Severity table + Strengths (3–5 condensed bullets) + Issues (one short paragraph per finding — `file:line` + 2–3 sentences + suggested fix as prose, not a multi-line code block) + Recommendation + footer linking to the local file. Skip the ground-truth/verification appendix, file-read inventory, "couldn't verify" section, and multi-line suggested-fix code blocks. Never paste the whole local `review.md` into the GitHub body.
- **Single-finding code-block detail → inline comment.** If one finding genuinely needs a verbatim code-block suggested fix on GitHub (the author needs to apply the patch directly), post that one finding as a targeted inline review comment on the file/line, not by expanding the top-level body.
- **Editing after the fact:** if the posted body needs trimming, use `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/reviews/{review_id}` with a `{body: …}` payload — review state (APPROVED/COMMENT/CHANGES_REQUESTED) is preserved across edits.
- **Local file location:**
  - **defi-com repos** (`monorepo`, `contracts`, `azure-next-hybrid`): `~/defi/misc/reviews/review-PR-<num>.md`. See `~/.claude/projects/-home-xzat-defi-monorepo/memory/reference_pr_review_convention.md` for the mandatory header structure, `Reviewed:` SHA pin, and round-2 severity-row vocabulary.
  - **Other repos:** confirm a location with the user the first time, then stay consistent.

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
