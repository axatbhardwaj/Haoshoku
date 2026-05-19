# Changelog

## 5.0.0 - 2026-05-20

**Breaking change.** Removes the haoshoku-managed "Ocean" Hyprland overlay layer (curated borders/blur/keybinds/window-rules/autostart/hyprlock/hypridle/hyprpaper/mako) on top of upstream Caelestia. `--hyprland` now installs Caelestia + nothing else. Monitor configuration becomes the user's responsibility.

- Remove CLI subcommands `--hyprland-keybinds`, `--hyprland-rules`, `--hyprland-backup`. The functions backing them (`syncHyprlandOverlay`, `backupHyprland`, the KDE→Hyprland translators for shortcuts/window-rules/autostart, the Ocean palette parser, `kdeRgbToHyprlandRgba`, `sanitizeDesktopExec`, `ensureLineInFile`, the `OVERLAY_SOURCE_LINE` / `CAELESTIA_USER_INCLUDE` / `OCEAN_OVERLAY_DIR` / `HYPR_BUNDLE_DIR` constants) are gone with them. `src/helpers/configure_hyprland.js` shrinks from 987 LOC to ~270.
- Delete `configs/hypr/` (8 `conf.d/` files + `hyprpaper.conf` + `hyprlock.conf` + `hypridle.conf` + `mako/config`) — Caelestia's Quickshell ships its own lockscreen / idle / wallpaper / notification handling (the Quickshell daemon `qs -c caelestia -n -d` owns `org.freedesktop.Notifications` directly).
- Delete `docs/hyprland-parity-gap.md` (KDE shortcut → Hyprland bind translation tracker — no longer relevant without the translators).
- `installCaelestia` no longer writes a `source = ~/.config/hypr-ocean/conf.d/*.conf` line into `~/.config/caelestia/hypr-user.conf` and no longer creates `~/.config/hypr-ocean/`. `hypr-user.conf` is now pure user-owned space (pre-created empty so Hyprland's first `source =` doesn't error before Caelestia's lazy-init exec hook runs).
- `installCaelestia` accepts a new `skipHyprlandPackages` option to bypass the `pacman -S hyprland …` step when the caller is already running Hyprland. Also drops `mako` from `HYPRLAND_PACKAGES` (Caelestia covers notifications).
- `--hyprland` now prompts for two things up front:
  - **Current desktop environment** (auto-detected via `$XDG_CURRENT_DESKTOP`; user can override). When the answer is `hyprland`, `installCaelestia` runs with `skipHyprlandPackages: true`.
  - **Device type** (Main PC / Laptop / Other / Skip). Non-skip answers persist to `~/.haoshoku.json` as `deviceType`, merging with any existing keys. The answer isn't consumed yet — it's the seed for future per-device monitor configuration (see `docs/hyprland-monitor-multihost-todo.md`).
- Add 20 tests in `tests/configure_hyprland.test.js` covering `installCaelestia` (happy path, `skipHyprlandPackages`, idempotent re-run, recovery, two regression guards against re-introducing Ocean), `promptDesktopEnvironment` (4 cases including cancel), `promptDeviceType` (4 cases including merge-don't-overwrite), and the existing `checkoutPinnedCaelestia` / `recoverCaelestiaPackages` paths. Full project suite drops from 80 to 38 tests — the 50+ removed tests exercised the deleted KDE translators and overlay sync.
- Update `README.md`, `docs/CLAUDE.md`, and `docs/hyprland-monitor-multihost-todo.md` to reflect the slimmed scope and the `deviceType` workflow. Refresh `cachyos.js` to stop calling `syncHyprlandOverlay()`.

**Rollback / pinning.** `npm install -g haoshoku@4.6.6` (or checkout `v4.6.6` from git) restores the Ocean overlay. No deprecation branch — the git tag is the rollback point.

**Known caveat on existing installs.** `~/.config/hypr/scheme/default.conf` may contain alpha-suffixed Caelestia color variants (`$primarye6` etc.) added during the 4.6.x color-scheme fix. They're in Caelestia's symlinked tree and Caelestia normally regenerates `current.conf` dynamically from your wallpaper — a future Caelestia update will clobber them. Not addressed by 5.0.0; flagged here for visibility.

## 4.6.6 - 2026-05-20
- Fix `translateKdeWindowRulesToHyprland` emitting deprecated `windowrulev2 =` lines. Hyprland 0.45+ renamed the keyword to `windowrule =` and changed the matcher grammar: inline `class:^(foo)$` selectors became space-separated `match:class ^foo$` after a comma, and boolean rules now require an explicit value (`float` → `float true`). Output now reads `windowrule = float true, match:class ^foo$` / `windowrule = opacity 0.90, match:class ^foo$` / `windowrule = workspace N, match:class ^foo$`. Regex metacharacters in the class name are still escaped, and explicit `^...$` anchors are kept to preserve v2's exact-class match semantics. On current Hyprland (0.55.2), the prior v2 output was both spamming `configerrors` and on track to stop applying entirely in a future release.
- Update the 6 test assertions that pinned the old syntax (including 2 in the "Adversarial coverage" block that asserted on the bare `class:^(b)$` substring), and regenerate `configs/hypr/conf.d/30-windowrules.conf` via `bun haoshoku.js --hyprland-rules`.
- Add `docs/hyprland-monitor-multihost-todo.md` capturing the deferred multi-host monitor work: today's live topology on host `io` (positions, transforms, EDIDs so it's reconstructable), already-made decisions (per-host strategy, primary monitor, vertical alignment, portrait rotation), and open questions for the next pass on `configs/hypr/conf.d/50-monitors.conf`.

## 4.6.5 - 2026-05-19
- Fix `--hyprland` Caelestia recovery when CachyOS package mirrors or sync databases are stale. If the explicit `paru -S caelestia-cli caelestia-shell` retry fails, Haoshoku now runs one CachyOS mirror refresh plus forced pacman database refresh, then retries the Caelestia leaf packages before failing.
- Add regression coverage for the mirror/database refresh retry path so the installer no longer gives up immediately on transient CachyOS `.sig` retrieval failures.

## 4.6.2 - 2026-05-19
- Fix 14 KDE→Hyprland translation bugs found via adversarial test coverage of `src/helpers/configure_hyprland.js`. Most produced malformed Hyprland directives that would cause Hyprland to silently reject the entire `conf.d/` file, dropping every keybind or rule it contained.
- Security: `checkoutPinnedCaelestia` now validates `pinnedSha` against `/^[a-f0-9]{7,40}$/i` before interpolating it into the `git checkout` command. The shared `runCommand` helper auto-routes commands containing shell metacharacters through `sh -c`, so an unvalidated SHA like `"abc; rm -rf $HOME"` would have executed shell injection.
- `kdeRgbToHyprlandRgba`: reject components outside 0–255 (e.g. `256` → `rgba(1000000ff)` 9-char body) and reject `alphaHex` that isn't exactly 2 hex chars (`"xyz"` → `rgba(000000xyz)`).
- `translateKdeWindowRulesToHyprland`: pick the second token (class) of multi-token `wmclasscomplete=true` values per KDE spec — `.pop()` was wrong for 3-token Qt app names; escape regex metacharacters in `wmclass` so `foo(bar` doesn't break Hyprland's PCRE; clamp `opacityactive` to 0–100 so `-50` / `150` no longer emit `opacity -0.50` / `opacity 1.50`.
- `sanitizeDesktopExec`: strip adjacent field codes like `%f%u` (the prior regex required whitespace boundaries and silently passed concatenated codes); broaden the Flatpak `@@<letter> … @@` wrapper match so unknown prefixes like `@@x` are also stripped; preserve `%%` literal-percent via negative lookbehind.
- `translateKdeShortcutsToHyprland`: reject empty keys (e.g. `Meta+` trailing-`+`) which otherwise emitted `bind = SUPER, , dispatcher`; dedupe modifier tokens so `Ctrl+Alt+Ctrl+X` collapses to `CTRL_ALT, X` instead of the malformed `CTRL_ALT_CTRL, X`.
- `translateKdeAutostartToHyprland`: peel known shim binaries (`env`, `dbus-run-session`, `dbus-launch`, `nohup`, `setsid`, `stdbuf`) and their flag / `NAME=VAL` args before checking the denylist. Without this, `Exec=env DISPLAY=:0 kdeconnectd` and `Exec=dbus-run-session -- kdeconnectd` bypassed the KDE-service denylist.
- `ensureLineInFile`: throw when the `line` argument contains a newline. The trim-based dedupe would always miss a multi-line input, then write the blob verbatim — silently appending extra Hyprland directives into `hypr-user.conf`.
- Add 17 new adversarial test cases (red/blue/green workflow) covering each confirmed bug surface plus positive companion tests. Total hyprland tests: 39 → 58; full project suite: 56 → 77, all green.

## 4.6.1 - 2026-05-19
- Exclude local agent/runtime state (`.claude/`, `.dvandva/`, `superpowers/`) and generated video output from package dry-runs/publishes.
- Fix lint-only issues in the Remotion video components so the release branch passes `bun run lint` cleanly.

## 4.6.0 - 2026-05-19
- Add `--hyprland`: bootstrap Hyprland plus upstream Caelestia rice and deploy the Ocean overlay on CachyOS/Arch. KDE Plasma remains installed as the SDDM fallback session.
- Add `--hyprland-keybinds`: regenerate `configs/hypr/conf.d/20-keybinds.conf` from `configs/kde_shortcuts.kksrc` with translated Hyprland binds.
- Add `--hyprland-rules`: regenerate `configs/hypr/conf.d/30-windowrules.conf` and `40-autostart.conf` from live KDE config with KDE-only autostart services denylisted.
- Add `--hyprland-backup`: pull live `~/.config/hypr-ocean/` and `~/.config/mako/` overlay state back into `configs/hypr/`.
- Bundle the Ocean Hyprland overlay: Ocean borders, KDE Glass-style blur, Wayland env, keybind/rule/autostart translations, hyprpaper, hyprlock, hypridle, mako, and a safe monitor fallback.

## 4.5.0 - 2026-05-14
- Fix `--claude` aborting before deploying any config on a fresh install. When the cache was empty, the auto-skill-sync was treating an empty `skillSources` array as "all sources failed" and calling `process.exit(1)` — so `syncClaudeConfig()` never ran and `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/statusline-command.sh`, and `~/.claude.json` all silently failed to deploy.
- `syncSkills` now returns `{ status, merged }` (one of `"ok" | "no-sources" | "all-failed"`) instead of calling `process.exit`. The `--claude` and `--claude-update` paths treat non-`ok` as a warning and continue with the config deploy; `--skills` and `--skills-update` translate `"all-failed"` into a non-zero exit code, preserving direct-CLI exit semantics.
- `syncClaudeConfig` no longer silently skips when a source file is missing from the bundle — it now logs `⚠ Missing <file> in source bundle — skipped` so a partial/broken package is visible instead of looking like a successful sync. Added regression tests for the `PERSONAL_FILES` manifest (must include `statusline-command.sh`) and the missing-source warning.
- Inject `srcDir`/`claudeHome` options into `syncClaudeConfig`/`backupClaudeConfig` and `configPath`/`cacheDir` into `syncSkills` (defaults unchanged) so tests can drive them against tmp dirs without touching live `~/.claude/`.

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
