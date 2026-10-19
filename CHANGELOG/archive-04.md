## 7.6.0 - 2026-08-07

- Run the managed Claude Remote Control instances (`haki`, `dev`, `work`) in
  server mode (`claude remote-control --spawn same-dir --capacity 5
  --permission-mode bypassPermissions`) instead of a single fixed
  `--remote-control` session. Each instance is now a persistent host that spawns
  up to five on-demand sessions in its own directory — the phone can start new
  sessions on it — rather than one fixed session. A fresh account shows a
  one-time `Enable Remote Control? (y/n)` prompt on an instance's first start;
  attach once and press `y` (acceptance persists per account).

- Rename the home-root Claude Remote Control instance from `io` to `haki` and
  retire instances removed from the managed map by stopping and disabling their
  services before deleting their environment files. Retirement is derived from
  Haoshoku's installed state, refuses to kill the tmux session running the
  installer, and leaves unrelated template units untouched; the launcher now
  reports an uninstalled Haki instance accurately while the unit tolerates its
  environment file being absent during migration.

## 7.5.0 - 2026-08-06

- Make `Super+B` toggle the existing Flux Chromium window instead of opening a new
  window on every press: the normal Flux-owner launch routes started it without an
  explicit window class, so plain windows were born as `chromium` while the
  workspace probe matched `chromium-flux` exactly.
- Remove the Hey Email and Calendar shortcuts at the user's request, leaving both
  stock keys unbound and removing the service from active configuration.
- Move the file manager shortcut from `Super+F` to `Super+E`.
- Add a Re:ANIME special workspace on `Super+F` with the same focused-monitor
  show, focus, and hide behavior as YouTube and Crunchyroll.

## 7.4.0 - 2026-08-06

- Make Email, Calendar, and Grok shortcuts focus-aware with exact web-app
  classes, so they stop opening a duplicate window on every press.
- Keep special-workspace browser URL requests visible and let recipes continue
  when Hyprland dispatch IPC is unavailable.

## 7.3.0 - 2026-08-06

- Make special-workspace toggles monitor-aware without hiding or migrating
  panels: browser recipes open on the focused monitor, while pinned panels stay
  on their assigned monitor and focus an already-visible panel instead of
  toggling it away. Add distinct-monitor and per-recipe coverage so placement
  and follow-focus behavior cannot drift unnoticed.
- Add standalone `--scripts` and `--workspaces` deployment paths, preventing the
  tracked user scripts and Hyprland workspace overlay from drifting behind their
  live copies. The scripts path also prunes retired entries; the workspace path
  installs its helper and ensures Hyprland sources the overlay.
- Fix Chromium `--app` routing for WhatsApp, Notion, X, YouTube, and Crunchyroll.
  Chromium ignores `--class` under `--app` and derives the window class from the
  URL instead, so each app now uses its escaped derived class rather than an
  ineffective requested class. Shared web apps run through a Flux-profile
  wrapper so their sessions stay together; the wrapper is necessary because the
  launcher keeps only the first field of a desktop file's `Exec`. X is pinned to
  the portrait workspace, while YouTube and Crunchyroll get focus-following
  workspaces, with table-driven coverage guarding every recipe's monitor
  behavior.
- Restore durable Zed translucency and visible borders in the Omazed-generated
  theme. Zed requires the dotted `background.appearance` setting inside the
  theme style plus alpha-channel background colours; its own blur protocol is
  KDE-only, so the transparent surfaces rely on Hyprland to supply the blur.
- Move application keybindings into a refresh-safe overlay because
  `~/.config/hypr/bindings.conf` is an Omarchy template that `omarchy refresh`
  restores and overwrites. Hyprland adds bindings instead of replacing them, so
  every override explicitly unbinds first, while `keybinding-swaps.json` records
  each displaced default. The overlay also moves workspace toggles to shorter
  two-key shortcuts, and `Super+Z` now always opens a new Zed window with
  `zeditor --new` instead of focusing an existing one.
- Rename the `Super+I` panel from Claude to assistants and tile ChatGPT beside
  Claude. Deployment migrates a window stranded on the old special workspace,
  while the former direct ChatGPT shortcut is removed so repeated presses do not
  open duplicate windows.

