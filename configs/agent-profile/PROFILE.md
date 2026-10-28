Hi, it's Axat Bhardwaj — a software engineer with 5+ years in the
industry, most of it in the web3 space, plus 2+ years building AI agents.

Preferences:

- Keep solutions and conversation simple and straightforward; never
  over-engineer. Design and write modular software with clean separation
  of concerns; follow KISS, YAGNI, and SOLID.
- Be as autonomous as possible; don't rely on human intervention unless
  absolutely necessary.
- Tools are there to help. If a tool fits the task, use it freely — don't ask
  first.
- Use Playwright MCP for browser navigation, inspection, interaction, and UI
  testing instead of T3 Code's built-in web browser. Keep T3 agent browser
  access disabled; do not use its `preview_*` browser tools or re-enable it
  unless I explicitly ask.
- Keep commits around 200 lines, use semantic commit messages, and prefer
  granular commits that are easy to recover or cherry-pick.
- Never request a review from a whole team. Request review only from the
  one specific person I name: no GitHub team reviewers (`org/team`), no
  bulk requests or re-requests to every collaborator. If a
  PR needs a human reviewer and I haven't named one, ask me who. Mass
  requests waste teammates' time and tokens (they end up reviewing PRs
  that are already reviewed or merged).

Platform: agents run on T3 Code; I drive them from the T3 app on
Android and desktop.

## Working with me

- I have ADHD. Format every reply to me so I can scan it fast:
  - Lead with the answer or outcome in one line.
  - Then short bullet points, one idea each; bold the key terms.
  - Use numbered lists for steps, questions and options; use a table
    when comparing things.
  - No walls of text: break up any paragraph longer than about three lines.
- My prompts are short, often typed on my phone. Read them for intent;
  confirm a name only when it is ambiguous.
- Answer a status ping ("sup", "what's left") in one screen: what runs and
  on which host, what it waits on and for whom, the next step, and links.
  Never stop silently; name the blocker in the same turn, to me or to the
  driver that dispatched you.
- Explain before asking me to decide. Number the questions, list each
  question's options as bullets, and put the recommended option first
  with its trade-off.
- When you make a visual, show it inline in the reply, not behind links.
- Include full PR, ticket, or comment URLs in every hand-off.
- Draft text for other people (team chat, PM, tickets) short, plain,
  specific and ready to paste; no markdown for chat. Label each question
  for the person who owns the answer.
- Before calling work done, verify it on the most real target your task
  allows (headed Playwright, staging, Sentry or Azure logs). Say what
  stays unverified.
- When a failure repeats, find its cause and fix the class, not just this
  instance; if the fix is outside your task, report it.

## Orchestration

Every subagent, delegated worker, reviewer, or cross-harness dispatch (Claude,
Codex, or any other agent) goes through T3 Code orchestration (the `t3-code`
MCP: `delegate_task`, `t3_thread_launch`, schedules) so all agent work is
visible and tracked in T3. The driver is a T3 thread. Do not use a harness's
native subagent tools (Claude Agent tool, Codex spawn, etc.) for delegated work.

## axnet

The fleet is io (PC), iobook (laptop), iobox (always-on agent box running
T3 Code), iosatellite (planned Omarchy laptop worker, Dell Inspiron 7570),
and axat-vps (Debian VPS running Executor and Hermes). Access is
Tailscale-only: use MagicDNS short names, for example `ssh iobox` or
`ssh axat-vps` (and `ssh iosatellite` after provisioning). Hosts SSH to each other by short name using Tailscale SSH
on Arch hosts and OpenSSH to axat-vps.

Roles:

- io = control center (may work locally or hand work to the workers).
- iobook and my phone = access points (keep me informed and let me steer; no real work).
- iobox, iosatellite and axat-vps = workers (do the work locally and never hand work to another host).
  Subagents and reviewers via T3 on the same host are fine.

Agents may SSH to any fleet host and act there. Accepted risk: one compromised
agent can reach every fleet host. On iobox, use the 1Password `op` CLI with the
service-account token inherited by T3 from `~/.config/op/service-account.env`.
Never copy keys or tokens into the repository or logs. iosatellite uses the same
optional existing `op` env wiring once provisioned; no token is assumed present.
It runs locally, always awake even on battery, including with the lid closed on AC.
The profile is planned/unprovisioned until local setup and real closed-lid AC
job, SSH and T3 checks pass; credentials, ACLs and timers are not preinstalled.

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

Axstack releases reinstall and verify on all four hosts: io (`xzat@io`),
iobook, axat-vps, and iobox (`xzat@iobox`). Each host also runs the
`axstack-default-sync` timer with the pool drop-in. Keep verification on all four
existing hosts mandatory. After iosatellite is provisioned, include `xzat@iosatellite`
in release reinstall/verification and verify its timer and pool drop-in; until then
record it as planned, not verified.

## Merging and tooling (set 2026-10-23)

- Merge my own PRs as soon as CI is green and review findings are
  addressed. Never wait for my or anyone's approval, never re-request
  review, and never hand the merge to me. Stop at merge-ready only when
  the diff touches migrations, auth, secrets, money paths or prod config,
  and tell me why.
- When I correct the same thing twice, write it here as one rule that day.

## Holds

When a run you drive parks on my decision or hits a serious risk, state the
hold in its T3 thread (what you need, PR URL, where to act) and park there.
Send no Telegram or Hermes alerts. My scheduled sweep thread on axat-vps,
"Review GitHub and Linear Activity" (T3 thread
`bb239085-f3d0-4fef-810a-7bb408852333`), checks periodically for reviews and
holds blocked on me.

## T3 provider settings

Subscriptions are pooled through the CLIProxyAPI hub on axat-vps
(`https://axat-vps.tail140c22.ts.net:8317`); each host has one `claudeAgent`
and one `codex` pool instance. Never print the hub client or management key.
After changing T3 provider settings (`~/.t3/userdata/settings.json`
providerInstances) or account homes (`~/.codex-alt`, `~/.claude-alt`), run
`t3-provider-fix` (in `~/.local/bin`; `--dry-run` to preview). Use absolute
real binaries for `binaryPath`, never bare names or `~/.local/bin` mise
wrappers. Never leave real files or backups inside a Codex shadow home except
`auth.json`.
