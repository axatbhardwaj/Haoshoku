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

## Skill Manager Architecture

Runtime git cloning for Claude skills to support npm global install (submodules aren't shipped in packages).

**Separation**: skill_manager.js handles skill fetching/syncing; configure_claude.js handles personal config. Different responsibilities enable independent testing and maintenance.

**Cache Location**: XDG_CACHE_HOME/haoshoku/ follows XDG Base Directory spec, prevents home directory pollution.

**Symlinks**: Skills symlinked (not copied) to ~/.claude/skills/ for single source of truth - updates to cache immediately visible to Claude Code.

### Cache Structure

```
~/.haoshoku.json                    # Skill source configuration
    │
    ▼
$XDG_CACHE_HOME/haoshoku/          # Typically ~/.cache/haoshoku/
    ├── solatis-claude-config/      # Community skills
    └── user-custom-skills/         # User skills (optional)
    │
    ▼
~/.claude/skills/ → symlinks merged from cache (user priority)
```

### Priority Rules

- User skills in cache always take priority over community skills
- Skills merged by processing sources in config array order (user first)
- First occurrence of skill name wins (Set-based deduplication)
- ~/.claude/skills/ contains only symlinks, never copies

### Design Decisions

**Why XDG_CACHE_HOME**: Follows XDG spec for Linux cache data, prevents home directory pollution, user-specified preference.

**Why separate config file (~/.haoshoku.json)**: Environment variables are ephemeral and not portable across sessions. Dedicated file allows backup and version control.

**Why git clone --depth 1**: Full history not needed for skills. Shallow clones reduce bandwidth and disk usage.

**Why fetch+reset instead of pull**: Handles shallow clones and force-push scenarios (git pull fails for shallow repos without tracking branches).

**Why auto-sync on first --claude run**: Empty cache indicates first run. Auto-sync reduces setup friction for new users (npm global install workflow).

### Invariants

- Config must be valid JSON or defaults are used (forward compatibility)
- Skill directory must contain SKILL.md to be recognized (prevents false positives)
- Cache directories named by repo: {owner}-{repo} (e.g., solatis-claude-config)
- Skills dir is user-only permissions (0700) - may contain sensitive paths

### CLI Flags

- `--skills` - clone/sync skills from configured sources
- `--skills-update` - pull latest from all cached repos
- `--skills-list` - list available skills by source
