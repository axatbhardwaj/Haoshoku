## 9.0.0 - 2026-08-16

- Breaking: Omarchy 4 or newer required; Omarchy 3 no longer supported.
  Migration, workspaces, hyprmoncfg, and plugin helpers gate on the installed
  Omarchy major version.
- The Hyprland overlay moved from `.conf` to Lua. Omarchy 4 loads user
  config via `require()` and no longer sources `.conf` files. Haoshoku
  deploys `~/.config/hypr/haoshoku/{bindings,workspaces}.lua` and appends
  exactly two `require` lines to `hyprland.lua`. Removes
  `configs/omarchy/{bindings,workspaces-pc,workspaces-laptop,monitors-pc,monitors-laptop}.conf`.
- Monitor configuration is now owned by the hyprmoncfg plugin. Haoshoku
  authors `~/.config/hyprmoncfg/profiles/*.json` instead of writing
  `monitors.conf`, and never writes `monitors.lua`. Removes
  `src/helpers/configure_omarchy_monitors.js`; `--monitors` now deploys
  hyprmoncfg profiles.
- Monitor-bound workspace rules moved into the hyprmoncfg PC profile,
  matched by hardware identity instead of connector name so they survive
  DP connector swaps. Laptop workspace rules are monitor-independent and
  remain in the Lua overlay.
- The PC Lua overlay no longer sets `GDK_SCALE`; display scaling belongs to
  the monitor profile, fixing Steam and Spotify rendering at 2x on scale-1 monitors.
- New `--3-4-migrate`: re-runnable, idempotent migration from an Omarchy 3
  layout. Strips dead `source =` lines, removes orphaned overlay `.conf`
  files, repoints theme paths, backs up and clears Omarchy's stock
  unmarked `monitors.lua` so hyprmoncfg can take ownership, deploys the
  Lua overlay and profiles, installs plugins, and validates. If Omarchy's
  legacy config shim is still present it reports validation deferred and
  asks for a reboot and re-run rather than claiming success.
- New `--omarchy-plugins`: installs and enables the plugins listed in
  `common/omarchy-plugins.json`,
  idempotent on both plugin id and enabled state, per-plugin failure
  non-fatal. Included in the default run. Entries may declare
  `disableOnInstall` to switch off a stock widget they replace, applied only
  when Haoshoku first creates the plugin and never re-applied. Bar placement,
  settings arrangement, and rollback removal are no longer managed.
- New `--omarchy-bar` deploys the owned `bar` key in Omarchy's `shell.json`,
  while `--omarchy-bar-backup` captures it back into the repo. Haoshoku claims
  `bar` wholesale, including bar-widget enablement, so Omarchy UI changes to
  bar-widget enablement are reverted on the next deploy. Every other top-level
  key — `idle`, `plugins`, `disabledPlugins`, `version`, and unknown keys — is
  preserved.
- New `--hyprmoncfg-backup`: pulls saved hyprmoncfg profiles back into the
  repo.
- Theme state paths follow Omarchy 4's move from
  `~/.config/omarchy/current` to `~/.local/state/omarchy/current` across
  the Kitty config, Kitty session files, and the Fish config.
- Hyprland config validation now parses `hyprctl configerrors` output; its
  exit status is always 0, so the exit code alone could never detect a
  broken config.
- On Omarchy 4, `hyprctl dispatch` evaluates its argument as Lua, so
  `haoshoku-special-workspace` now emits `hl.dsp.*` Lua expressions instead of
  the legacy `dispatch <name> <args>` form, which is a parse error on v4;
  dispatch failures now propagate as script failures rather than being masked.
- T3 Code moved from `special:t3code` to workspace 1. `SUPER+T` now focuses
  workspace 1 and launches T3 Code if missing via the `numbered` recipe; the
  bare `t3code` recipe is retired.
- The gaming-workspace toggle now emits v4 Lua dispatch expressions. On
  Omarchy 4, the legacy positional form is a parse error, which made
  `SUPER + SHIFT + G` a silent no-op.
- The gaming workspace moved from workspace 11 to workspace 2, so stock
  `SUPER+2` reaches it. `SUPER+SHIFT+G` still toggles it and now ensures Steam
  on both branches. Workspace 2 is a normal persistent workspace, so the old
  disappear-when-empty behavior is gone, and the hyprmoncfg PC profile now
  defines workspaces 1-10.
- The default Omarchy plugin set is now eight plugins: `tmn73.calendar`,
  `crmne.mpris`, `dorneles.lock-keys`, and `hass` were dropped, while
  `io.github.thetrueferret.decent-workspaces`, `dizziee.system-stats`, and
  `robzolkos.agent-usage` were added, the first and last displacing the stock
  `omarchy.workspaces` and `omarchy.agents` widgets.

## 8.6.1 - 2026-08-15

