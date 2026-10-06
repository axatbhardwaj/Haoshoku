# src/helpers/

## Claude and Codex config

Haoshoku manages an explicit, portable policy surface:

- `configs/claude/{CLAUDE.md,statusline-command.sh,gitignore.template}`
- `configs/codex/AGENTS.md` and `configs/codex/status-line.toml`

The Codex status-line file contains only `tui.status_line`. `--codex` merges
that value into `~/.codex/config.toml`, preserving other settings and keeping a
private rollback copy before a change. `--codex-backup` exports only that value,
not the full live config. Invalid or ambiguous TOML stops the merge.

The backup commands capture only those files. Runtime state, credentials,
`settings.json`, agents, plugins, and skill directories stay machine-owned.
Deploys never walk either engine's home directory, and a Git-tracked file in
`~/.claude/` wins over the portable baseline.

Use `--claude-backup` and `--codex-backup` after changing the live policy; use
`--claude` and `--codex` to restore it.

## Skills

`configure_skills.js` delegates skill installation to the upstream Skills CLI.
Haoshoku installs `mattpocock/skills` for Claude Code and Codex; it does not
maintain its own clone or wrapper.

- `--skills` and `--skills-update` reconcile the Matt Pocock source.
- `--skills-list` prints the Skills CLI global inventory.
- Full Arch and Debian setup performs the same reconciliation after Codex.

`configure_agent_skills.js` separately syncs the pinned upstream
`visual-explainer` with portable Claude/Codex links. It archives retired bundled
skills and removes only their managed links. Agent-specific real directories,
non-managed links, and other local/system skills are preserved. Routing and
review policy are managed by Axstack; agent-skill backup is no longer supported.

## Headless T3 Code

`configure_t3_code_server.js` owns the required Debian nightly T3 Code service
over Tailscale. It checks the CLI floor, disables existing Connect exposure,
writes the account's service drop-ins, and verifies service and tailnet HTTPS
readiness. Tailscale login, provider authentication, and phone pairing remain
manual prerequisites or follow-up steps. `configure_hermes_relay.js` verifies
Hermes Telegram transport without deploying a relay plugin.

See the [migration note](../../README.md#existing-host-migration) for host artifacts
that Haoshoku leaves for manual retirement.
