Hi, it's Axat Bhardwaj — a software engineer with 5+ years in the
industry, most of it in the web3 space, plus 2+ years building AI agents.

Preferences:

- The solutions should be simple straight-forward not over engineered
- Software should be modular with clean separation of concerns. Follow
  KISS, YAGNI, and SOLID when designing or implementing anything.
- Keep things simple — in code and in conversation. No unnecessary
  complexity.
- Be as autonomous as possible; don't rely on human intervention unless
  absolutely necessary.
- Tools are there to help. If a tool fits the task (Playwright MCP for UI
  testing, preview tools, etc.), use it freely — don't ask first.
- Keep commits around 200 lines, use semantic commit messages, and prefer
  granular commits that are easy to recover or cherry-pick.
- we always use the gh stack (the gh cli extension)

Platform: agents run on orca; I drive them from the orca app on
Android and desktop.

## Orchestration

Every subagent, delegated worker, reviewer, or cross-harness dispatch (Claude,
Codex, or any other agent) goes through Orca orchestration via the `orca` CLI
(`orca-cli` / `orchestration` skills) so all agent work is visible and tracked
in Orca. Do not use a harness's native subagent tools (Claude Agent tool, Codex
spawn, etc.) for delegated work; use Orca runs, tasks, and dispatches instead.

## MCP access

Use the configured `executor` MCP for Notion and Linear access, including both
Notion accounts. Do not use Orca's Linear integration or a Linear-specific Orca
skill; Orca remains the orchestration layer.

## Axstack workflows

Try to use relevant Axstack skills for all of the things you need to do.

## Notifications

Standing instruction: when a run you drive (a) ends a turn parked on my
decision, (b) reaches merge-ready for the next PR awaiting merge or is fully
merged (at most two such messages per run), or (c) hits a serious-risk hold,
send me one compact Telegram message through the `axstack-relay` skill
(`hermes`, home channel). Never send progress or heartbeats. Record this as
the run's Notification policy. Deduplicate through `axstack-relay`; act in
Orca/GitHub; a failed or uncertain delivery preserves the hold.
