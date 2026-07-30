# configs/claude/

Claude Code configuration deployed to `~/.claude/`.

## Deploy surface

| Source                    | Destination                       | Deployment |
| ------------------------- | --------------------------------- | ---------- |
| `CLAUDE.md`               | `~/.claude/CLAUDE.md`             | Copied     |
| `statusline-command.sh`   | `~/.claude/statusline-command.sh` | Copied     |
| `gitignore.template`      | `~/.claude/.gitignore`            | Copied     |
| `agents/`                 | `~/.claude/agents/`               | Merged     |
| `workflows/`              | `~/.claude/workflows/`            | Merged     |

`haoshoku --claude` copies the three files and merge-deploys only the
bundle-listed entries under `agents/` and `workflows/`. Unrelated live entries
in those directories are preserved.

Skills are managed separately from this bundle. Use `haoshoku --skills` to
sync configured skill sources and link their skills and non-shadowed agents
from the cache.

## Workflow

```bash
# Deploy the bundled Claude configuration
haoshoku --claude

# Back up the same files and merge-managed directories
haoshoku --claude-backup

# Sync skills and externally sourced agents separately
haoshoku --skills
```

Backups skip symlinks and refuse files that contain literal absolute home paths,
preventing private machine paths from entering the public bundle.
