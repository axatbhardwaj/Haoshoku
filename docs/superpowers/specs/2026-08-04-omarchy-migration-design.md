# Omarchy Migration Design

## Goal

Adapt Haoshoku's existing Arch desktop setup to work cleanly on a fresh Omarchy installation without overhauling the project. Haoshoku will continue installing the user's portable applications and development tools, while Omarchy remains the sole owner of desktop appearance and defaults.

## Scope

The migration will:

- support Omarchy explicitly while retaining a practical generic Arch installation path;
- keep Bash as the login shell and port the useful Fish conveniences to a managed Bash fragment;
- restore the user's current three-monitor layout through Omarchy's user-owned `~/.config/hypr/monitors.conf`;
- install portable gaming tools instead of CachyOS-only gaming meta-packages;
- remove KDE, Plasma, KWin, SDDM, Caelestia, and Fish configuration from the normal Arch setup;
- leave all Omarchy appearance, terminal, wallpaper, lock-screen, and theme configuration untouched.

This work will not redesign Haoshoku's installer architecture or refactor unrelated helpers.

## Platform Detection and Package Installation

The existing Arch setup remains the base implementation. Omarchy will be detected using stable local markers such as the `omarchy` command and its managed installation directory. The installer will describe the path as Arch/Omarchy rather than assuming CachyOS.

Repository packages will be installed with `pacman`. AUR packages will use the first available supported helper, preferring `yay` and falling back to `paru`. If neither helper exists, Haoshoku will install or bootstrap one using the existing small helper flow, then clearly report any remaining AUR packages it could not install.

Package installation remains best-effort per application: one unavailable package must not abort the rest of the setup. The final output will summarize failures.

The Nerd Font group installation will be removed. Haoshoku will install only `ttf-jetbrains-mono-nerd`, with `--needed`, avoiding the full/basic package conflict shown by the current installer.

## Bash Configuration

Haoshoku will not replace Omarchy's `~/.bashrc`. It will deploy a dedicated, user-owned Bash fragment and add one idempotent source statement to `.bashrc`. Omarchy's existing default Bash configuration remains loaded first.

The fragment will contain portable Bash equivalents of the useful Fish configuration:

- conditional initialization for Starship, direnv, zoxide, thefuck, pyenv, and Conda;
- the existing command aliases and Git shortcuts;
- conditional PATH additions for LM Studio, Go, Claude temporary files, Cargo, Foundry, and other paths already represented by the Fish template;
- an optional local secrets fragment that is not stored in the repository.

Fish-only greeting behavior, Caelestia terminal sequences, Caelestia user configuration, Fish abbreviations, and Fish installation/plugin management will not run on the Arch/Omarchy setup. Fish abbreviations will become ordinary Bash aliases where their semantics are safe and predictable.

Potentially dangerous aliases retain the user's current requested behavior but will be documented clearly in the managed fragment. Haoshoku will not change the account's login shell.

## Omarchy Configuration Ownership

Omarchy remains the sole owner of:

- desktop and terminal themes;
- Alacritty, Kitty, Ghostty, and Foot configuration;
- Zed appearance configuration;
- wallpapers;
- Hyprland bindings, input, appearance, autostart, idle, and lock-screen configuration;
- Waybar, Walker, Mako, and other desktop components.

The default Haoshoku Arch/Omarchy run will therefore skip the existing terminal-config copy, Zed theme/config sync, wallpaper deployment, Caelestia preferences, Caelestia lock fixes, KDE configuration, and SDDM configuration.

Existing narrow CLI helpers that are purely KDE/Caelestia-specific will be removed from the public CLI and documentation when they have no remaining Omarchy use. Portable helpers such as Git, MIME associations, audio, scripts, Claude, Codex, and application installation remain in scope unless a test proves they depend on the removed desktops.

## Monitor Restoration

The repository will store an Omarchy monitor template copied from the current working `~/.config/hypr/monitors.conf`. It represents:

- `DP-2`: `1920x1080@179.96`, positioned at `0x0`, scale `1`, transform `1`;
- `DP-1`: `2560x1440@143.97`, positioned at `1080x240`, scale `1`;
- `HDMI-A-1`: `1920x1080@74.97`, positioned at `3640x420`, scale `1`;
- a preferred-mode fallback for unexpected outputs.

On Omarchy, Haoshoku will restore only `~/.config/hypr/monitors.conf`. Before replacing a different existing file it will create a timestamped backup beside it. Re-running with identical content will be a no-op. It will not write any other file beneath `~/.config/hypr/`.

When run in an active Hyprland session, the installer will validate the result with `hyprctl reload` and `hyprctl configerrors`. Outside a session, it will explain that validation is deferred until first login rather than treating that as an installation failure.

## Gaming Setup

The CachyOS-only `cachyos-gaming-meta` and `cachyos-gaming-applications` packages will be removed. The gaming prompt will install a focused portable set:

- `steam`;
- `gamemode` and `lib32-gamemode`;
- `gamescope`;
- `mangohud` and `lib32-mangohud`;
- `protonup-rs-bin` through the available AUR helper.

On Omarchy, Haoshoku will call Omarchy's GPU-aware 32-bit graphics-driver helper after installing the portable set. On another Arch distribution, it will skip that Omarchy-specific helper with a clear note rather than guessing GPU packages.

Lutris and Heroic are not added to the mandatory gaming set because they are launcher preferences, not required Steam compatibility infrastructure; they may remain in the user's general application list if already present there.

## Error Handling

Required setup failures, such as inability to authenticate with sudo or deploy the Bash fragment, will be reported prominently. Optional application, AUR, gaming, and integration failures will be collected and summarized without preventing independent later stages from running.

Commands must not assume `paru` exists. Omarchy-only commands must be guarded by Omarchy detection and command availability. Missing optional initialization tools in the Bash fragment must remain silent.

## Testing

Automated regression coverage will prove:

- Omarchy is detected without misclassifying ordinary Arch installations;
- repository packages use `pacman` and AUR packages use `yay` or `paru` according to availability;
- no command installs the complete `nerd-fonts` group;
- Bash deployment preserves the Omarchy `.bashrc` and adds its source line once;
- the ported aliases and conditional initializers have the expected Bash form;
- the normal setup does not install Fish or invoke Fisher;
- only `monitors.conf` is restored under the Hyprland user configuration;
- identical monitor content is not backed up repeatedly and differing content is preserved in a backup;
- the portable gaming set replaces the CachyOS meta-packages;
- Omarchy's GPU helper is invoked only on Omarchy;
- the default path contains no KDE, Caelestia, SDDM, terminal-theme, Zed-theme, or wallpaper mutation;
- existing portable setup tests continue to pass.

Verification will include the focused new tests, the complete Bun test suite, Biome linting, and static searches for prohibited default-path commands and configuration writes.

## Success Criteria

On a fresh Omarchy installation, running Haoshoku completes without a missing-`paru` crash or Nerd Font conflict, retains Omarchy's appearance and Bash defaults, installs the portable application/development stack, optionally installs the portable gaming stack, and restores the exact current monitor layout. Re-running it is safe and does not duplicate Bash sources or monitor backups.