- Make the OpenCode seat, run-codex-task lifecycle, and Kitty theme tests
  hermetic so they provision their own state instead of depending on the
  developer machine, unblocking the npm publish workflow on a clean runner.

## 8.6.0 - 2026-08-15

- Add the fixed, bubblewrap-confined OpenCode GLM seat with receipt and
  workspace-attribution enforcement for wrapper-dispatched work.
- Add the Sonnet-supervised `opencode-wrapper` agent and package its fixed
  launcher as part of the public Claude runtime.
- Parse OpenCode export receipts from raw JSON stdout with a one-retry
  leading-preamble fallback, and let operators bypass network-resolving PATH
  shims with a validated `OPENCODE_SEAT_BIN` real-binary override.

## 8.5.4 - 2026-08-14

- Replace Debian T3 Code's mandatory Tailscale installation, authentication,
  pairing, and Serve flow with headless T3 Connect authorization and its
  upstream-managed relay client.
- Preserve ready or pending T3 Connect credentials across reruns, restart the
  current user's T3 service only when provisioning is needed, and verify the
  environment link without opening ports or changing Nginx, DNS, or firewall
  policy.

## 8.5.3 - 2026-08-14

- Make Debian T3 Code server setup install, enable, and verify Tailscale's
  persistent vendor service, authenticate disconnected nodes, create the
  private Tailscale Serve pairing endpoint, and verify it without exposing
  T3's loopback port or changing firewall policy.
- Support both root VPS installs and ordinary sudo-capable users, including
  validated Tailscale operator access for the user that owns the T3 service.

## 8.5.2 - 2026-08-14


## 8.5.1 - 2026-08-13

- Keep only ChatGPT on the monitor-following `special:assistants` workspace
  and its `Super+I` login/toggle path, leaving Claude Desktop unmanaged.

## 8.5.0 - 2026-08-13

- Move Claude Desktop and Codex Desktop into one monitor-following
  `special:assistants` workspace on `Super+I`, reclaim existing windows there,
  and launch the assistants automatically at login.
- Give T3 Code its own monitor-following `special:t3code` workspace on
  `Super+T`, replacing the former Tmux shortcut.
- Add a Twitch Brave Origin app and monitor-following `special:twitch`
  workspace on `Super+Shift+T`.

## 8.4.1 - 2026-08-12

- Make Meta+I switch to workspace 1, reclaim existing Claude and Codex windows there, and keep them tiled and unpinned.

## 8.4.0 - 2026-08-12

- Replace tiered Claude task routing with one capability-based path: Opus
  orchestrates, Sol handles reasoning/code/research, Luna runs at fixed maximum
  reasoning for PR reviews and human-facing HTML/docs, and Grok pairs on
  external research only when discovery identifies a load-bearing unknown.
- Bundle the complete portable Claude fallback runtime, including the named
  wrappers, review workflows, guarded Codex launcher, isolated Luna render
  workspace, discovering-work skill, and Samvada HTML deliverable skill.
  Fresh installs and backups now round-trip all managed runtime files without
  embedding a user-specific home path.

## 8.3.3 - 2026-08-12

- Replace the `Super+I` assistants workspace's ChatGPT Brave web app with
  Codex Desktop. Claude Desktop remains alongside it, and both desktop windows
  route to `special:assistants`, which follows the focused monitor. Arch setup
  provisions the Codex Desktop package alongside Claude Desktop.

## 8.3.2 - 2026-08-12

- Split the `Super+A` Haki Warp tab vertically with the configured `io-haki`
  Claude session above a fresh Codex session. Both panes start at `$HOME`,
  Claude receives initial focus, and the existing exact-window workspace
  ownership remains unchanged.

## 8.3.1 - 2026-08-12

- Fix `Super+A` after Warp session restoration by creating and focusing a
  dedicated Warp window before loading the Haki tab config. Reject unsupported
  tab colors at test time and use Warp's valid `magenta` color instead of
  `purple`.

## 8.3.0 - 2026-08-11

- Migrate every active Omarchy, Caelestia, and KDE terminal caller to Warp.
  `xdg-terminal-exec` now selects Warp, workspace 7 and the Haki/agents tabs
  use exact-address tags, and Kitty remains installed as an inactive fallback.
- Add JioHotstar as a `Super+J` special workspace and relocate Omarchy's
  toggle-split action to `Super+Ctrl+Shift+J`.

## 8.2.0 - 2026-08-10

- Move Close window from `Super+W` to `Super+Q` while intentionally leaving
  `Super+W` unbound, and remove the Obsidian shortcut; Obsidian remains
  launchable through Walker.

## 8.1.0 - 2026-08-08

- Provision GitHub's `gh-stack` extension without a prompt on both default
  setup paths. Detection now recognizes the real alias-first, tab-separated
  `gh extension list` output; existing installs remain silent, missing `gh`
  skips cleanly, and installation failures warn without aborting setup. The
  standalone `--gh-stack` mode now exits non-zero when provisioning fails.
