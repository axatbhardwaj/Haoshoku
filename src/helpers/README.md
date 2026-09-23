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
Haoshoku declares `mattpocock/skills` and `getpaseo/paseo` as external sources
for Claude Code and Codex. The new source uses `bunx skills@latest ... -y`;
Haoshoku does not maintain its own clone or wrapper.

- `--skills` and `--skills-update` reconcile both external sources.
- `--skills-list` prints the Skills CLI global inventory.
- Full Arch and Debian setup performs the same reconciliation after Codex.

`configure_agent_skills.js` separately syncs three Haoshoku-owned orchestration
skills plus the pinned upstream `visual-explainer`, with portable Claude/Codex
links for both sets. Backup writes only the three owned skills; other
local/system skills are not pruned.

## Headless Paseo

`configure_paseo_server.js` owns the Debian native Paseo CLI, fresh config,
systemd user service, persistence checks, managed-process verification, and
optional interactive relay pairing. It deliberately does not install provider
CLIs. `configure_paseo_profiles.js` separately performs whitelist-only policy
merge/backup and reloads only a running daemon for the exact target home.
