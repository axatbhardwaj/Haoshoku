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

Platform: agents run on T3 Code; I drive them from the T3 app on
Android and desktop.

## Orchestration

Every subagent, delegated worker, reviewer, or cross-harness dispatch (Claude,
Codex, or any other agent) goes through T3 Code orchestration (the `t3-code`
MCP: `delegate_task`, `t3_thread_launch`, schedules) so all agent work is
visible and tracked in T3. The driver is a T3 thread. Do not use a harness's
native subagent tools (Claude Agent tool, Codex spawn, etc.) for delegated work.

## axnet

Roles:

- io = control center (may work or delegate to workers).
- iobook and the phone = access points (keep the user informed, no real work).
- iobox and axat-vps = workers (do the work, never delegate).

The fleet is io (PC), iobook (laptop), iobox (always-on agent box running
T3 Code), and axat-vps (Debian VPS running Executor and Hermes). Access is
Tailscale-only: use MagicDNS short names, for example `ssh iobox` or
`ssh axat-vps`. Hosts SSH to each other by short name using Tailscale SSH
on Arch hosts and OpenSSH to axat-vps.

Agents may SSH to any fleet host and act there. Accepted risk: one compromised
agent can reach every fleet host. On iobox, use the 1Password `op` CLI with the
service-account token inherited by T3 from `~/.config/op/service-account.env`.
Never copy keys or tokens into the repository or logs.

## MCP access

Use the configured `executor` MCP for Notion and Linear access, including both
Notion accounts. `executor` is our self-hosted Executor on axat-vps
(https://axat-vps.tail140c22.ts.net/mcp, tailnet-only via Tailscale Serve, API-key auth); all
tool policies are allow-all, so never ask before using its tools. Do not use any other Linear integration; T3 Code is the
orchestration layer.

Use Linear only for repositories in the `defi-com` GitHub organization.
Keep specs for other repositories on GitHub. If the right GitHub location
(issue, PR, or repo file) is unclear, ask me before creating a planning
artifact. Do not create or update Linear items for those repositories.

## Axstack workflows

Try to use relevant Axstack skills for all of the things you need to do.

## Notifications

Standing instruction: when a run you drive (a) ends a turn parked on my
decision, (b) reaches merge-ready for the next PR awaiting merge or is fully
merged (at most two such messages per run), or (c) hits a serious-risk hold,
send me one compact Telegram message through the `axstack-relay` skill
(`hermes`, home channel). Never send progress or heartbeats. Record this as
the run's Notification policy. Deduplicate through `axstack-relay`; act in
the T3 driver thread/GitHub; a failed or uncertain delivery preserves the hold.
