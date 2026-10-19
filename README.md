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
`t3` stable >= 0.1.0 on PATH. Haoshoku enforces that floor independently of
Axstack. On Arch/Omarchy, desktop and iobox setup explicitly selects
`aur/t3code-bin`, so an older Omarchy repository package cannot win the lookup.
An already installed desktop below 0.1.0, prerelease or unknown version is held;
Haoshoku prints `yay -S aur/t3code-bin` (or the selected helper) for a backed-up,
operator-controlled replacement. Unrelated packages continue.

The stable desktop package can ship only `t3code`; setup does not assume it also
provides `/usr/bin/t3`. Axstack harness installation reuses an already runnable
stable CLI >=0.1.0 on the caller's PATH, including unmanaged and fleet archive
CLIs, without a T3 registry lookup or Node/npm prerequisite checks. When CLI
preparation is needed, Haoshoku installs supported `t3@latest` under `~/.local`
or reuses a genuinely available stable package-owned CLI. Standalone
`--tailscale-t3` retains its strict origin/version/runtime guards. Arch lists
include `nodejs` and `npm`; the selected Node runtime must meet ^22.16, ^23.11 or
>=24.10 on the service PATH, including mise shims. Arch never runs the Debian
Node bootstrap. A missing or incompatible prerequisite reports incomplete setup.

Only the exact old managed `/usr/bin/t3-nightly` alias or a verified local npm
install can migrate after origin/version checks. npm replacement is staged and
verified before switching the alias; a failed installation preserves it.
Unmanaged executables, custom links and fleet archive aliases remain unchanged;
CLI preparation and service migration hold them until explicitly selected by
the operator. Unknown/newer CLI
versions and unsupported runtimes hold migration, and installing stable over an existing nightly
package or unmanaged desktop remains a bounded T3 package hold. Desktop Local
environment, single-server preflight and provider settings retain their existing
policy; no theme synchronization is added.

Run `haoshoku --axstack-check` to report the shim/version, each harness check,
and `roles.json` presence at `~/.claude/skills/axstack/roles.json` and
`~/.agents/skills/axstack/roles.json` separately. The role-file readback
does not affect check success.
Claude and Codex setup skip config synchronization when their CLI installation fails.

## Arch and Omarchy behavior

[Read this section](README/arch-and-omarchy-behavior.md#arch-and-omarchy-behavior).

## Omarchy appearance

[Read this section](README/omarchy-appearance.md#omarchy-appearance).

## Omarchy plugins

[Read this section](README/omarchy-plugins.md#omarchy-plugins).

## Omarchy bar

[Read this section](README/omarchy-bar.md#omarchy-bar).

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
workers that do the work locally and never hand work to another host. T3
subagents and reviewers on the same host are fine.

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
the selected workspace. The default is T3 Code stable (`t3code`).
`~/.config/haoshoku/primary-app` holds the executable on line 1 and an optional
window class on line 2; the managed T3 default uses `com.t3tools.T3Code` for
reliable window matching. Without line 2, the desktop entry's
`StartupWMClass` identifies the window. Haoshoku creates this file on the first
`--workspaces` setup and migrates the exact old two-line nightly default
(`t3code-nightly` / `com.t3tools.T3Code`) or retired Orca default. Custom
executables and custom class overrides stay unchanged; reruns keep stable.
Run `hyprctl reload` after editing it.

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

[Read this section](README/iobox-profile-and-fleet.md#iobox-profile-and-fleet).

### Bring-up checklist

[Read this section](README/iobox-profile-and-fleet.md#bring-up-checklist).

## Debian Server

The full Debian path includes the optional daily disk-cleanup job.

[Read this section](README/debian-server.md#debian-server).

### T3 single-backend preflight

[Read this section](README/debian-server.md#t3-single-backend-preflight).

### Debian tailnet SSH firewall

[Read this section](README/debian-server.md#debian-tailnet-ssh-firewall).

### Debian T3 service setup

[Read this section](README/debian-server.md#debian-t3-service-setup).

### One-time current Omarchy palette in T3 desktop

[Read this section](README/debian-server.md#one-time-current-omarchy-palette-in-t3-desktop).

### VPS Hermes Telegram transport

[Read this section](README/debian-server.md#vps-hermes-telegram-transport).

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

[Read this section](README/opt-in-executor-server.md#opt-in-executor-server).

## Opt-in Executor clients

[Read this section](README/opt-in-executor-clients.md#opt-in-executor-clients).