- Ask for device type on every Arch-family full setup, including non-Omarchy
  systems, with a valid stored value preselected and PC—not Skip—preselected
  when stored config contains `null`. Keep the returned non-interactive value
  explicitly advisory: full-setup helpers route from persisted config instead.
  Offer every applicable portable developer component on both default OS paths,
  while keeping desktop-only audio, browser/MIME, scripts, Brave, Hyprland, and
  Omazed configuration off headless Debian servers. Preserve an accepted
  Superpowers registration across every later forced policy checkout by merging
  it back into the freshly checked-out settings. Preserve the
  previously unconditional Claude stay-awake and PR-watch behavior on Arch;
  non-interactive confirmations still decline genuine user decisions without
  hanging.

## 8.0.0 - 2026-08-08

- Make Omarchy's `deviceType` routing reachable: full setup now asks when no
  valid value is stored and persists an accepted `pc` or `laptop` selection in
  `~/.haoshoku.json` before audio, monitor, and workspace deployment. A laptop
  receives single-monitor workspace and monitor variants while keeping the PC
  workspace behavior otherwise identical; its monitor variant deliberately
  leaves GTK scaling to the panel. Choosing Skip, or using the PC fallback when
  the prompt cannot run, leaves device-specific audio unset, uses the PC
  fallback for Hyprland only for that run, and asks again next setup. Set or
  change the value with `haoshoku --device-type laptop` (or `pc`), and redeploy
  either half of the topology with `--workspaces` or `--monitors`.
- Pin workspace 8 to the primary monitor (DP-1) and workspace 9 to the
  rightmost monitor (HDMI-A-1) in the PC Omarchy workspace layout.
- Move `Super+B` (Flux), `Super+D` (DeFi), Notion, WhatsApp, ChatGPT, X,
  YouTube, Crunchyroll, Re:ANIME, Google Photos, Grok, and the default
  `http`/`https` desktop entry from Chromium to Brave Origin, and add
  `brave-origin-bin` to the Arch package set.
- Brave profiles start empty under `~/.config/brave-haoshoku/`: WhatsApp needs
  a fresh QR pairing from the phone, and every other migrated app needs a fresh
  login. Existing Chromium profiles remain untouched at
  `~/.config/chromium-haoshoku/`; nothing is deleted.
- During Omarchy setup, automatically keep Brave's managed-policy parents
  root-owned but deliberately user-own the leaf directory and both policy files
  so Omarchy can update `color.json` on every theme switch. Repair unsafe
  Brave/Chromium directory modes, write only incorrect policy files without
  sudo, and keep the anti-hijack policy in its own file so Omarchy never
  overwrites it.
- Give the DeFi browser profile a distinct violet window border (`#9762e2`) so
  its windows are identifiable at a glance against the Flux profile, which
  keeps the theme default. Implement this with a `border_color` window rule in
  `configs/omarchy/workspaces-pc.conf` and its laptop counterpart, matching the
  `chromium-defi` window class.
  Because Hyprland applies window rules when a window is created, an already-
  open browser keeps its old border until it is reopened.

## 7.9.0 - 2026-08-08

- Keep one dedicated home-rooted kitty terminal on workspace 7, starting it at
  login and reclaiming it if it moves without launching duplicates.
- Run fastfetch when an interactive terminal launches, while keeping
  non-interactive and non-TTY shells quiet.

## 7.8.0 - 2026-08-07

- Keep browser upload and download pickers visible while special workspaces
  are open by applying `float on`, `pin on`, and `center on` to the
  `xdg-desktop-portal-gtk` dialog class. Scope the rules to the portal class so
  Nautilus remains unaffected.
- Recalibrate Zed's generated glass theme from two alpha tiers (`E6`/`D9`) to
  six calibrated tiers, accounting for stacked surfaces so the docked panes
  and agent panel remain visibly translucent instead of effectively opaque.
  Keep `elevated_surface.background` densest at `CC` so translucent context
  menus remain readable.

## 7.7.0 - 2026-08-07

- Make `Super+A` open a local kitty terminal rooted at home instead of attaching
  to a managed Remote Control session. A configured, syntactically valid Claude
  session name is passed literally to `claude -r`; direct resume still requires
  that name to resolve uniquely. Missing or null values start plain Claude, while
  rejected values are preserved and reported instead of being silently nulled.
- Disclose before Remote Control installation that accepting bypass permissions
  permanently changes Claude Code's machine-wide safety acceptance for every
  session, and explain how to reverse it manually.
- Quote every argument the special-workspace launcher hands to Hyprland, so app
  and browser shortcuts keep their arguments intact instead of letting the shell
  re-split anything containing spaces or punctuation.
