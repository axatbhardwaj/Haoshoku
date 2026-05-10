# configs/claude/

Personal Claude Code configuration backed up from `~/.claude/`.

## What lives here vs. skills repo

| Content               | Source                     | Sync Method        | Deployed by        |
| --------------------- | -------------------------- | ------------------ | ------------------ |
| Personal config files | This directory             | Copied             | `--claude`         |
| `conventions/`        | This directory             | Copied             | `--claude`         |
| `output-styles/`      | This directory             | Copied             | `--claude`         |
| Skills                | axatbhardwaj/claude-skills | Symlinked          | `--skills`         |
| Agents                | axatbhardwaj/claude-skills | Symlinked          | `--skills`         |
| Superpowers plugin    | claude-plugins-official    | Settings.json edit | `--superpowers`    |

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
