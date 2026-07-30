# src/helpers/

## Claude Config Architecture

The Claude configuration has deliberately separate ownership paths:

**Copied from haoshoku template (`configs/claude/`):**
- `CLAUDE.md`, `statusline-command.sh`, `.gitignore` — personal config
- Updates via `--claude-backup` (capture) and `--claude` (deploy)
- No directory walker: `agents/` and `workflows/` are never read or written

**Symlinked from cache:** `skills/` and non-shadowed agent files
- Source: `~/.cache/haoshoku/{owner}-{repo}/` (runtime git clone)
- Updates via `--skills` or `--skills-update`

**Cloned separately into `~/.claude/`:** private executable policy
- A private policy repository the user owns supplies the live policy checkout
- This public installer deliberately cannot discover or fetch it
- A fresh machine therefore needs that separate bootstrap after the three-file deploy

## Functions

| Function                 | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `syncClaudeConfig()`     | Copy the three personal files into `~/.claude/`     |
| `backupClaudeConfig()`   | Guard and copy the same three files to the template |
| `updateClaudeConfig()`   | Pull latest from cached repos                       |
| `installClaude()`        | Install Claude Code CLI if not present              |
| `installSuperpowers()`   | Enable Superpowers plugin in settings.json          |
| `configureClaude()`      | Install + sync (used by OS setup scripts)           |

## CLI Flags

- `--claude` - deploy `CLAUDE.md`, the statusline, and `.gitignore`
- `--claude-backup` - back up those three personal files through the home-path refusal guard
- `--claude-update` - update cache + sync
- `--superpowers` - enable Superpowers plugin in settings.json

## Skill Manager Architecture

Runtime git cloning for Claude skills and agents.

**Separation**: `skill_manager.js` handles cache-backed skill/agent fetching and syncing; `configure_claude.js` handles only the three personal files. The separately cloned private policy repository owns executable policy.

**Cache Location**: XDG_CACHE_HOME/haoshoku/ follows XDG Base Directory spec, prevents home directory pollution.

**Symlinks**: Skills are symlinked to `~/.claude/skills/`. Agents are symlinked into `~/.claude/agents/` unless a real local file with the same name shadows the cached agent.

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
~/.claude/agents/ → private/local files + non-shadowed cache symlinks
```

### Priority Rules

- Sources processed in config array order (first wins)
- First occurrence of skill/agent name wins (Set-based deduplication)
- ~/.claude/skills/ contains symlinks; ~/.claude/agents/ may also contain real files from the private policy checkout

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
