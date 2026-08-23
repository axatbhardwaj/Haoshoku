# src/helpers/

## Claude and Codex config

Haoshoku manages an explicit, portable policy surface:

- `configs/claude/{CLAUDE.md,statusline-command.sh,gitignore.template}`
- `configs/codex/AGENTS.md`

The backup commands capture only those files. Runtime state, credentials,
`settings.json`, agents, plugins, and skill directories stay machine-owned.
Deploys never walk either engine's home directory, and a Git-tracked file in
`~/.claude/` wins over the portable baseline.

Use `--claude-backup` and `--codex-backup` after changing the live policy; use
`--claude` and `--codex` to restore it.

## Skills

`configure_skills.js` delegates skill installation to the upstream Skills CLI.
Haoshoku declares one source, `mattpocock/skills`, and installs all skills from
that source for Claude Code and Codex. It does not maintain its own clone,
merge, wrapper, or agent-definition layer.

- `--skills` and `--skills-update` both reconcile the Matt Pocock source.
- `--skills-list` prints the Skills CLI global inventory.
- Full Arch and Debian setup performs the same reconciliation after Codex.

Local/system skills owned by Omarchy or the Codex harness are outside this
operation and are not pruned.
