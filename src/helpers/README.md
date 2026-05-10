# src/helpers/

## Claude Config Architecture

The Claude configuration uses a hybrid sync pattern:

**Copied from haoshoku template (`configs/claude/`):**
- `claude.json`, `settings.json`, `CLAUDE.md` — personal config
- `conventions/`, `output-styles/` — managed directories (replaced on sync)
- Updates via `--claude-backup` (capture) and `--claude` (deploy)

**Symlinked from cache:** `agents/`, `skills/`
- Source: `~/.cache/haoshoku/{owner}-{repo}/` (runtime git clone)
- Updates via `--skills` or `--skills-update`

## Functions

| Function                 | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `syncClaudeConfig()`     | Copy personal files + managed dirs from template |
| `backupClaudeConfig()`   | Copy ~/.claude/ personal files + managed dirs to template |
| `updateClaudeConfig()`   | Pull latest from cached repos                |
| `installClaude()`        | Install Claude Code CLI if not present       |
| `installSuperpowers()`   | Enable Superpowers plugin in settings.json   |
| `configureClaude()`      | Install + sync (used by OS setup scripts)    |

## CLI Flags

- `--claude` - deploy personal config + conventions + output-styles
- `--claude-backup` - backup personal config + conventions + output-styles
- `--claude-update` - update cache + sync
- `--superpowers` - enable Superpowers plugin in settings.json

## Skill Manager Architecture

Runtime git cloning for Claude skills and agents.

**Separation**: skill_manager.js handles skill/agent fetching and syncing; configure_claude.js handles personal config and managed directories. Different responsibilities enable independent testing and maintenance.

**Cache Location**: XDG_CACHE_HOME/haoshoku/ follows XDG Base Directory spec, prevents home directory pollution.

**Symlinks**: Skills and agents symlinked (not copied) to ~/.claude/ for single source of truth — updates to cache immediately visible to Claude Code.

### Cache Structure

```
~/.haoshoku.json                    # Skill source configuration
    │
    ▼
$XDG_CACHE_HOME/haoshoku/          # Typically ~/.cache/haoshoku/
    └── axatbhardwaj-claude-skills/ # Skills + agents
    │
    ▼
~/.claude/skills/ → symlinks merged from cache
~/.claude/agents/ → symlinks merged from cache
```

### Priority Rules

- Sources processed in config array order (first wins)
- First occurrence of skill/agent name wins (Set-based deduplication)
- ~/.claude/skills/ and ~/.claude/agents/ contain only symlinks, never copies

### Design Decisions

**Why XDG_CACHE_HOME**: Follows XDG spec for Linux cache data, prevents home directory pollution, user-specified preference.

**Why separate config file (~/.haoshoku.json)**: Environment variables are ephemeral and not portable across sessions. Dedicated file allows backup and version control.

**Why git clone --depth 1**: Full history not needed for skills. Shallow clones reduce bandwidth and disk usage.

**Why fetch+reset instead of pull**: Handles shallow clones and force-push scenarios (git pull fails for shallow repos without tracking branches).

**Why auto-sync on first --claude run**: Empty cache indicates first run. Auto-sync reduces setup friction for new users (npm global install workflow).

### Invariants

- Config must be valid JSON or defaults are used (forward compatibility)
- Skill directory must contain SKILL.md to be recognized (prevents false positives)
- Cache directories named by repo: {owner}-{repo} (e.g., axatbhardwaj-claude-skills)
- Skills dir is user-only permissions (0700) — may contain sensitive paths

### CLI Flags

- `--skills` - clone/sync skills and agents from configured sources
- `--skills-update` - pull latest from all cached repos
- `--skills-list` - list available skills by source
