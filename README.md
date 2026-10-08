<p align="center">
  <img src="icons/haoshoku-readme.gif" alt="Haoshoku" width="100%">
</p>

# Haoshoku: Color of the Supreme King

Haoshoku is a personal, modular setup toolkit for Arch-family desktops and
Debian servers. Its desktop path is designed around Omarchy: Haoshoku installs
applications and portable developer configuration while Omarchy remains the
owner of the desktop experience. The desktop path requires Omarchy 4
(Quattro) or newer; Omarchy 3 is no longer supported.

## Install

On Linux x64 or arm64, install the compiled CLI and its runtime assets:

```bash
curl -fsSL https://axatbhardwaj.xyz/haoshoku | bash
haoshoku --os arch
```

Bun is not required to install or run this CLI. The installer needs Bash,
curl, tar, and standard Linux coreutils. It stores each version beside
`~/.local/share/haoshoku`, swaps that symlink atomically on updates, and links
`~/.local/bin/haoshoku`. Add `~/.local/bin` to PATH if the installer warns.
Run the same one-liner again to update. Individual setup commands may install
tools that have their own runtime requirements, including Bun for Axstack.

Set `HAOSHOKU_HOME` to override the install location. For offline installation,
use `HAOSHOKU_TARBALL=file:///absolute/path/haoshoku-linux-x64.tar.gz bash install.sh`.
`HAOSHOKU_BASE_URL` overrides the release download directory.

For development, clone the repository and use Bun:

```bash
git clone https://github.com/axatbhardwaj/haoshoku.git
cd haoshoku
bun install
bun link
haoshoku --os arch
```

`bun haoshoku.js --os arch` works without creating a global link. The legacy
`--os cachyos` spelling is accepted with a deprecation warning.

Install the latest Axstack release from npm, verified against its registry
SHA-512 integrity, and configure its Claude and Codex harness targets with
`haoshoku --axstack`. Axstack requires Bun >= 1.3.14 and
`t3` >= 0.0.46-nightly on PATH. On Arch/Omarchy, Haoshoku links
`~/.local/bin/t3` to `/usr/bin/t3-nightly` when `t3` is absent, preserving
any existing local `t3`.
Run `haoshoku --axstack-check` to report the shim/version, each harness check,
and `roles.json` presence at `~/.claude/skills/axstack/roles.json` and
`~/.agents/skills/axstack/roles.json` separately. The role-file readback
does not affect check success.
Claude and Codex setup skip config synchronization when their CLI installation fails.

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
- binds `Super+T` to launch or focus T3 Code Nightly with `t3code-nightly`,
  matching only the anchored `^com\.t3tools\.T3Code$` window class;
