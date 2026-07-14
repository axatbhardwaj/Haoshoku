# Global principles — always true. Task-specific procedure lives in skills, agents, and commands.

## Autonomous Execution

Pre-authorized — proceed without asking:
- Bug reports: diagnose and fix end-to-end (`superpowers:systematic-debugging`)
- Failing CI: read logs, find cause, fix
- PR review comments: address them (`superpowers:receiving-code-review`)
- "Check now" / "try now" / "do it": re-evaluate current state and act

Still confirm: force-push, branch deletion, dependency removal, schema changes, anything touching shared infra.
"Do not try to fix it just yet" means investigate only.

## Code Discipline

- **Surface, don't assume.** State assumptions; present competing interpretations instead of picking silently; if a simpler approach exists than what was asked, say so before building. This governs *how* you proceed, not whether.
- **Simplicity first.** Minimum code that solves the problem — no unrequested features, abstractions, or configurability. "Would a senior engineer call this overcomplicated?" — if yes, rewrite before presenting.
- **Surgical diffs.** Touch only what the request requires; no improving adjacent code; match existing style. Remove orphans YOUR change created; pre-existing dead code gets mentioned, not deleted. Every changed line traces to the request.

## Verification That Counts

- Run the test that motivated the change, not just the full suite. UI: verify visually in a real browser. Infra: verify the deployment took effect — exit code 0 is not proof.
- **Worker output is untrusted input.** A diff from any headless lane (Codex, Grok) is unverified until I inspect the actual `git diff` and rerun the relevant verification myself. A worker's "done" claim earns nothing.
- "Would a staff engineer approve this?" — if no, iterate before presenting.

## External Lookups

Training data is stale. Before quoting a version, API, feature, or flag: verify. `grok -p "<question>"` (read-only: `--disallowed-tools`, never `--yolo`) is a first-class, often fastest lookup tool — treat results as leads, confirm load-bearing facts against the primary source. context7 MCP for SDK docs. Never "latest X" from memory. Lookup burn on grok is cheap relative to value — don't ration it.

## Model Routing (conclusions — evidence and full table in the `model-router` skill)

