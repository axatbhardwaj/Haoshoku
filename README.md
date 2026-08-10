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
- asks for a `pc` or `laptop` `deviceType` on every full Arch-family setup,
  preselecting any stored valid value, then saves an accepted selection in
  `~/.haoshoku.json` before device-routed audio and Hyprland configuration.
  Choosing Skip persists nothing; Hyprland routing retains a valid stored
  value or uses its own PC default when none is stored. When the prompt cannot
  run, no fallback is persisted or wired through as run state; each downstream
  helper reads the persisted config independently. Device-specific audio stays
  unset without an explicitly persisted selection, and the next interactive
  full setup asks again;
- keeps Claude stay-awake and PR watch as unconditional portable setup steps,
  matching their behavior before confirmations were expanded. Full setup asks
  before the private Claude policy, Superpowers, Claude Remote Control, and
  automatic git worktree cleanup. Superpowers, Remote Control, and worktree
  cleanup default to No. The worktree offer explains that it enables a
  persistent weekly timer running
  `cleanup-worktrees.sh --apply`, which deletes eligible worktrees. Without
  interactive confirmation—including piped stdin—Haoshoku declines these real
  user decisions immediately and does not treat input as answers;
- restores a device-routed `~/.config/hypr/monitors.conf`, backing up different
  existing content first. The PC variant restores the three-monitor layout;
  the laptop variant uses the internal panel's preferred mode and automatic
  scale instead of forcing the PC's 2x GTK scale;
- adds a device-routed behavior-only workspace overlay. The PC variant puts
  workspaces 1–3 and 8 on DP-1, 4–5 and 9 on HDMI-A-1, and 6, 7, and 10 on
  DP-2. The laptop variant removes monitor pins for a single-monitor layout
  while keeping the same workspace behavior, window rules, and bindings;
- adds two-key special-workspace toggles under `Super`: A Haki (the tagged Warp
  `haki` tab), I AI assistants,
  M music, O 1Password, G communication, B Flux Brave Origin,
  D DeFi Brave Origin,
  S stash, and `Super+Shift+X` X (`Super+Shift+S` stashes the focused window);
  see the canonical swaps JSON above for every Omarchy default relocated or
  superseded to make room;
- adds a `Super+Shift+G` toggle for ephemeral gaming workspace 11. Use
  `haoshoku-gaming-workspace place -- %command%` as a Steam launch option to
  move the launched game's process-tree windows there;
- starts Flux, DeFi, WhatsApp, and Notion with empty Brave Origin profiles
  below `~/.config/brave-haoshoku/`; existing Chromium profile data remains
  untouched at `~/.config/chromium-haoshoku/` for manual import;
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

## Claude Remote Control

The optional Claude Remote Control setup runs persistent Claude sessions from
three fixed roots: `haki` at `$HOME`, `dev` at `$HOME/dev`, and `work` at
`$HOME/Work`. Instances whose roots do not exist are skipped with a warning.
On Omarchy, `Super+A` opens the tagged Warp `haki` tab on the special workspace;
Caelestia and KDE use their own Warp `agents` routes. Set `claudeSessionName` in
`~/.haoshoku.json` only to resume a named Haki Claude session. A missing or null
value starts plain Claude; a
syntactically invalid value is preserved, reported, and ignored. A valid name is
passed as one literal argument to `claude -r`, but it resumes directly only when
the name resolves uniquely; otherwise Claude may open its picker. This
Haki keybinding never attaches to tmux
or calls systemd.

These sessions run Claude Remote Control in **server mode**
(`claude remote-control --spawn same-dir --capacity 5`): each is a persistent
host that spawns up to five on-demand sessions in its own directory, launched
with `--permission-mode bypassPermissions`. The Arch setup calls this out
before installation. The user services enable
systemd lingering when possible so sessions can survive logout; if lingering
cannot be enabled automatically, setup prints the exact `loginctl` command to
run.

Installation sets `bypassPermissionsModeAccepted: true` in `~/.claude.json`.
This machine-wide acceptance affects every Claude Code session, not only the
three managed services, and persists until manually reverted. To undo it, edit
`~/.claude.json` and remove `bypassPermissionsModeAccepted` or set it to
`false`.

Attach to any enabled managed session from a terminal with:

```bash
~/.local/bin/haoshoku-claude-remote-control attach haki
~/.local/bin/haoshoku-claude-remote-control attach dev
~/.local/bin/haoshoku-claude-remote-control attach work
```

Deploy or snapshot the supervisor and user unit independently with:

```bash
haoshoku --claude-remote-control
haoshoku --claude-remote-control-backup
```

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
haoshoku --claude-remote-control
haoshoku --claude-remote-control-backup
haoshoku --claude-update
haoshoku --claude-bootstrap
haoshoku --codex
haoshoku --codex-backup
haoshoku --device-type laptop
haoshoku --audio
haoshoku --audio-backup
haoshoku --mimeapps
haoshoku --mimeapps-backup
haoshoku --skills
haoshoku --skills-update
haoshoku --skills-list
haoshoku --superpowers
haoshoku --gh-stack
haoshoku --claude-stay-awake
haoshoku --pr-watch
haoshoku --worktree-cleanup
haoshoku --workspaces
haoshoku --monitors
```

Use `haoshoku --device-type pc` to switch back. Every full Arch-family setup
asks for device type and preselects either valid stored value.

Run `haoshoku --help` for the complete current list.

## Debian Server

```bash
haoshoku --os debian-server
```

The Debian path remains deliberately headless. In addition to its server
hardening, it installs the portable Claude, Codex, Agent OS, and PR-watch
configuration; asks about Git, the private Claude policy, Superpowers, Claude
stay-awake, Claude Remote Control, and automatic worktree cleanup; then reaches
the common skills-sync offer. Superpowers is applied after any accepted policy
checkout so the checkout cannot erase its registration.

Debian Server does not ask for `deviceType`: that value only selects desktop
audio and Hyprland/Omarchy variants. For the same reason the Debian path does
not deploy audio, browser/MIME integration, the desktop-oriented user-script
bundle, Brave managed policies, Hyprland monitors/workspaces, or Omazed. Those
steps remain on the Arch/Omarchy path instead of being installed onto a
headless server for superficial symmetry.

## Development

```bash
bun install
bun test
bun run lint
```
