# src/helpers/

## Claude Config Architecture

The Claude configuration uses a hybrid sync pattern:

**Copied from haoshoku template (`configs/claude/`):**
- `CLAUDE.md`, `statusline-command.sh`, `.gitignore` — personal config
- `agents/`, `workflows/` — co-owned directories (bundle-listed paths are merge-deployed; unrelated live paths are preserved)
- Updates via `--claude-backup` (capture) and `--claude` (deploy)

**Symlinked from cache:** `skills/` and non-shadowed agent files
- Source: `~/.cache/haoshoku/{owner}-{repo}/` (runtime git clone)
- Updates via `--skills` or `--skills-update`

## Functions

| Function                 | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `syncClaudeConfig()`     | Copy personal files and merge-deploy co-owned dirs |
| `backupClaudeConfig()`   | Copy personal files and co-owned dirs to template |
| `updateClaudeConfig()`   | Pull latest from cached repos                |
| `installClaude()`        | Install Claude Code CLI if not present       |
| `installSuperpowers()`   | Enable Superpowers plugin in settings.json   |
| `configureClaude()`      | Install + sync (used by OS setup scripts)    |

## CLI Flags

- `--claude` - deploy personal config and merge-deploy bundled agents/workflows
- `--claude-backup` - backup personal config and co-owned agents/workflows while skipping symlinks
- `--claude-update` - update cache + sync
- `--superpowers` - enable Superpowers plugin in settings.json

## Skill Manager Architecture

Runtime git cloning for Claude skills and agents.

**Separation**: skill_manager.js handles skill/agent fetching and syncing; configure_claude.js handles personal config and merge-deployed bundle entries. Different responsibilities enable independent testing and maintenance.

**Cache Location**: XDG_CACHE_HOME/haoshoku/ follows XDG Base Directory spec, prevents home directory pollution.

**Symlinks**: Skills are symlinked to `~/.claude/skills/`. Agents are symlinked into `~/.claude/agents/` unless a real local or merge-deployed file with the same name shadows the cached agent.

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
~/.claude/agents/ → merge-deployed/local files + non-shadowed cache symlinks
```

### Priority Rules

- Sources processed in config array order (first wins)
- First occurrence of skill/agent name wins (Set-based deduplication)
- ~/.claude/skills/ contains symlinks; ~/.claude/agents/ may also contain local or merge-deployed real files

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
