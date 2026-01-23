# configs/claude/

Personal Claude Code configuration backed up from `~/.claude/`.

## Distinction from claude-config/

| Directory       | Owner    | Purpose                          | Sync Method |
| --------------- | -------- | -------------------------------- | ----------- |
| `claude/`       | You      | Personal settings, rules         | Copied      |
| `claude-config/`| Submodule| Skills, agents from solatis repo | Symlinked   |

## Files

| File            | Destination             | Contains                              |
| --------------- | ----------------------- | ------------------------------------- |
| `claude.json`   | `~/.claude.json`        | Preferences, OAuth, feature flags     |
| `settings.json` | `~/.claude/settings.json`| Plugins, hooks, statusline config    |
| `CLAUDE.md`     | `~/.claude/CLAUDE.md`   | Personal rules and workflow instructions |

## Workflow

```bash
# Deploy config to ~/.claude/
haoshoku --claude

# Backup changes from ~/.claude/ to this directory
haoshoku --claude-backup
```

The `CLAUDE.md` in this directory is your personal rules file that Claude Code loads globally. It is NOT a navigation index for this directory.
