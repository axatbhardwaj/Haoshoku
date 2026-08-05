<p align="center">
  <img src="icons/haoshoku-readme.gif" alt="Haoshoku" width="100%">
</p>

# Haoshoku: Color of the Supreme King

Haoshoku is a personal, modular setup toolkit for Arch-family desktops and
Debian servers. Its desktop path is designed around Omarchy: Haoshoku installs
applications and portable developer configuration while Omarchy remains the
owner of the desktop experience.

## Install

```bash
git clone https://github.com/axatbhardwaj/haoshoku.git
cd haoshoku
bun install
bun link
haoshoku --os arch
```

`bun haoshoku.js --os arch` works without creating a global link. The legacy
`--os cachyos` spelling is accepted with a deprecation warning.

## Arch and Omarchy behavior

The Arch setup:

- refreshes pacman repositories and performs a full system upgrade before any
  package installation, aborting setup if that preflight fails;
- prefers Omarchy's `yay`, falls back to `paru`, and bootstraps an AUR helper
  only when neither is available;
- uses `pacman` for repository packages and the AUR helper only for AUR
  packages;
- batches repository and AUR packages, filters missing targets, and retries only
  still-uninstalled packages individually when a batch fails;
- installs only JetBrains Mono Nerd Font instead of the conflicting complete
  Nerd Font group;
- keeps Bash as the account shell and adds portable aliases and tool
  initialization through `~/.config/haoshoku/bashrc`;
- preserves Omarchy's `.bashrc`, themes, terminals, wallpapers, lock screen,
  Waybar, Walker, and Hyprland appearance; displaced Omarchy keybindings are
  relocated or explicitly superseded and documented in
  [`configs/omarchy/keybinding-swaps.json`](configs/omarchy/keybinding-swaps.json),
  the canonical swap record;
- ships refresh-safe app bindings from
  [`configs/omarchy/bindings.conf`](configs/omarchy/bindings.conf) instead of
  replacing Omarchy's `~/.config/hypr/bindings.conf`;
- restores `~/.config/hypr/monitors.conf`, backing up different existing
  content first;
- adds a behavior-only workspace overlay: workspaces 1–3 use DP-1, 4–5 use
  HDMI-A-1, and 6, 7, and 10 use DP-2;
- adds two-key special-workspace toggles under `Super`: A agents, I Claude,
  M music, O 1Password, G communication, B Flux Chromium, D DeFi Chromium,
  S stash, and `Super+Shift+X` X (`Super+Shift+S` stashes the focused window);
  see the canonical swaps JSON above for every Omarchy default relocated or
  superseded to make room;
- isolates Flux, DeFi, WhatsApp, and Notion below
  `~/.config/chromium-haoshoku/`;
- installs packaged Omazed and safely points Zed at its generated theme so Zed
  follows the active Omarchy palette. Haoshoku never runs Omazed's manual
  installer or deletes unrelated Zed themes;
- continues after individual optional application failures and reports them.

Haoshoku deliberately does not configure Fish, KDE Plasma, KWin, SDDM,
Caelestia, terminal themes, Zed themes, or wallpapers.

## Claude policy bootstrap

During full setup, Haoshoku deploys its public Claude fallback and integration
files, then asks whether to bootstrap the configured private Claude policy
repository; the prompt defaults to Yes. If that repository is unreachable or
authentication fails, setup continues and can be retried with:

```bash
haoshoku --claude-bootstrap
```

The private repository owns the live `CLAUDE.md`, `settings.json`, wrapper
agents, workflows, conventions, and output styles. Haoshoku owns only the
bootstrap orchestration and its public fallback/integration files. Bootstrap
does not run `git clean`, so Omarchy's managed
`~/.claude/skills/omarchy` symlink survives.

## Gaming

Accepting the gaming prompt installs a portable Arch gaming base:

- Steam
- GameMode and its 32-bit library
- Gamescope
- MangoHud and its 32-bit library
- ProtonUp-RS

On Omarchy, Haoshoku also invokes Omarchy's GPU-aware helper for the correct
32-bit Vulkan/NVIDIA libraries. Other Arch distributions are not given guessed
GPU packages.

## Bash additions

The managed fragment exposes both package-installed Bun and a user installation
under `~/.bun/bin`, and provides guarded initialization for Starship, direnv,
zoxide, thefuck, pyenv, and Conda, plus the aliases formerly kept in the Fish
configuration. Machine-local secrets can be stored in
`~/.config/haoshoku/secrets.bash`; that file is never copied into this repo.

## One-shot configuration

```bash
haoshoku --claude
haoshoku --claude-backup
haoshoku --claude-update
haoshoku --claude-bootstrap
haoshoku --codex
haoshoku --codex-backup
haoshoku --audio
haoshoku --audio-backup
haoshoku --mimeapps
haoshoku --mimeapps-backup
haoshoku --skills
haoshoku --skills-update
haoshoku --skills-list
haoshoku --superpowers
```

Run `haoshoku --help` for the complete current list.

## Debian Server

```bash
haoshoku --os debian-server
```

The Debian path remains separate and continues to provide its existing server
hardening and developer setup.

## Development

```bash
bun install
bun test
bun run lint
```