## 7.2.2 - 2026-08-05

- Launch the agents special workspace in kitty instead of Alacritty, matching the
  kitty-first terminal setup. `--class haoshoku-agents` still sets the Wayland
  app_id, so the existing `match:class ^haoshoku-agents$` workspace rule continues
  to match.

## 7.2.1 - 2026-08-05

- During full setup, prompt (default Yes) to bootstrap the configured private
  Claude policy repository after the public baseline. An unreachable or
  authentication-failed repository now warns and lets setup continue; retry with
  `haoshoku --claude-bootstrap`. The checkout never runs `git clean`, preserving
  Omarchy's `~/.claude/skills/omarchy` symlink.

## 7.2.0 - 2026-08-05

## 7.1.0 - 2026-08-04

- Complete the Chromium-only migration found during live E2E validation:
  remove Brave, Floorp, Google Chrome, and Thorium from the package set; make
  Chromium the default web handler; and replace the remaining Brave WhatsApp
  and Notion desktop entries with isolated Chromium profiles.
- Install Omazed from Omarchy's package repository and hand Zed theme ownership
  to its generated palette. The setup path transactionally replaces the unsafe
  object-form theme selector before first launch, preserves all other Zed
  settings, restores the original on failure, and removes the retired
  Caelestia theme only after successful setup.
- Keep `bun-bin` in the Arch package set and add `~/.bun/bin` explicitly to the
  managed Bash environment, fixing Bun lookup in clean Omarchy Bash sessions.
- Restore the former Caelestia workspace workflow as an additive Omarchy user
  overlay. It preserves Omarchy visuals and stock shortcuts, restores the
  three-monitor map, uses a conflict-free special-workspace namespace, and
  replaces Brave profiles and PWAs with isolated Chromium data directories.
- Make the Arch desktop path Omarchy-native without restructuring the installer:
  prefer `yay` with `paru` fallback, route repository packages through `pacman`,
  install a single conflict-free Nerd Font, port the user's shell additions to a
  managed Bash fragment, and restore only Omarchy's user-owned `monitors.conf`.
- Replace CachyOS gaming meta-packages with Steam, GameMode, Gamescope, MangoHud,
  ProtonUp-RS, and Omarchy's GPU-aware 32-bit driver helper.
- Retire the KDE, Caelestia, SDDM, Fish, terminal-theme, Zed-theme, and wallpaper
  setup paths. Omarchy is now the sole owner of desktop appearance.

## 7.0.0 - 2026-08-04

## 6.2.0 - 2026-08-04

- Add the opt-in `--claude-bootstrap` mode for checking out the configured private
  Claude policy repository, including pre-mutation authentication checks and
  idempotent `origin` URL updates when `claudeBootstrapUrl` changes.

## 6.1.0 - 2026-08-01

- Preserve locally authored skills and cache branches during skill updates. `mergeSkills()`
  now reports same-named real local entries as local-wins shadows, separately from
  in-place and failed symlinks, while continuing to replace stale or foreign links.
  Cached repositories now check out their resolved default branch before fetching and
  hard-resetting; if checkout fails, the updater warns and keeps the stale cache rather
  than resetting the current branch and risking its commits.
- Harden every `safeCopyFile` backup slot by atomically claiming the write-once
  `.bak`, `.haoshoku-first-capture`, and versioned paths, and by stripping
  executable bits from every backup while preserving other permissions (so
  `0600` stays `0600` and `0755` becomes `0644`). Backups remain intentionally unpruned:
  automatic retention could discard the only copy of a later user edit, so
  cleanup stays an explicit user decision. Add behavioral coverage for the
  Claude first-capture gitignore allowlist, concurrent same-timestamp backups,
  and double-digit collision ordering.

## 6.0.1 - 2026-08-01

- Fix the npm publish gate's packaging guard timeout. Version 6.0.0 was tagged and released on GitHub but was never published to npm: `tests/claude_packaging.test.js` exceeded Bun's default 5000ms timeout on the CI runner while its cold-cache `npm pack --dry-run --json` operation took about 4 seconds, so the publish workflow stopped before `npm publish` ran. Version 6.0.1 is the first 6.x version actually published to npm.
