# Changelog

## 4.4.0 - 2026-05-14
- Sync personal Claude config snapshot (`settings.json`, `CLAUDE.md`, `claude.json` runtime state, `statusline-command.sh`) from live `~/.claude/`.
- CLAUDE.md: add a `## PR Reviews` routing section codifying the local-markdown-as-deliverable workflow — never auto-post; explicit per-session approval required; medium-shape format (verdict + severity table + condensed strengths + per-finding paragraphs) when posting to GitHub; verbatim code-block fixes go inline rather than expanding the body; `~/defi/misc/reviews/review-PR-<num>.md` is the canonical defi-com path.
- settings.json: migrate effort selection from top-level `effortLevel: "xhigh"` to env-driven `env.CLAUDE_CODE_EFFORT_LEVEL: "max"`; drop the disabled `openai-codex` plugin (entry + source); add `editorMode: "normal"`.
- statusline: render the new `max` effort tier with a per-character green → cyan → purple Dracula gradient (`#50FA7B` → `#8BE9FD` → `#BD93F9`). Refactor the effort branch to compose a full pre-colored token (`eff_render`) instead of computing only a color, which is what unlocks per-character rainbow rendering.

## 4.3.0 - 2026-05-11
- Replace `--gsd` with `--superpowers`. The new flag idempotently enables the Superpowers plugin via a direct edit to `~/.claude/settings.json` (different shape from `--gsd`'s npx shell-out).
- Remove dead `gsd-*` agent emoji entries from the Claude Code statusline (live + backed-up copy).
- Update README, helpers README, and configs/claude/README to reflect the migration.

## 4.2.1 - 2026-05-10
- Add reasoning effort indicator to Claude Code statusline (`💭 <level>` color-coded by tier — dim/blue/green/magenta for low/medium/high/xhigh; shows `⚡ fast` when fast mode bypasses thinking).
- Sync personal Claude config snapshot (`settings.json`, `CLAUDE.md`, `claude.json` runtime state) from live `~/.claude/`. CLAUDE.md transitions from GSD-era routing to Superpowers framework.

## 4.2.0 - 2026-04-28
- Remove Ghostty integration end-to-end (config templates, `--ghostty-theme` flag, per-OS deploy block). Kitty replaces it as the default terminal.
- Port deep-ocean theme to Kitty (palette, 0xProto Nerd Font Mono, opacity 0.85, KDE-honored `background_blur`, shift+enter Claude Code newline keybind).
- Backup before overwrite for fish, kitty, and alacritty configs (closes ROB-02). Existing configs are preserved as `<dest>.bak` on each deploy. Single rolling backup matches the existing KDE-shortcuts pattern.
- Add `safeCopyFile` helper to `common/utils.js` with three test specs.

## 4.1.1 - 2026-04-17
- Fix Claude Code statusline branch + path display.
- Require web search for current package/library versions in Claude conventions.

## 4.1.0 - 2026-04-16
- Add Claude Code statusline support (sync + deploy).
- Add Node.js install and Claude config deployment to Debian server setup.
- Refactor `CLAUDE.md` template for Claude 4.7.
- Bump GitHub Actions versions in CI.

## 4.0.0 - 2026-03-16
- Add `--gsd` flag to install GSD (get-shit-done) for Claude Code.
- Deploy conventions and output-styles via `--claude` (previously unmanaged).
- Agents now deployed from skills repo via `--skills` (no longer bundled in haoshoku).
- Remove solatis/claude-config as default skill source.
- Update all documentation to reflect new architecture.

## 3.2.0 - 2026-02-07
- Add KDE Ocean theme deployment (`--kde-theme`, `--kde-theme-backup`).
- Bundle Ocean LAF theme assets (look-and-feel, Kvantum, Aurorae, desktop theme, color scheme).
- Add `copyDirRecursive` utility for nested directory operations.

## 3.0.1 - 2026-02-01
- Add animated intro video for README.
- Add new Conqueror's Haki themed logo.
- Add Remotion video project for intro generation.

## 2.13.0 - 2026-01-30
- Add runtime skill manager for Claude skills.
- Add CLI commands for skill management (`--skills`, `--skills-update`).
- Add skill management documentation.
- Prompt to sync skills after OS setup.
- Track shared skill resources independently.
- Remove skills from submodule symlinks (use runtime git clone).

## 2.12.1 - 2026-01-28
- Improve Zed theme readability for context menus.

## 2.12.0 - 2026-01-27
- Add Zed Deep Ocean theme.
- Add Zed theme configuration to CachyOS setup.
- Add Zed to package list.

## 2.11.1 - 2026-01-26
- Sync fish config (add go/bin path, envman, zeditor alias).

## 2.11.0 - 2026-01-25
- Backup personal Claude config.

## 2.10.0 - 2026-01-23
- Remove OpenCode support (deprecated in favor of Claude Code).
- Add hybrid Claude config sync (symlink submodule dirs, copy personal files).
- Add `--claude-backup` flag to backup personal Claude config.
- Add `--claude-update` flag to update submodule and sync.
- Add Fail2ban SSH configuration to Debian server setup.
- Consolidate `promptUser()` to common/utils.js (DRY).
- Add JSDoc comments to configure_claude.js functions.
- Fix README Quick Start to use correct repo name (haoshoku).

## 2.9.0 - 2026-01-15
- Version bump with minor improvements.

## 2.8.0 - 2026-01-10
- Add Claude Code configuration support.
- Add solatis/claude-config as git submodule.

## 2.3.0 - 2025-12-20
- Migrate from Python/PyPI to JavaScript/Bun/npm.
- Rename project from Bankai to Haoshoku.

## 2.2.0 - 2025-12-12
- Remove Dashy provisioning from Debian server setup script.
- Remove Dashy service template from the repository.
