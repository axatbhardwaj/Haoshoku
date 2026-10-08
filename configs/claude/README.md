# configs/claude/

Portable Claude Code personal-policy bundle deployed to `~/.claude/`.

## Managed surface

| Bundle source | Live destination | Direction |
| --- | --- | --- |
| `CLAUDE.md` | `~/.claude/CLAUDE.md` | Both |
| `statusline-command.sh` | `~/.claude/statusline-command.sh` | Both |
| `gitignore.template` | `~/.claude/.gitignore` | Both |

`haoshoku --claude` and `haoshoku --claude-backup` use only this manifest.
They never walk runtime directories or import `settings.json`, credentials,
plugins, agents, sessions, or skills. Backup refuses a managed file containing
a literal absolute home path so the public package cannot capture a private
machine path.

If `~/.claude/` is a Git repository rooted at that exact directory, deploy
skips destinations tracked by its index. An untracked destination is copied
with the normal first-capture and versioned-backup safeguards.

Independent skills are managed separately. Haoshoku no longer installs Matt
Pocock skills or visual-explainer; default setup leaves existing skills and
links intact. Use `haoshoku --axstack` for Axstack workflows.

Haoshoku does not deploy custom agent definitions, wrapper launchers, private
policy repositories, or bundled standalone skills.
