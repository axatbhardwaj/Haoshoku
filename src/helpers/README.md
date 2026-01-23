# src/helpers/

## Claude Config Architecture

The Claude configuration uses a hybrid sync pattern:

**Symlinked (from submodule):** `agents/`, `skills/`, `output-styles/`, `conventions/`
- Source: `configs/claude-config/` (external repo)
- Updates propagate automatically after `git submodule update --remote`

**Copied (personal config):** `claude.json`, `settings.json`, `CLAUDE.md`
- Source: `configs/claude/`
- User-owned, backed up via `--claude-backup`

## Functions

| Function                 | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `syncClaudeConfig()`     | Copy personal + symlink submodule dirs       |
| `backupClaudeConfig()`   | Copy ~/.claude/ personal files to configs/   |
| `updateClaudeSubmodule()`| Pull latest from submodule remote            |
| `installClaude()`        | Install Claude Code CLI if not present       |
| `configureClaude()`      | Install + sync (used by OS setup scripts)    |

## CLI Flags

- `--claude` - sync only
- `--claude-backup` - backup personal config
- `--claude-update` - update submodule + sync
