## Arch and Omarchy behavior

The Arch setup:

- skips git configuration on Omarchy, which sets your identity at install,
  leaving existing `~/.gitconfig` and git profile files untouched; other Arch
  hosts still get the "Configure git?" prompt;
- authenticates sudo once up front and keeps that authorization alive with
  silent, non-interactive refreshes until setup finishes or aborts. Later
  Haoshoku sudo calls are non-interactive and fail instead of prompting again;
- performs a full system upgrade before package installation through
  `omarchy update -y` on Omarchy or `pacman -Syu` on other Arch-family
  systems, aborting setup if that preflight fails;
- prefers Omarchy's `yay`, falls back to `paru`, and bootstraps an AUR helper
  only when neither is available;
- uses `pacman` for repository packages and the AUR helper only for AUR
  packages;
- batches repository and AUR packages, filters missing targets, and retries only
  still-uninstalled packages individually when a batch fails;
- installs only JetBrains Mono Nerd Font when neither its full nor Omarchy's
  `ttf-jetbrains-mono-nerd-basic` package is installed; keeps either existing package;
- binds `Super+T` to launch or focus T3 Code stable with `t3code`,
  matching only the anchored `^com\.t3tools\.T3Code$` window class;
- installs Tailscale, enables `tailscaled.service`, and configures the T3 user
  service for tailnet HTTPS phone access after T3 is installed. Logged-out nodes
  print a browser login URL and wait; logged-in nodes skip login. Matching
  service drop-ins are left untouched. The [single-backend preflight](../README.md#t3-single-backend-preflight)
  must pass before T3 service changes. Failures warn and setup continues;
- prints the verified HTTPS URL and `t3 pair --tailscale` phone pairing hint.
  Rerun this step alone with `haoshoku --tailscale-t3` on Arch. System changes
  use `sudo -n`; standalone runs require an existing sudo authorization
  (`sudo -v`). Tailnet HTTPS certificates must be enabled;
- keeps Bash as the account shell and adds portable aliases and tool
  initialization through `~/.config/haoshoku/bashrc`;
- preserves Omarchy's `.bashrc`, lock screen, and core Quickshell/Hyprland
  configuration. It asks Omarchy to apply the pinned Aurora theme, selected
  background, and font from `configs/omarchy/appearance.json`; it does not
  copy generated `current/theme` state between machines. Displaced Omarchy
  keybindings are
  relocated or explicitly superseded and documented in
  [`configs/omarchy/keybinding-swaps.json`](../configs/omarchy/keybinding-swaps.json),
  the canonical swap record;
- deploys `~/.config/hypr/haoshoku/{bindings,workspaces}.lua` and appends
  exactly two `require` lines to `~/.config/hypr/hyprland.lua`; Omarchy 4
  loads user config via `require()` and no longer sources `.conf` files;
- selects `pc`, `laptop` or `iobox` in order: explicit flag, stored choice,
  hostname in `configs/fleet.json`, Linux DMI/battery detection, then prompt;
  saves the selected type to `~/.haoshoku.json` before device-routed setup.
  A stored choice that disagrees with the fleet hostname warns and stays unchanged;
  `haoshoku --device-type pc|laptop|iobox` is the explicit override. Skip persists
  nothing and leaves device-specific audio unset;
- without interactive confirmation—including piped stdin—Haoshoku declines real
  user decisions immediately and does not treat input as answers;
- adds a device-routed behavior-only Lua workspace overlay. The hyprmoncfg
  plugin owns the generated `~/.config/hypr/monitors.lua`; Haoshoku owns only
  `~/.config/hyprmoncfg/profiles/*.json`, the source profile JSON that
  hyprmoncfg reads to generate that Lua file, and never writes
  `monitors.lua` directly. Monitor-bound workspace rules live in the
  hyprmoncfg PC profile, matched by hardware identity instead of connector
  name so they survive DP connector swaps; laptop workspace rules are
  monitor-independent and remain in the Lua overlay;
- adds two-key special-workspace toggles under `Super`: A Haki (the tagged Warp
  `haki` tab), I AI assistants (Claude Desktop and Codex Desktop) on ordinary
  workspace 1,
  M music, O 1Password, G communication, B Flux Brave Origin,
  D DeFi Brave Origin,
  S Steam, and `Super+Shift+X` X (`Super+Shift+S` stashes the focused window,
  `Super+Alt+S` toggles the stash workspace);
  see the canonical swaps JSON above for every Omarchy default relocated or
  superseded to make room;
- starts Steam silently in special:steam at login and binds `Super+2` to
  Omakade on demand, keeping `Super+Shift+G` as the gaming-workspace toggle
  that ensures Omakade. Steam login autostart is configurable
  (`~/.config/haoshoku/gaming.json` defaults to Steam on, Omakade off):
  `haoshoku --gaming-steam-autostart enabled|disabled` and
  `haoshoku --gaming-omakade-autostart enabled|disabled`. Use
  `haoshoku-gaming-workspace place -- %command%` as a Steam launch option to
  move the launched game's process-tree windows there. The same wrapper lifts
  the kernel split-lock penalty while the game runs and restores it on exit
  once `haoshoku --gaming-split-lock` has installed its narrow sudoers rule
  (Division 2 otherwise sits near 50 fps with an idle CPU and GPU);
- starts Flux, DeFi, WhatsApp, and Notion with empty Brave Origin profiles
  below `~/.config/brave-haoshoku/`; existing Chromium profile data remains
  untouched at `~/.config/chromium-haoshoku/` for manual import;
- installs packaged Omazed and safely points Zed at its generated theme so Zed
  follows the active Omarchy palette. Haoshoku never runs Omazed's manual
  installer or deletes unrelated Zed themes;
- adds a non-locking `Screens Off` command to every paired KDE Connect device.
  It turns off all Hyprland displays through DPMS; keyboard or mouse input, or
  an existing phone-side Wake command, turns them back on. Pair new phones
  first, then run `haoshoku --kde-connect-commands` to add the command;
- continues after individual optional application failures and reports them.

Haoshoku deliberately does not configure Fish, KDE Plasma, KWin, SDDM, or
arbitrary application themes. Omarchy remains responsible for generating and
applying all files downstream of the declared appearance.
