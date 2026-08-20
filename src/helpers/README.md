# src/helpers/

`configure_omarchy_workspaces.js` deploys the behavior-only Hyprland overlay
and its fixed-recipe Bash helper, then adds one idempotent source line to the
user's `hyprland.conf`. It never edits `~/.local/share/omarchy/`.

`configure_omazed.js` prepares the user's existing Zed settings safely before
running packaged `omazed setup`, then retires only Haoshoku's former Caelestia
theme. It backs up changed settings and rolls them back if setup fails; the
upstream manual installer is intentionally never used.

## Claude Config Architecture

The Claude configuration has deliberately separate ownership paths:

**Copied from haoshoku template (`configs/claude/`):**
- `CLAUDE.md`, `statusline-command.sh`, `.gitignore` — personal config
- Updates via `--claude-backup` (capture) and `--claude` (deploy)
- No directory walker: only the explicit portable-baseline manifest is read or written

**Symlinked from cache:** skills only
- Source: `~/.cache/haoshoku/{owner}-{repo}/` (runtime git clone)
- Updates via `--skills` or `--skills-update`

**Bootstrapped separately inside `~/.claude/`:** private policy
- A private policy repository the user owns supplies the live policy checkout
- The policy is not bundled; `--claude-bootstrap` fetches the configured repository
- A fresh machine can deploy the portable three-file baseline before optional private bootstrap

Private policy comes from a repository the user owns; follow the [canonical in-place bootstrap procedure](../../configs/claude/README.md#private-policy-bootstrap).

## Functions

| Function                 | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `syncClaudeConfig()`     | Copy the portable baseline into `~/.claude/`        |
| `backupClaudeConfig()`   | Guard and copy that manifest to the template        |
| `installClaude()`        | Install Claude Code CLI if not present              |
| `installSuperpowers()`   | Enable Superpowers plugin in settings.json          |
| `configureClaude()`      | Install + sync (used by OS setup scripts)           |

## CLI Flags

- `--claude` - deploy the explicit public Claude fallback manifest
- `--claude-backup` - back up that manifest through the home-path refusal guard
- `--claude-update` - redeploy the packaged three-file baseline
- `--superpowers` - enable Superpowers plugin in settings.json

## Skill Manager Architecture

Runtime git cloning for skills.

**Separation**: `skill_manager.js` handles cache-backed skill fetching and syncing; `configure_claude.js` handles the explicit portable-baseline manifest. The private policy repository bootstrapped in place at `~/.claude/` can own richer policy.

**Cache Location**: XDG_CACHE_HOME/haoshoku/ follows XDG Base Directory spec, prevents home directory pollution.

**Symlinks**: Skills are symlinked to `~/.claude/skills/` and `~/.agents/skills/`. Source `agents/` directories are ignored.

### Cache Structure

```
~/.haoshoku.json                    # Skill source configuration
    │
    ▼
$XDG_CACHE_HOME/haoshoku/          # Typically ~/.cache/haoshoku/
    └── axatbhardwaj-claude-skills/ # Skills
    │
    ▼
~/.claude/skills/ → symlinks merged from cache
~/.agents/skills/ → the same skills for Codex
```

### Priority Rules

- Sources processed in config array order (first wins)
- First occurrence of a skill name wins (Set-based deduplication)
- Both skill directories contain symlinks into the cache

### Design Decisions

**Why XDG_CACHE_HOME**: Follows XDG spec for Linux cache data, prevents home directory pollution, user-specified preference.

**Why separate config file (~/.haoshoku.json)**: Environment variables are ephemeral and not portable across sessions. Dedicated file allows backup and version control.

**Why git clone --depth 1**: Full history not needed for skills. Shallow clones reduce bandwidth and disk usage.

**Why fetch+reset instead of pull**: Handles shallow clones and force-push scenarios (git pull fails for shallow repos without tracking branches).

**Why skill sync is explicit**: `--claude`, `--claude-update`, and the default setup stay on the portable config boundary. Only `--skills` and `--skills-update` fetch or link external skills.

### Invariants

- Config must be valid JSON or defaults are used (forward compatibility)
- Skill directory must contain SKILL.md to be recognized (prevents false positives)
- Cache directories named by repo: {owner}-{repo} (e.g., axatbhardwaj-claude-skills)
- Skills dir is user-only permissions (0700) — may contain sensitive paths

### CLI Flags

- `--skills` - clone/sync skills from configured sources
- `--skills-update` - pull latest from all cached repos
- `--skills-list` - list available skills by source