- installs Tailscale, enables `tailscaled.service`, and configures the T3 user
  service for tailnet HTTPS phone access after T3 is installed. Logged-out nodes
  print a browser login URL and wait; logged-in nodes skip login. Matching
  service drop-ins are left untouched. The [single-backend preflight](#t3-single-backend-preflight)
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
  [`configs/omarchy/keybinding-swaps.json`](configs/omarchy/keybinding-swaps.json),
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

## Omarchy appearance

[`configs/omarchy/appearance.json`](configs/omarchy/appearance.json) declares a
public theme repository at an immutable Git commit, one background filename
inside that theme, and the font family. Full Arch setup and
`haoshoku --omarchy-appearance` reconcile the theme under
`~/.config/omarchy/themes/`, then call Omarchy's own theme, background, and font
commands. `haoshoku --discord-theme` then deploys that theme's Vencord CSS from
`configs/discord/theme.json` into Vesktop and Vencord, setting `enabledThemes`
while preserving every other settings key.

An existing checkout from another repository is never replaced. A matching
checkout with local changes is preserved and applied as-is; a clean matching
checkout advances to the declared commit. The manifest may identify exact
legacy revisions from older local-origin installs. Those recognized checkouts
are moved to a timestamped sibling backup before Haoshoku installs the clean
pinned theme, and a failed install restores the original checkout. This keeps
custom work recoverable while making a fresh laptop reproduce the tracked
appearance.

## Omarchy plugins

On Arch-family desktops, Haoshoku installs the plugins listed in
[`common/omarchy-plugins.json`](common/omarchy-plugins.json) by running
`omarchy plugin add <url> --enable --yes` for each one. Each repository is
cloned and enabled at its current default branch HEAD — there is no commit
or tag pinning. An entry may declare `disableOnInstall` to switch off a stock
widget it replaces. That list is applied only when Haoshoku first creates the
plugin and is never re-applied, so a user can re-enable a displaced widget
without a later Haoshoku run overriding the choice. Every run otherwise
reconciles manifest plugins back to installed and enabled. If
`omarchy plugin list --json` cannot provide a trustworthy snapshot, the helper
performs no plugin work and returns `snapshotUnavailable: true`; the
side-effect-free manual-auth checklist is still printed.

The manifest includes the Speech Orb dictation HUD. Setup turns off voxtype's
own OSD (`voxtype config set osd.enabled false`) and restarts a running
`voxtype.service`, so only the orb appears while you dictate.

These plugins run as arbitrary, unsandboxed code inside the long-lived
omarchy-shell process — the same risk Omarchy's own CLI warns about when
adding plugins manually. The `--yes` flag is passed deliberately so setup
stays unattended and non-interactive; this also suppresses Omarchy's
per-plugin confirmation/warning prompt, so only add this manifest to
machines where you trust and have reviewed those repositories. Plugins
that need manual setup afterwards (API tokens, OAuth, device pairing) are
printed as a manual-auth checklist after installation.
The Galaxy Buds plugin is installed from `aislandener/galaxy-buds-control` and
reports Bluetooth pairing in that checklist; it requires no credentials.
Pullbar (`io.github.ciryon.pullbar`) replaces both the former GitHub widget
(`robzolkos.github`) and Agent Usage Plus on the right side of the bar. The full Arch setup deploys its required
`~/.local/bin/omarchy-agent-usage-update` wrapper before installing plugins. If
running only selected steps, run `haoshoku --scripts` before
`haoshoku --omarchy-plugins`. That wrapper also scopes the Omarchy 4.0.0 Codex
collector's retired `-a untrusted` compatibility translation to usage refreshes;
ordinary Codex commands still execute the user's normal binary unchanged.

## Omarchy bar

Use `haoshoku --omarchy-bar` to deploy `configs/omarchy/bar.json`, and use
`haoshoku --omarchy-bar-backup` to capture the live bar back into the repo.
The same commands deploy and back up Haoshoku's bundled `xzat.tray` plugin at
`~/.config/omarchy/plugins/xzat.tray`. Its overflow drawer combines status
notifier items with Galaxy Buds, hyprmoncfg, Display, and No Sleep controls.
The full Arch setup restores the plugin and layout automatically; no separate
clone step is needed. Feishin and Omarchy's generic MPRIS widget remain in the
left section, while Pullbar and the stock Agents widget stay visible on the right.
Haoshoku claims the `bar` key of `~/.config/omarchy/shell.json` wholesale,
including bar-widget enablement. Disabling a bar widget through Omarchy's UI is
therefore reverted on the next deploy. Every other top-level key — including
`idle`, `plugins`, `disabledPlugins`, `version`, and unknown keys — is preserved.

## Agent and orchestration policy

Haoshoku deploys the compact Claude/Codex instructions. Routing and review
workflow policy live in Axstack. Independent skills are managed separately.
Back up live instruction edits with:

```bash
haoshoku --claude-backup
haoshoku --codex-backup
```

The shared profile lives at `configs/agent-profile/PROFILE.md`. Apply it to
Claude, Codex, Opencode, and Antigravity with `haoshoku --agents`, or capture
the live Claude copy with `haoshoku --agents-backup`. The bundled policy routes
both Notion accounts and Linear through the configured Executor MCP while T3 Code
remains responsible for orchestration. Profile sync preserves the live Axstack-owned
routing block; shared, Claude and Codex profile backups strip it so Axstack can
own it on fresh hosts. The shared profile names axnet roles: io is the control
center, iobook and the phone are access points, and iobox and axat-vps are
workers that do the work and never delegate.

T3 Code owns agent orchestration, and Axstack supplies routing policy.
Claude/Codex runtime state and `settings.json` remain machine-local.

### Current reconciliation and authority

The approved [setup reconciliation r2 and Claude/Codex addendum](docs/specs/2026-10-07-setup-reconciliation-r2.md)
remain the implementation baseline for [#63](https://github.com/axatbhardwaj/Haoshoku/issues/63)
and [#65](https://github.com/axatbhardwaj/Haoshoku/issues/65)/[#66](https://github.com/axatbhardwaj/Haoshoku/issues/66).
The subsequent instruction to complete the work and release authorizes the T3
driver to complete reviewed merges and the GitHub, npm and Linux binary release
after T1–T7. It supersedes the historical human-only merge and no-release gates
in dated specs and plans. Their original bodies and approvals remain historical.
Release authorization does not authorize installation, migration or configuration
on live hosts. See the [runbook's current gate](docs/runbooks/axstack-migration.md#release-and-execution-gate).

T1–T7 are merged for 12.3.0. Repository tests and package checks establish source behavior.
They do not prove publication, live Debian compatibility, desktop pairing,
Executor authentication or future T3 session inheritance. The 12.3.0 changelog
records merged changes; the driver verifies tag, npm and Linux binary publication
separately. Live installation and migration remain deferred.

### Existing-host migration

Haoshoku no longer installs, configures, or launches Paseo. Existing hosts keep
these artifacts until you remove them manually:

- `paseo-daemon.service` and `~/.paseo`;
- the `@getpaseo/cli` install and the `paseo-bin` desktop package;
- upstream Paseo skills;
- `~/.hermes/plugins/paseo-review-relay` and its data at
  `~/.hermes/plugin-data/paseo-review-relay`;
- `~/.local/bin/hermes-relay`;
- `~/.config/haoshoku/{hermes-relay,paseo-tasks,paseo-schedules}.json`.

Retiring these host artifacts needs a separate manual migration after checking
active consumers and preserving private recovery data. Normal and repeated
setup leaves existing skill directories, managed links, and theme preferences
untouched. Any existing-host skill migration is manual and separately scoped.

### Retired skill commands

Haoshoku no longer installs Matt Pocock skills or visual-explainer, and no
longer provides skill inventory, agent-skill sync, or theme configuration.
`--skills`, `--skills-update`, `--skills-list`, `--agent-skills`, and
`--explainer-theme <theme>` exit nonzero with guidance before setup runs.
The whole legacy `--agent-skills` route is retired, including archive/unlink
and sync behavior. Boolean, value-bearing `--flag=value`, malformed and combined
retired forms are refused before logging or setup; they cannot fall through to
full OS setup. Manage independent skills separately; use `haoshoku --axstack`
for Axstack workflows. Existing user-owned skills and configuration remain in place.

### Retired service and watcher commands

Claude Remote Control, Claude stay-awake, and PR watch are retired from future
Arch and Debian setup. `--claude-remote-control`,
`--claude-remote-control-backup`, `--claude-stay-awake`,
`--claude-stay-awake-backup`, `--pr-watch`, and `--pr-watch-backup` exit nonzero
with guidance before logging or setup runs. Manage existing services and
watchers separately; normal and repeated setup leaves their scripts, units,
enablement links, state, and Claude acceptance settings untouched.

## Haki launcher

On Omarchy, `haoshoku-special-workspace haki` opens the tagged Ghostty `haki`
split on its special workspace, with Claude above a fresh Codex pane below;
it has no default keybinding. KDE uses its own Warp `agents` route.
Set `claudeSessionName` in
`~/.haoshoku.json` only to resume a named Haki Claude session. A missing or null
value starts plain Claude; a
syntactically invalid value is preserved, reported, and ignored. A valid name is
passed as one literal argument to `claude -r`, but it resumes directly only when
the name resolves uniquely; otherwise Claude may open its picker. This Haki
launcher uses local Claude/Codex sessions without the retired Remote Control
services.

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
haoshoku --codex
haoshoku --codex-backup
haoshoku --server-t3-code
haoshoku --server-executor https://axat-vps.tail140c22.ts.net
# With EXECUTOR_AUTHORIZATION supplied securely in the environment:
haoshoku --executor-clients https://executor.example.net/mcp
haoshoku --device-type laptop
haoshoku --device-type iobox
haoshoku --fleet-ssh
haoshoku --agent-accounts
haoshoku --kde-connect-commands
haoshoku --audio
haoshoku --audio-backup
haoshoku --mimeapps
haoshoku --mimeapps-backup
haoshoku --gh-stack
haoshoku --worktree-cleanup
haoshoku --workspaces
haoshoku --gaming
haoshoku --gaming-split-lock
haoshoku --gaming-steam-autostart disabled
haoshoku --gaming-omakade-autostart enabled
haoshoku --monitors
haoshoku --hyprmoncfg-backup
haoshoku --omarchy-plugins
haoshoku --omarchy-bar
haoshoku --omarchy-bar-backup
haoshoku --omarchy-appearance
haoshoku --discord-theme
haoshoku --3-4-migrate
```

On Omarchy, the primary desktop app starts on workspace 1. Meta+1 brings its
window to workspace 1 and focuses it; Meta+6 brings it to workspace 6 and
focuses it. If the app is closed, either key launches it before placing it on
the selected workspace. The default is T3 Code Nightly (`t3code-nightly`).
`~/.config/haoshoku/primary-app` holds the executable on line 1 and an optional
window class on line 2; Nightly needs `com.t3tools.T3Code` there because its
desktop entry reports the wrong class. Without line 2, the desktop entry's
`StartupWMClass` identifies the window. Haoshoku creates this file on the first
`--workspaces` setup, migrates the retired Orca default, and otherwise preserves
your choice. Run `hyprctl reload` after editing it.

Use `haoshoku --device-type pc`, `laptop` or `iobox` to override automatic detection.
Later full Arch-family setups honor that stored explicit value.

`haoshoku --3-4-migrate` is a re-runnable, idempotent migration from an
Omarchy 3 layout to Omarchy 4: it strips dead `source =` lines, removes
orphaned overlay `.conf` files, repoints theme paths, backs up and clears
Omarchy's stock `monitors.lua`, deploys the Lua overlay and hyprmoncfg
profiles, installs plugins, and validates — and if Omarchy's legacy config
shim is still present it reports validation deferred and asks for a reboot
and re-run instead of claiming success.

Run `haoshoku --help` for the complete current list.

## iobox profile and fleet

The axnet fleet in [`configs/fleet.json`](configs/fleet.json) is io (PC, control),
iobook (laptop, access), iobox (always-on Omarchy agent box running T3, worker),
and axat-vps (Debian VPS running Executor and Hermes, worker). Everything is reached over Tailscale only.
Use MagicDNS short names (`ssh io`, `ssh iobook`, `ssh iobox`, `ssh axat-vps`);
Arch hosts use Tailscale SSH, and axat-vps keeps OpenSSH. Agents may SSH to any
fleet host and act there. Accepted risk: one compromised agent reaches every host.

`--device-type iobox` stores the profile; a later full setup uses
[`common/paru_applist_iobox.txt`](common/paru_applist_iobox.txt), including T3,
Tailscale, Claude/Codex dependencies, Git/gh and 1Password desktop plus `op` CLI.
It keeps Axstack, gh-stack, shared agent instructions, user scripts and Omarchy
appearance. It skips Flatpaks, gaming/Steam, uosc/MPV, the Bluetooth prompt,
Brave/Chromium profiles, KDE Connect, voxtype, bar/plugins, workspaces,
hyprmoncfg and audio. Standalone `--workspaces`, `--monitors`,
`--hyprmoncfg-backup`, `--audio` and `--audio-backup` refuse iobox. Reruns keep
previously installed apps; switching profiles does not uninstall anything.

The Arch T3 step enables and verifies user linger. On iobox it also masks and
verifies `sleep.target`, `suspend.target`, `hibernate.target`,
`hybrid-sleep.target` and `suspend-then-hibernate.target`. T3, Tailscale, linger
or sleep-mask failures stop iobox setup with the failed step named.

`--fleet-ssh` runs only fleet SSH setup on an Arch fleet host; Debian and
non-fleet hosts are refused without changes. Tailscale must report `BackendState`
`Running` and `MagicDNSSuffix` matching the manifest tailnet (`tail140c22.ts.net`)
before fleet actions. Otherwise standalone mode exits non-zero without writing
files; full Arch setup skips fleet SSH with a message.
It enables/verifies Tailscale SSH, writes `~/.ssh/config.d/haoshoku-fleet`, and
puts its Include first in `~/.ssh/config`, preserving user Host/Match blocks.
Arch peer keys from Tailscale go to `~/.ssh/known_hosts_fleet` with strict host
checking; offline peers retain their cached keys. VPS connections use
`~/.ssh/id_ed25519_vps` and `accept-new`, recording the first key in ordinary
`known_hosts`. Haoshoku does not create SSH keys, authorize them or edit ACLs.

`--agent-accounts` is opt-in elsewhere and runs by default on iobox after
Claude/Codex and shared-profile setup. It creates `~/.claude-alt` and
`~/.codex-alt`, sharing every other primary-home top-level entry by symlink
except these private entries:

| Home | Private entries (never linked) |
| --- | --- |
| Claude | `.credentials.json`, `.claude.json`, `history.jsonl`, `sessions`, `session-env`, `shell-snapshots`, `cache`, `backups`, `security`, `mcp-needs-auth-cache.json`, `.last-cleanup` |
| Codex | `auth.json`, `config.toml`, `models_cache.json`, `log`, `memories`, `tmp` |

Codex `config.toml` is copied once when the alt file is missing. Other runtime
state stays shared, including Claude `projects` and Codex `history.jsonl`,
`sessions` and SQLite files. Existing real entries and wrong/dangling links
are reported and preserved; private symlinks report incomplete account isolation.
Missing primary homes are skipped. Logins and T3 provider settings remain manual.

### Bring-up checklist

Run each host's setup locally. Until 12.4.0 ships, use a git checkout with Bun
for the new commands below; the installed 12.3.x package does not include them.

1. Set the hostname to `iobox` (`sudo hostnamectl set-hostname iobox`).
2. Install Bun (`yay -S --needed bun-bin`; Bun >= 1.3.14), then
   `git clone https://github.com/axatbhardwaj/Haoshoku.git` and `cd Haoshoku`.
3. Install T3 desktop (`yay -S --needed t3code-nightly-bin`), open it once with
   `t3code-nightly`, and disable **Local environment** in its settings. This creates
   the desktop settings file required by preflight; do this before the service step.
4. Install Tailscale (`sudo pacman -S --needed tailscale`), enable it with
   `sudo systemctl enable --now tailscaled.service`, then run `sudo tailscale up`
   and finish tailnet login. Haoshoku verifies it is installed, enabled and logged in.
5. In the checkout, run `bun install`, `bun haoshoku.js --device-type iobox`, then
   `bun haoshoku.js` as the ordinary setup user. If the T3 step stops, fix the
   reported condition (including desktop settings), then rerun `bun haoshoku.js`.
6. Complete two Claude paste-code logins: launch `claude`, use `/login`, then
   repeat with `CLAUDE_CONFIG_DIR=~/.claude-alt claude`.
7. Complete two Codex device logins: `codex login --device-auth`, then
   `CODEX_HOME=~/.codex-alt codex login --device-auth`.
   After completing the primary logins, rerun `bun haoshoku.js --axstack` if
   the first setup reported incomplete Axstack harness setup.
8. Supply `EXECUTOR_AUTHORIZATION` securely as described in
   [Executor clients](#opt-in-executor-clients), then register once per home:

   ```bash
   bun haoshoku.js --executor-clients https://axat-vps.tail140c22.ts.net/mcp
   CLAUDE_CONFIG_DIR=~/.claude-alt CODEX_HOME=~/.codex-alt bun haoshoku.js --executor-clients https://axat-vps.tail140c22.ts.net/mcp
   ```

   In T3, manually map provider instance `claudeAlt` to `CLAUDE_CONFIG_DIR=~/.claude-alt`
   and `codexAlt` to `CODEX_HOME=~/.codex-alt` (use absolute home paths in settings).
9. Run `gh auth login` and set your Git name/email; Omarchy skips Git identity setup.
   Then rerun `bun haoshoku.js --gh-stack` if the first setup skipped gh-stack.
   The end-of-run **Next steps** block lists incomplete gh-stack and Axstack
   setup, the reason, and the exact `haoshoku` command to rerun.
10. Create the iobox key with `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_vps` and
    authorize its public key on axat-vps by hand. Keep the private key local.
11. Create `~/.config/op/service-account.env` as a regular file owned by your user,
    mode 0600, containing exactly one non-empty `OP_SERVICE_ACCOUNT_TOKEN=` assignment
    (one trailing newline allowed). Never log or commit the value. Retry
    `bun haoshoku.js --tailscale-t3` to install the managed `haoshoku-op.conf` drop-in;
    an absent file only prints guidance. After token rotation or later creation
    with an existing drop-in, run `systemctl --user restart t3code`.
12. Complete T3 pairing using the service's pairing flow.
13. Ensure tailnet policy allows port 22 and a fleet SSH rule with `action: accept`.
    An overlapping `check` rule wins and breaks unattended SSH; policy edits are manual.
14. Smoke-test `ssh -o BatchMode=yes <peer> true` for each peer (from iobox:
    io, iobook and axat-vps). Check authenticated Executor tool discovery separately
    in both primary and alt T3 instances; registration alone does not prove access.

## Debian Server

```bash
haoshoku --os debian-server
```

The Debian path remains deliberately headless. In addition to server hardening,
it installs the portable Claude/Codex policy, Axstack, and Hermes
Telegram transport.
T3 Code is required and runs without a prompt; an incomplete T3 setup fails
Debian setup. `haoshoku --server-t3-code` runs the same step on its own.

### T3 single-backend preflight

Both `--tailscale-t3` on Arch and `--server-t3-code` on Debian check desktop
Local environment before writing T3 service configuration, installing, starting,
or restarting the service. This check also runs on an already configured rerun.
Runtime and CLI installation can precede this guard; refusal does not mean that
no prerequisite work occurred. The intended workstation topology is one service
backend shared by the desktop and phone, with desktop Local environment disabled.
The operator pairs each client separately; source checks do not prove pairing.

Haoshoku reads `desktop-settings.json` under the effective T3 base directory's
`userdata` folder, normally `~/.t3/userdata`. It checks the service's effective
`T3CODE_HOME`, pending unit configuration, and desktop installation, unit and
process evidence. Only an explicit JSON `localEnvironmentEnabled: false` proves
Local environment is disabled. A missing key means enabled. Missing settings
are safe only when no desktop installation, unit or process is detected; an
unused listening port does not prove a headless setup.

Enabled, malformed, unreadable or conflicting directory/settings evidence, and
failed probes, return incomplete setup before T3 service changes. Disable
**Local environment** in the T3 Code desktop, then pair the desktop to the
existing service. Resolve directory conflicts or unreadable evidence and retry.
Haoshoku never rewrites desktop settings or reads, changes or displays pairing
tokens. Explicitly disabled desktops and genuinely headless setups can proceed;
service installation/restart uses the checked base directory. Environment-file
and unsupported launch-directory overrides require manual reconciliation.

### Debian tailnet SSH firewall

Debian setup keeps OpenSSH and its existing key/deploy behavior. Before any UFW
change, it requires logged-in, running Tailscale with kernel networking and a
working, UP `tailscale0` carrying every reported valid IPv4/IPv6 tailnet address.
Missing addresses, a userspace-only interface or unreadable state fail preflight. Install Tailscale,
log in and verify `tailscale status --json` and
`ip -j address show dev tailscale0`, then retry Debian setup.

Setup adds `ufw allow in on tailscale0 to any app OpenSSH` before changing
defaults, retains HTTP/HTTPS rules, and keeps the **Enable UFW now?** confirmation.
UFW IPv6 support must already be enabled (`IPV6=yes` in `/etc/default/ufw`);
Haoshoku verifies active IPv4 and IPv6 tailnet SSH rules. Active UFW follows the
same checks and ordering without reset. Declining enable on inactive UFW,
skipping or failing configuration, or failing verification makes overall Debian
setup incomplete with retry guidance.

Existing public SSH allow/limit rules are preserved and reported as incomplete
hardening, including IPv6 rules and saved rules on inactive UFW. Confirm working
tailnet access, then separately inspect and migrate/remove broad rules as the
operator before retrying. Named application profiles are resolved through
read-only `ufw app info` port inspection, so web/mail profiles can coexist with
tailnet SSH. Failed, malformed or unresolved profile inspection remains
incomplete; correct the profile or inspection prerequisite and retry. Haoshoku
does not guess that an unknown profile is safe.
It never enables Tailscale SSH, disables sshd, changes tailnet ACLs, or deletes
existing firewall rules. Custom rules outside UFW's managed rules require a
separate operator audit.

### Debian T3 service setup

Before setup, install Tailscale yourself and log in to your tailnet. Confirm
that `tailscale status` succeeds. Enable HTTPS certificates in the tailnet
admin console. For a non-root service account, run
`sudo tailscale set --operator=$USER` so T3 can manage its Serve route. Your
phone must also be logged in to the same tailnet. Haoshoku does not install
Tailscale or log in for you.

Haoshoku prepares a compatible Node.js runtime and reuses `t3` on PATH when
`t3 --version` is at least `0.0.46-nightly.20261003.2610` (Axstack's floor).
Otherwise, it installs a durable nightly CLI with
`npm --global --prefix ~/.local install t3@nightly` and verifies the installed
version. Setup reads `t3 connect status --json`, unlinks enabled Connect
exposure, and confirms it is disabled before changing the service.

Before `t3 service install`, Haoshoku writes `axstack-path.conf` and
`axstack-tailscale.conf` in `~/.config/systemd/user/t3code.service.d/`.
They set `T3CODE_TAILSCALE_SERVE=true` and keep the user's Grok CLI on the
service PATH:

```ini
PATH=%h/.local/bin:%h/.bun/bin:%h/.grok/bin:/usr/local/bin:/usr/bin:/bin
```

Only root gets
`axstack-sandbox.conf` with `IS_SANDBOX=1`. The service belongs to the account
that runs Haoshoku, including root when root ownership is intentional.

Setup requires an active `t3code.service`, a `tailscale serve status --json`
HTTPS mapping to `http://127.0.0.1:3773`, and a successful response from the
tailnet HTTPS URL. Readiness retries are bounded to 30 attempts with a
five-second HTTPS timeout and two seconds between attempts. Failure reports
what to inspect and returns incomplete setup. T3 stays bound to localhost.

After setup, pair the phone using `t3 pair --tailscale`. If the CLI was freshly
installed and `~/.local/bin` is not on PATH yet, run
`~/.local/bin/t3 pair --tailscale`. T3 Connect authorization is no longer part
of this flow. If a service self-update has advanced past npm's nightly tag,
a rerun may fail; inspect `t3 --version` and retry once the nightly tag catches
up.

The full Debian path asks about Git and automatic worktree cleanup.

### VPS Hermes Telegram transport

`haoshoku --server-hermes-relay` verifies Hermes Telegram transport on a
Debian-family server. Full Debian setup fails if Hermes readiness is incomplete.
Arch/Omarchy setup never calls it.

An existing usable Hermes installation is kept without upgrading or replacing
it. If Hermes is absent, Haoshoku downloads the official installer and installs
the pinned commit from
[`configs/hermes-relay/hermes-runtime.json`](configs/hermes-relay/hermes-runtime.json)
with `--skip-setup --skip-browser --skip-computer-use --non-interactive`.
Credentials and gateway setup remain manual. Complete these private steps
without placing secrets in this repository:

1. Run `hermes setup` so `$HERMES_HOME/config.yaml` exists (`HERMES_HOME`
   defaults to `~/.hermes`). Configure `TELEGRAM_BOT_TOKEN` in its `.env`.
2. Set exactly one owner in `TELEGRAM_ALLOWED_USERS`. Set the private Telegram
   home channel in `TELEGRAM_HOME_CHANNEL` or
   `platforms.telegram.home_channel.chat_id` in `config.yaml` to that same ID.
3. Install startup with
   `hermes gateway install --no-start-now --start-on-login`, start or verify the
   gateway manually, then rerun `haoshoku --server-hermes-relay`.

The command succeeds only when Hermes is usable, its config exists, the bot
token is configured, the private home channel resolves, and the gateway reports
running. Missing or unverifiable readiness returns failure with retry guidance.
A busy running gateway passes. Haoshoku never prompts for activation, restarts
the gateway, or deploys or enables a relay plugin.
It preserves existing Hermes config, credentials, plugins, plugin data, and
legacy relay markers. Telegram notifications use `hermes send`.

Debian Server does not ask for `deviceType`: that value only selects desktop
audio and Hyprland/Omarchy variants. For the same reason the Debian path does
not deploy audio, browser/MIME integration, the desktop-oriented user-script
bundle, Brave managed policies, Hyprland monitors/workspaces, or Omazed. Those
steps remain on the Arch/Omarchy path instead of being installed onto a
headless server for superficial symmetry.

## Logs and troubleshooting

Setup and configuration runs save a private log under
`${XDG_STATE_HOME:-~/.local/state}/haoshoku/logs/` (directory 0700, files
0600). The last 20 logs are kept. Logs include device/version metadata,
`log.*` messages, command exits and durations, and bounded failure output.
Command output is forwarded live while stdin stays inherited for prompts.
Some programs omit colours or progress bars when their output is captured.
Known credential patterns and Tailscale login URLs are redacted before writing.
The final line shows the log path; failures also show their count and names.
If logging is unavailable, Haoshoku warns once and continues.
`--help`, `--version`, and `--share-log` leave existing logs untouched.

Normal runs upload nothing. To share the latest completed run, or a specific log:

```bash
haoshoku --share-log
haoshoku --share-log /path/to/run.log
```

Haoshoku tries Taildrop to the online device `io` first. Override the receiver
with `HAOSHOKU_LOG_TARGET=other-device`. On **io**, collect the file with:

```bash
tailscale file get ~/Downloads
```

Tell your agent the filename shown by `--share-log`. If Taildrop is unavailable
and GitHub CLI is authenticated, Haoshoku creates a secret gist and prints its
URL. Otherwise it prints the local path for copying or attaching to your agent
conversation. A failed upload keeps the file and reports failure.

## Development

Run `bun test` from the repository root; the `bunfig.toml` preload that isolates HOME for tests only applies there.

```bash
bun install
bun test
bun run lint
```

## Opt-in Executor server

```bash
haoshoku --server-executor https://axat-vps.tail140c22.ts.net
```

Run this command as root on Debian with Docker, Docker Compose v2 and `ss`
already available. Executor is never provisioned by default Arch or Debian
setup. Supply an explicit HTTPS origin (host and optional port, optionally a
trailing `/`). Credentials, other paths, queries and fragments are rejected.
The origin is omitted from Haoshoku run logs; no credentials are requested or
written by this installer.

The default is a tailnet-only HTTPS origin via operator-managed Tailscale Serve:
`https://axat-vps.<tailnet>.ts.net` (fleet: `https://axat-vps.tail140c22.ts.net`).
Forward it to `127.0.0.1:4788`, including `/api`, `/mcp` and `/.well-known`;
run setup and clients with tailnet access. Public reachability is not required.
Only OAuth providers that fetch callbacks or client metadata
server-side need temporary public exposure via operator-managed Funnel; arrange
that exception for their flow and restore tailnet-only access afterwards.
Haoshoku never changes nginx, DNS, TLS, firewall rules, Tailscale Serve/Funnel or
OAuth client credentials. The hand-edited VPS compose remains operator-managed:
a rerun refuses a differing compose rather than undoing the move to Serve.

A fresh deployment pulls `ghcr.io/usefulsoftwareco/executor-selfhost:latest`,
resolves its digest, checks the image's `65532:65532` runtime user and `/data`
volume, and pins that digest in `/srv/executor/docker-compose.yml`. The only
published port is `127.0.0.1:4788:4788`. `EXECUTOR_WEB_BASE_URL` supplies the
explicit HTTPS origin. Haoshoku creates a private empty `data/` directory and
changes ownership of that directory once; it never recursively changes data
ownership. Upstream persists its database and generated encryption/session keys
there. `haoshoku-executor.json` records the managed format and pulled digest.

An existing manually configured deployment, differing compose file, unknown
path, symlink, partial deployment, incompatible data ownership or conflicting
container/port stops before pulling or starting anything. Existing files remain
intact. Inspect and manage such deployments manually; there is no force,
automatic adoption, migration, cleanup or upgrade path. A matching managed rerun
checks the running `executor-selfhost` container and application without pulling,
recreating, restarting, updating or rewriting it. Supported managed data files
are `data.db` (plus SQLite `-wal`/`-shm` files), `secret.key` and `auth-secret.key`;
additional files require manual inspection.

Readiness checks require `/api/health` JSON with `status: "ok"` and Executor's
OAuth authorization-server metadata advertising the configured origin and
`/api/auth/mcp` endpoints, on both loopback and the configured HTTPS origin. Each
request, including its body, has a five-second deadline and a 16 KiB limit;
verification makes at most five attempts, with one second between failed attempts
(at most four retries). Redirects, proxy HTML, generic error
responses and wrong metadata fail. A failed step exits nonzero and preserves
partial state for manual inspection; rerunning never tries destructive repair.

“Container ready” does not prove owner onboarding, an authenticated MCP
handshake or healthy integrations. Complete first-owner signup yourself in the
tailnet web UI, then configure authentication, policies and integrations there.
Haoshoku does not create owners, API keys, policies or OAuth connections.

## Opt-in Executor clients

For an ordinary agent user, run this standalone command after making the existing
Executor HTTPS MCP endpoint and its authentication available:

```bash
# Supply EXECUTOR_AUTHORIZATION securely in this process environment first.
haoshoku --executor-clients https://executor.example.net/mcp
```

`EXECUTOR_AUTHORIZATION` must contain the **complete** Authorization header value:
`Bearer ` followed by the API key/token accepted by that endpoint. Do not put the
secret in CLI arguments, a tracked file, or shell history. Missing, empty, raw-token,
and newline-bearing values are rejected without printing them. The command stores
only an environment reference, never the authorization value. HTTPS is required;
ports and endpoint paths such as `/mcp` are supported, credentials/query/fragment
are rejected. This endpoint differs from `--server-executor`'s origin-only input.

The command adds an `executor` HTTP entry for **both Claude Code and Codex**.
It requires no root privileges or harness subprocess and can run from any directory.
It is separate from server provisioning and never creates accounts, keys, policy
rules, or integrations. It is not part of default OS setup and cannot be combined
with another mode or `--os`.

Supported configuration locations:

- Claude Code: `$HOME/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when that
  override is nonempty. The entry lives in the top-level `mcpServers` map (user
  scope), with `"headers": {"Authorization": "${EXECUTOR_AUTHORIZATION}"}`.
- Codex: `$CODEX_HOME/config.toml`, defaulting to `$HOME/.codex/config.toml`.
  The `[mcp_servers.executor]` table uses
  `env_http_headers = { Authorization = "EXECUTOR_AUTHORIZATION" }`.

Claude's legacy `$HOME/.claude/.config.json` or
`$CLAUDE_CONFIG_DIR/.config.json` takes precedence over the standard file.
If that path exists (including a link), or its layout cannot be safely inspected,
setup refuses before writing either client. A default `$HOME/.claude` directory
with group write permissions or a resolvable symlink is supported when no legacy
file exists and lookup succeeds; it is only a lookup path. Actual write-target ownership, permissions
and link checks still apply, including to an explicit `CLAUDE_CONFIG_DIR`.
It never reads, adopts or rewrites the legacy file. Use manual user-scope MCP
setup in the intended Claude/Codex environment for these layouts. An explicitly empty `CLAUDE_CONFIG_DIR` is
ambiguous for legacy lookup; unset it for the default home or set an absolute home.

Nonempty `CLAUDE_CODE_CUSTOM_OAUTH_URL`, `USE_STAGING_OAUTH` or `USE_LOCAL_OAUTH`
also causes refusal before either write; use manual setup with that environment.
Custom OAuth selects `.claude-custom-oauth.json`. The installed production Claude
2.1.292 fixes its staging/local filename selector to production; other builds'
`.claude-staging-oauth.json` / `.claude-local-oauth.json` targets are unsupported.
The switches are refused conservatively for any nonempty value, including `0`
or `false`; setup does not interpret their value semantics or change them.

Use absolute homes for the intended non-root user; `XDG_CONFIG_HOME` does not
redirect these MCP files. Auth references are resolved from the harness environment
when it loads/connects the server, rather than saved as credentials during setup.
Both use the header verbatim, so the environment value must include `Bearer `.
This contract was checked against Claude Code **2.1.292**, Codex **0.160.1**, and the
[Claude MCP documentation](https://code.claude.com/docs/en/mcp),
[Claude environment settings](https://code.claude.com/docs/en/env-vars), and
[Codex MCP](https://developers.openai.com/codex/mcp) /
[config-home documentation](https://developers.openai.com/codex/config-advanced).
Actual native offline readback with Claude **2.1.292** and Codex **0.160.1**
confirmed the helper-written user entries and environment header references.
That readback did not authenticate or discover tools. Live client access and T3
inheritance remain unverified. Other clients require their own supported
configuration contracts; older versions and other Claude builds are unverified.

Both files are inspected before writes. A matching entry is a config no-op,
including file permissions and timestamps. A differing or unknown `executor`
entry stops: reconcile it manually in the effective user config, then retry.
Existing inline credentials remain opaque; this command does not migrate them.
Unrelated JSON bytes, settings, TOML sections, and comments are retained. Duplicate
JSON keys, malformed configs, linked files/directories, foreign ownership, and
shared write permissions are refused. The additive TOML path conservatively refuses
multiline strings and inline/dotted `mcp_servers` parent definitions; use regular
MCP tables or configure the entry manually for those shapes.

New config files use mode 0600 and new directories 0700; existing file modes are
preserved. Existing files are updated in place, with changed-input checks before
writing and restoration from memory after caught write failures. No secret-bearing
backups or temporary config copies are created. Run with other config writers
stopped: these two file updates are not an atomic transaction across crashes or
power loss. An incomplete/recovery warning requires manual inspection of both
files before retrying; empty directories may remain after a failed fresh setup.

For **T3-launched sessions**, run setup with the homes of the user that runs the
future T3 backend/harness. That backend and its future child sessions must inherit
`EXECUTOR_AUTHORIZATION` and the same `HOME`, `CODEX_HOME`, and/or
`CLAUDE_CONFIG_DIR`. Exporting in an unrelated terminal does not update an already
running backend. This command does not alter T3 provider settings, services, launch
environments, or sessions. Managed/project config and explicit launch overrides
can take precedence over these user entries.

“Configuration written” or “already matches” proves only local registration.
This command does **not** contact Executor, authenticate, run OAuth, discover tools,
or verify account/integration access. Check an authenticated MCP handshake and
expected tool discovery separately in the intended future harness session.
