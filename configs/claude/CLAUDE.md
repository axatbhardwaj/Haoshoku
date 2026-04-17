## Task Routing

GSD is the default execution framework for code work. The routing decision is the highest-leverage moment of the task — pick deliberately.

**Skip GSD for:** throwaway scripts, edits to `~/.claude/` itself, pure questions, sub-30-second config tweaks.

### Picking work back up

`/gsd-progress` — situational awareness + auto-routes to the right next step. Default opener after a context reset or when the user asks "what's next?" Falls back to `/gsd-do <freeform intent>` when you can't name the right skill.

### Doing the work

- Trivial edit (rename, flag flip, typo) → `/gsd-fast` — no state file, no commit log
- Code task with a known approach → `/gsd-quick` — add `--research` (unfamiliar library), `--discuss` (ambiguous scope), `--validate` (high-stakes), `--full` (all three)
- Bug, failing CI, unexpected behavior → `/gsd-debug`
- Architectural brainstorm, no phase yet → `/gsd-explore`
- Need to understand an unfamiliar codebase → `/gsd-map-codebase`
- Multi-phase feature or migration → phase workflow (below)
- Append a phase to current milestone → `/gsd-add-phase`
- Urgent patch between existing phases → `/gsd-insert-phase` (decimal numbering)
- Run all remaining phases hands-off → `/gsd-autonomous`
- Setup → `/gsd-new-project` · `/gsd-new-milestone` · `/gsd-complete-milestone`

### Phase workflow (per phase)

`/gsd-discuss-phase` → `/gsd-plan-phase` → `/gsd-review` (cross-AI peer review of plan) → `/gsd-execute-phase` → `/gsd-verify-work` → `/gsd-secure-phase` → `/gsd-code-review` → `/gsd-code-review-fix` → `/gsd-pr-branch` → `/gsd-ship`

Frontend phases also use `/gsd-ui-phase` after plan and `/gsd-ui-review` after execute.

### Capture an idea without breaking flow

`/gsd-add-todo <text>` for actionable items · `/gsd-add-backlog` for the 999.x parking lot.

### Escape hatches

- Pause mid-phase → `/gsd-pause-work` (writes context handoff)
- Resume from `.continue-here.md` specifically → `/gsd-resume-work` (otherwise `/gsd-progress`)
- Roll back a phase or plan commit → `/gsd-undo` (dependency-checked)
- Completed phase has gaps → `/gsd-validate-phase` (functional) · `/gsd-audit-uat` (cross-phase)
- Investigate a failed GSD workflow → `/gsd-forensics`

### When tempted to pick X, pick Y instead

| Tempted | Pick instead | When |
|---|---|---|
| `/gsd-fast` | `/gsd-quick` | change needs state tracking or atomic commit log |
| `/gsd-explore` | `/gsd-discuss-phase` | already inside an active phase |
| `/gsd-add-phase` | `/gsd-insert-phase` | the new work needs to land between existing phases (e.g. 72.1) |
| `/gsd-resume-work` | `/gsd-progress` | not actually mid-checkpoint; you just want "where do we stand" |

## Worktree Awareness

- Worktrees are sibling directories of the main repo (e.g. `monorepo-DEF-573` next to `monorepo`)
- New worktree: copy `.env` files and re-check `.gitignore` — they don't carry over. Dependencies may need reinstalling.
- Always know which worktree you're in and what branch it tracks.
- "Bring changes to this worktree" → cherry-pick or merge. Don't suggest switching worktrees as the fix.

## Autonomous Execution

The following are pre-authorized — proceed without asking:
- Bug reports: diagnose and fix end-to-end
- Failing CI: read the logs, find the cause, fix it
- PR review comments: address them
- "Check now" / "try now" / "do it": re-evaluate current state and act

Still confirm for: force-push, branch deletion, dependency removal, schema changes, anything touching shared infra.

When told "do not try to fix it just yet" — comply. Investigate only.

## Verification That Counts

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

If the user references a prior decision ("we discussed phase 7 for this"), check `.planning/` artifacts before asking them to repeat themselves.

## Git Commits

- Semantic prefix (feat, fix, refactor, docs, test, chore), 50-char subject max
- One logical change per commit — keep a feature with its test, split a feature from a drive-by refactor
- Never commit `.planning/`, GSD artifacts, or workflow docs to a project repo — local orchestration state, not source