- Codex default implementation model: **terra**. **luna** only for short-context mechanical/terminal bulk. Escalate to **sol** for hard or long-horizon execution.
- Claude-family for judgment, subtle review, and taste-sensitive output. Anything user-facing ships only after a taste-strong pass (sonnet-5/opus-4.8/fable-5). Never haiku; sonnet is the floor for code-touching subagents.
- **When this session is chaired by fable:** fable never writes code, and never burns its scarce quota on mechanical execution — dispatch every implementation, test, fix, and low-judgment tool-driving task (browser automation like Playwright / claude-in-chrome, MCP interactions, log/data digging) to **opus** as the default extension (opus is fable's hands); sonnet for lighter support. Fable does planning, judgment, review, taste, and coordination only.
- Grok: real-time research lane, prose first drafts (never ships raw), and disjoint parallel bulk — never review or adjudication stations.
- Standing bias: implementation volume ~60/40 Codex/Claude. Advisory, not per-task bookkeeping. Standing permission to escalate models when output misses the bar.

## Execution Lanes

- Codex is the default implementation lane: clear-scope coding, tests, mechanical refactors, migrations, log/data work. **All Codex calls — implementation and read-only review — go through the `codex-wrapper` agent** (the delegation names `mode: implementation | review`); never raw `codex exec` from the chair. Implementation dispatches require a clean worktree; the launcher blocks dirty trees rather than guessing change attribution.
- Every worker receives explicit scope, acceptance criteria, prohibited changes, verification commands, and the expected output shape. Codex has none of this session's context; the delegation prompt must be self-contained.
- Concurrent workers require disjoint write scopes or separate worktrees. File-scope conflict between lanes is an orchestration bug, not a merge problem.
- **TDD ownership:** I define required behavior, acceptance criteria, and expected red/green evidence; the worker executes the red-green cycle in its scope and reports exact red and green commands and results; I inspect test quality and independently rerun final verification. I do not author every failing test before dispatch.
- Headless workers execute *inside* Superpowers gates, never around them. A worker lane is a pair of hands, not an exit from the discipline.

## Review Policy (tiered)

- **Normal:** I plan and dispatch → Codex implements and tests → I inspect the diff and verify → done. My inspection is the credited cross-vendor review for Codex-authored work.
- **Medium:** add one fix round — I review, Codex fixes confirmed findings once, I verify.
- **High-assurance ring** (fable plans → sol plan-review → terra/sol executes → opus deep-review → fable adjudicates) only for: smart contracts / fund movement, authn/authz, cryptographic logic, schema or data migrations, shared infra, novel architecture, large cross-cutting changes.
- Nobody reviews their own vendor's work: fresh Opus review for high-risk or large Codex diffs; a `codex-wrapper` review-mode dispatch (read-only by launcher construction) for non-trivial Claude-authored diffs.
- Correction loops cap at 2 rounds; then surface the disagreement or reconsider scope. Reviewers are always read-only.

## Superpowers Gates

Superpowers is the execution framework. Skip routing only for throwaway one-liners, `~/.claude/` edits, pure factual questions, sub-30-second tweaks.
- New feature or behavior change → `superpowers:brainstorming` before any creative work
- Multi-step task with a spec → `superpowers:writing-plans` (dark HTML to `./superpowers/plans/`)
- Implementation → `superpowers:test-driven-development`; executing a plan → `superpowers:subagent-driven-development` (dispatch per Execution Lanes) or `superpowers:executing-plans`; independent tasks → `superpowers:dispatching-parallel-agents`; isolation → `superpowers:using-git-worktrees`
- Any bug or unexpected behavior → `superpowers:systematic-debugging` before proposing fixes
- Before claiming done/fixed/passing → `superpowers:verification-before-completion`; finishing → `superpowers:finishing-a-development-branch`; review → `superpowers:requesting-code-review` / `superpowers:receiving-code-review`; skill edits → `superpowers:writing-skills`
- Gates are rules, not suggestions. Re-check before any code-modifying Edit/Write; "simple change, manually verified" is the rationalization the gate exists to override.

## Todos

Create tasks for multi-step, parallel, long-running, or cross-session work; update statuses live; never end a turn with stale pending todos. Skip task ceremony for a single obvious action. Keep lists coarse — outcomes, not one task per procedural checklist item.

## Working Artifacts

No tracked working artifacts — plans and specs are alignment tools, not deliverables; the PR description and commits carry the rationale. Sanctioned gitignored locations:
1. `BRANCH-NOTES.md` at the worktree root — dated session-end lines; read first on session start; prune past one screen.
2. `~/ACTIVE-WORK.md` — one ~25-word line per active branch; remove entries when merged/closed.
3. `./superpowers/` at the repo root — planning-skill output as dark HTML (`specs/`, `plans/`, `research/`).

These paths are ignored via the **global** git excludes file (`git config --global core.excludesFile`), never by editing each repo's `.gitignore`. If prior specs/plans are committed somewhere, surface them and propose migration — never auto-`git rm`.

## Deliverables

Any document produced for a human to read — specs, plans, research, reports, audits, PR reviews — is a single self-contained dark-mode HTML file, authored via the `html-deliverables` skill (`~/.claude/skills/html-deliverables/` owns the full quality contract: dark tokens, diagrams-over-prose, interactivity, offline `file://`). Conversation replies stay plain text. Machine-read files stay plain text: `BRANCH-NOTES.md`, `~/ACTIVE-WORK.md`, memory files, this file, commit messages, anything posted to GitHub or Linear.

## Git

- Commits: semantic prefix (feat/fix/refactor/docs/test/chore), 50-char subject, one logical change per commit.
- Identity: never use the auto-injected `# userEmail` (Anthropic account email) as git identity; global git config holds the real identity. Flag any unexpected repo-local `user.email` override; don't modify author identity unless explicitly asked.
- Worktrees: siblings of the main repo. Know which worktree and branch you're in. New worktree: identify which env files the task actually needs, confirm each is ignored, copy/symlink only those, never print their contents. "Bring changes here" = cherry-pick or merge, not switching worktrees.

## PR Reviews

Never auto-post anything to a PR — posting requires explicit per-session approval, and confirm the form before posting. Full procedure (local canonical HTML review, GitHub medium shape, editing mechanics) lives in the `pr-review` skill.
