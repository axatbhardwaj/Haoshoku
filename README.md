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

```bash
git clone https://github.com/axatbhardwaj/haoshoku.git
cd haoshoku
bun install
bun link
haoshoku --os arch
```

`bun haoshoku.js --os arch` works without creating a global link. The legacy
`--os cachyos` spelling is accepted with a deprecation warning.

Install the pinned, checksum-verified Axstack release and configure its Claude
and Codex harness targets with `haoshoku --axstack`. Run
`haoshoku --axstack-check` to report the shim/version, each harness check, and
the Paseo profile-file readback separately.
Claude and Codex setup skip config synchronization when their CLI installation fails.

## Arch and Omarchy behavior

The Arch setup:

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
- installs only JetBrains Mono Nerd Font instead of the conflicting complete
  Nerd Font group;
- installs the AUR `paseo-bin` desktop app, launches `/usr/bin/paseo` at login,
  and binds `Super+T` to its exact `Paseo` window class. The absolute desktop
  path prevents a user-installed Paseo CLI in `~/.local/bin` from shadowing it;
- keeps Bash as the account shell and adds portable aliases and tool
  initialization through `~/.config/haoshoku/bashrc`;
- preserves Omarchy's `.bashrc`, lock screen, and core Quickshell/Hyprland
  configuration. It asks Omarchy to apply the pinned Elysian theme, selected
  background, and font from `configs/omarchy/appearance.json`; it does not
  copy generated `current/theme` state between machines. Displaced Omarchy
  keybindings are
  relocated or explicitly superseded and documented in
  [`configs/omarchy/keybinding-swaps.json`](configs/omarchy/keybinding-swaps.json),
  the canonical swap record;
- deploys `~/.config/hypr/haoshoku/{bindings,workspaces}.lua` and appends
  exactly two `require` lines to `~/.config/hypr/hyprland.lua`; Omarchy 4
  loads user config via `require()` and no longer sources `.conf` files;
- automatically determines `pc` or `laptop` from Linux DMI chassis data, with
  battery detection as the fallback, and saves it to `~/.haoshoku.json` before
  device-routed audio and Hyprland configuration. A valid stored choice wins,
  so `haoshoku --device-type pc|laptop` remains the explicit override. Only
  ambiguous hardware falls back to the interactive selector; Skip persists
  nothing and leaves device-specific audio unset;
- keeps Claude stay-awake, PR watch, and the Matt Pocock skill set as portable
  setup steps. Full setup asks before Claude Remote Control and automatic git
  worktree cleanup; both default to No. The worktree offer explains that it enables a
  persistent weekly timer running
  `cleanup-worktrees.sh --apply`, which deletes eligible worktrees. Without
  interactive confirmation—including piped stdin—Haoshoku declines these real
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
  S stash, and `Super+Shift+X` X (`Super+Shift+S` stashes the focused window);
  see the canonical swaps JSON above for every Omarchy default relocated or
  superseded to make room;
- starts Steam and Omakade silently on gaming workspace 2 at login, binds
  `Super+2` to Omakade, and keeps `Super+Shift+G` as the gaming-workspace
  toggle that ensures Steam. Use
  `haoshoku-gaming-workspace place -- %command%` as a Steam launch option to
  move the launched game's process-tree windows there;
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
commands.

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
Agent Usage Plus replaces both Omarchy's stock `omarchy.agents` widget and the
older `robzolkos.agent-usage` plugin. The full Arch setup deploys its required
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
left section, while Agent Usage Plus stays visible on the right.
Haoshoku claims the `bar` key of `~/.config/omarchy/shell.json` wholesale,
including bar-widget enablement. Disabling a bar widget through Omarchy's UI is
therefore reverted on the next deploy. Every other top-level key — including
`idle`, `plugins`, `disabledPlugins`, `version`, and unknown keys — is preserved.

## Agent and orchestration policy

Haoshoku deploys the compact Claude/Codex instructions, installs the Matt
Pocock and upstream Paseo skill sources through the Skills CLI, and syncs its
three owned workflow skills: `model-routing`, `paseo-pr-babysit`, and
`paseo-pr-review`. It also installs the pinned upstream `visual-explainer`
payload without treating it as a Haoshoku-owned backup source. Back up live
edits with:

```bash
haoshoku --claude-backup
haoshoku --codex-backup
haoshoku --agent-skills-backup
haoshoku --paseo-profiles-backup
```

`--paseo-profiles` merges the bundled profile IDs and whitelisted provider
fields into `~/.paseo/config.json`, preserving unknown profiles, credentials,
relay/listen/auth settings, and every unrelated key. Its backup writes only
profile fields plus provider `extends`, `label`, `description`, `command`, and
`enabled`; it never copies credentials, daemon identity, relay state, or
runtime files. Claude/Codex runtime state and `settings.json` remain
machine-local.

The visual explainer defaults to a fixed dark theme. Set and persist a different
preference with `haoshoku --explainer-theme dark|light|system`; an explicit
theme in a request takes precedence. Fixed dark or light output uses the full
upstream renderer, while the system theme may use quick mode. On the first
sync after this migration, Haoshoku archives the retired shared
`html-deliverables` skill under `~/.config/haoshoku/retired-agent-skills/`
before removing only its managed Claude/Codex links.

`haoshoku --agent-skills` also ensures
`~/.config/haoshoku/paseo-tasks.json`. Its defaults enable the future-task
lifecycle, readable `<Task or PR> · <Role>` chat names, and archival after the
parent records completion. Configure it independently with:

```bash
haoshoku --paseo-tasks
haoshoku --paseo-tasks-enabled enabled
haoshoku --paseo-tasks-enabled disabled
haoshoku --paseo-task-renaming enabled
haoshoku --paseo-task-renaming disabled
haoshoku --paseo-task-cleanup archive
haoshoku --paseo-task-cleanup keep
```

The config merge preserves unknown fields. Malformed JSON or invalid owned
fields are left byte-for-byte untouched and return failure; the routing policy
then makes no metadata or cleanup changes. `keep` disables completion cleanup
without disabling shared task labels.

### Bounded Paseo schedule settings

Haoshoku can manage only the provider, model, reasoning effort, and optional
mode of three explicitly mapped native Paseo `new-agent` schedules. Initialize
the private host-local config, preview it, and apply verified differences with:

```bash
haoshoku --paseo-schedules
haoshoku --paseo-schedules-check
haoshoku --paseo-schedules-apply
```

The config lives at `~/.config/haoshoku/paseo-schedules.json`. It starts with
all `scheduleId` values set to `null`: stale archive and worktree cleaner use
Claude Sonnet 5 at high reasoning, while merge readiness uses Codex Luna at
high reasoning. Run the configure command in a terminal to select only the
roles this host owns and enter each native schedule ID and settings. An
unmapped role is skipped, so a host may own none, one, or several roles.

`--paseo-schedules-check` is read-only. It validates every mapped ID against
the running local daemon, requires a `new-agent` target, and reports capability
support plus owned-field differences. `--paseo-schedules-apply` repeats the
full preflight, writes an exclusive mode-`0600` backup under
`~/.config/haoshoku/paseo-schedule-backups/`, updates only differences through
Paseo's native API, and verifies readback. Cadence, prompt, status, safety
settings, limits, and every other schedule remain untouched. If a write was
attempted but verification fails, inspect the reported schedule and backup
before retrying; Haoshoku never retries or rolls back uncertain state
automatically.

These modes never infer ownership from schedule titles, create, delete, pause,
resume, or run schedules, and never reload or restart Paseo. Normal Haoshoku
setup does not configure, check, or apply schedules. Run the command locally on
each host; ambient `PASEO_HOME` and `PASEO_HOST` values are ignored.

This is a bundled model-routing convention implemented with existing Paseo
metadata and preferred no-force archive commands, not a new daemon feature,
timer, state engine, or native UI grouping/filter. Paseo 0.7.2 performs the
running-state check before its archive API call, so it cannot guarantee atomic
idle-only archival; the convention requires owner quiescence, no pending
launches, and an immediate recheck, retaining ambiguous workers. Each future
run gets an identity made from its human task slug, full parent agent ID, and a
fresh run discriminator. The bundled task-lifecycle reference is the
authoritative procedure: it keeps workflow chats available until completion
and requires exit reconciliation before a final response, handoff, or driver
archive. Exact rosters plus launch/reuse and current label-update receipts bind
supported background CLI launches even when `ParentAgentId` is null; mismatched
non-null parentage is retained. Cross-run reuse first settles the prior run,
then re-rosters and relabels the exact agent. Provider-native subagents remain
inside their owning Paseo agent's report and never receive Paseo lifecycle
commands. Existing chats are not inferred or migrated. Phone and desktop
clients on the same daemon see the same metadata; each independent agent host
must run its own Haoshoku configuration.

Ordinary documentation uses `docs`; PR correctness and requirements review
use `pr-correctness` and `pr-requirements`. Targeted web research uses
`research-web`. Recurring PR monitoring uses `pr-monitor`, while the independent
`pr-watchdog` checks its health. Exact profile defaults are 21 total: 2 high, 10
medium, 6 low, 2 xhigh, and 1 max:

- Xhigh: `explore-codebase` and `explainer` (Sonnet), as explicit fixed
  exceptions rather than a blanket escalation policy.
- High: `pr-security`, `pr-architecture`.
- Max: `explainer-review` (Luna), independently reviewing the exact artifact.
- Medium: `planning-advisor`, `research-requirements`, `research-code`,
  `implement-code`, `review-code`, `pr-correctness`, `pr-integration`,
  `pr-requirements`, `pr-complexity`,
  `explainer-content-review`.
- Low: `research-web`, `docs`, `pr-monitor`, `pr-watchdog`,
  `explore-execution`, `explainer-content`.

The bundled Grok provider is disabled; no active workflow role selects it.
Its compatibility definition preserves existing authentication without enabling usage. During an upgrade,
Haoshoku removes superseded managed workflow IDs only when their replacement is
present in the bundled policy; custom profile IDs and provider secrets remain
untouched.

Ordinary peer PR review and implementation checkpoints use one `review-code`
session covering Standards, Spec and the shared simplicity checklist directly.
The six-angle workflow is reserved for an explicit six-angle request or
documented, substantial high-risk work needing genuinely distinct coverage. A
direct invocation of upstream `code-review` retains its two-axis native-subagent
method.

PR babysitting launches the Opus monitor and watchdog as separate sessions.
Each owns its own expiring heartbeat; healthy ticks update snapshots without
waking the driver, while failures and renewal needs are deduplicated and sent
to the driver for acknowledgement and coordination.

Substantial research starts with the profile matching the unresolved question;
another researcher is added only for a distinct unresolved question or high-risk
independent validation. Requested visual artifacts use the
`explainer` presentation profile and the pinned upstream visual-explainer;
source-content and independent visual review profiles remain available when
the artifact's risk warrants them. Ordinary prose stays prose, with no
mandatory Markdown-to-HTML chain. Upgrades retire the former `research-sonnet`
and `explainer-sonnet` IDs only when their respective replacements are bundled.
Prefer Astra at low effort when choosing the main conversation; the actual
selected model remains the driver. Escalation is bounded to the reasoning work
that needs it; outside the two fixed Sonnet roles, xhigh is reserved for an
explicit exceptional request, and unrelated work returns to low. Fable Advisor (`planning-advisor`) runs at
medium and is consulted only for unresolved consequential decisions after cheap
factual checks; there is no dedicated Astra advisor profile or mandatory
two-advisor council. High-stakes decisions still require Fable's plain AGREE and
the driver's accepted assessment; an unavailable Fable pauses only that
decision unless the user explicitly overrides the gate. Ordinary nontrivial
changes use a Sol medium author and an independent Opus medium reviewer.
High-stakes changes use an Opus high author and a fresh Sol high reviewer; the
same author owns fixes, and the reviewer session must have authored none of the
candidate, including uncommitted work. Simple known edits stay direct.
Discovery, workspace ownership and unchanged skill references are cached for
the task and refreshed on relevant configuration or capability changes.

## Claude Remote Control

The optional Claude Remote Control setup runs persistent Claude sessions from
three fixed roots: `haki` at `$HOME`, `dev` at `$HOME/dev`, and `work` at
`$HOME/Work`. Instances whose roots do not exist are skipped with a warning.
On Omarchy, `haoshoku-special-workspace haki` opens the tagged Kitty `haki`
session on its special workspace, with Claude above a fresh Codex pane below;
it has no default keybinding. KDE uses its own Warp `agents` route.
Set `claudeSessionName` in
`~/.haoshoku.json` only to resume a named Haki Claude session. A missing or null
value starts plain Claude; a
syntactically invalid value is preserved, reported, and ignored. A valid name is
passed as one literal argument to `claude -r`, but it resumes directly only when
the name resolves uniquely; otherwise Claude may open its picker. This
Haki launcher never attaches to tmux
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
haoshoku --codex
haoshoku --codex-backup
haoshoku --server-t3-code
haoshoku --server-paseo
haoshoku --device-type laptop
haoshoku --kde-connect-commands
haoshoku --audio
haoshoku --audio-backup
haoshoku --mimeapps
haoshoku --mimeapps-backup
haoshoku --skills
haoshoku --skills-update
haoshoku --skills-list
haoshoku --agent-skills
haoshoku --agent-skills-backup
haoshoku --explainer-theme dark
haoshoku --paseo-tasks
haoshoku --paseo-tasks-enabled disabled
haoshoku --paseo-task-renaming disabled
haoshoku --paseo-task-cleanup keep
haoshoku --paseo-schedules
haoshoku --paseo-schedules-check
haoshoku --paseo-schedules-apply
haoshoku --paseo-profiles
haoshoku --paseo-profiles-backup
haoshoku --gh-stack
haoshoku --claude-stay-awake
haoshoku --pr-watch
haoshoku --worktree-cleanup
haoshoku --workspaces
haoshoku --monitors
haoshoku --hyprmoncfg-backup
haoshoku --omarchy-plugins
haoshoku --omarchy-bar
haoshoku --omarchy-bar-backup
haoshoku --omarchy-appearance
haoshoku --3-4-migrate
```

Use `haoshoku --device-type pc` or `laptop` to override automatic detection.
Later full Arch-family setups honor that stored explicit value.

`haoshoku --3-4-migrate` is a re-runnable, idempotent migration from an
Omarchy 3 layout to Omarchy 4: it strips dead `source =` lines, removes
orphaned overlay `.conf` files, repoints theme paths, backs up and clears
Omarchy's stock `monitors.lua`, deploys the Lua overlay and hyprmoncfg
profiles, installs plugins, and validates — and if Omarchy's legacy config
shim is still present it reports validation deferred and asks for a reboot
and re-run instead of claiming success.

Run `haoshoku --help` for the complete current list.

## Debian Server

```bash
haoshoku --os debian-server
```

The Debian path remains deliberately headless. In addition to server hardening,
it installs the portable Claude/Codex policy, Matt Pocock and upstream Paseo
skills, Haoshoku-owned workflow skills, PR-watch, and the native Paseo daemon.
Paseo is required and its managed orchestration policy is synced after the
service is ready. T3 Code is an optional, default-No compatibility step.

When T3 Code is selected, Haoshoku ensures its current Node.js runtime range
before installing and verifying the upstream-managed service. It then inspects
T3 Connect's machine-readable status. An existing
provisioned link is left running without reauthorization or restart. Otherwise,
Haoshoku runs `npx --yes t3@latest connect link --headless` in the attached
terminal, allowing T3 to install and verify its managed relay client and guide
you through browser authorization. It updates and restarts `t3code.service`,
waits for the environment link and relay to become ready, and verifies the
service again. The service belongs to the account that runs Haoshoku, including
root when root ownership is intentional.

T3 remains bound to `127.0.0.1:3773`; Haoshoku does not create an Nginx virtual
host, change DNS, open that port, or add a firewall rule. After setup, open the
T3 Code phone app, choose T3 Connect, and sign in with the same account used
during authorization. The phone does not need Tailscale. Run
`haoshoku --server-t3-code` to install or repair only this complete server
component; normal Debian setup offers the same flow without removing existing
T3 installations or sessions when declined.

If the server previously used Haoshoku v8.5.3's Tailscale integration, inspect
`tailscale serve status` after confirming T3 Connect works. Only when it still
shows the old T3 HTTPS handler, remove that handler with
`tailscale serve --https=443 off`. `No serve config` means cleanup is already
complete; Haoshoku never changes existing Tailscale routes automatically.

The full Debian path asks about Git, Claude stay-awake, Claude Remote Control,
automatic worktree cleanup, and optional T3 Code. `haoshoku --skills` refreshes
both declared external skill sources independently using Bun's `bunx` runner.

### Native headless Paseo

Run `haoshoku --server-paseo` directly as the account that should own Paseo.
Normal login users and direct root logins are supported; do not prefix a
non-root run with `sudo` unless root ownership is intentional. Haoshoku installs
`@getpaseo/cli` under `~/.local`, writes a new `~/.paseo/config.json` only when
none exists, and manages `paseo-daemon.service` as that account's systemd user
service. For root this means `/root/.local`, `/root/.paseo`, and the root user
manager at `/run/user/0/bus`. If that manager is unavailable, Haoshoku stops
with recovery guidance instead of targeting another user's session. A new config
listens on `127.0.0.1:6767`, enables the Paseo MCP endpoint, disables relay,
and keeps the bundled web UI off. An existing valid JSON object is left
byte-for-byte untouched, so its listen, authentication, relay, providers,
profiles, and unknown settings remain authoritative. Edit that file directly,
then use `paseo reload`; restart only when Paseo reports a restart-required
setting.

The unit runs `paseo daemon start --foreground --home ~/.paseo`, restarts only
after failure, and enables user lingering for startup after reboot and logout.
Haoshoku refuses to replace a foreign unit or take over an unmanaged/desktop
daemon. Useful lifecycle and recovery commands are:

```bash
systemctl --user status paseo-daemon.service
systemctl --user restart paseo-daemon.service
journalctl --user -u paseo-daemon.service -n 100
paseo daemon status --home ~/.paseo
```

In an attached terminal Haoshoku optionally runs
`paseo daemon pair --relay --home ~/.paseo`; otherwise it prints that command
for later. Pairing enables Paseo's end-to-end encrypted relay and creates a
phone offer. It does not authenticate an agent provider or prove that a phone
connected. For local-only access, keep relay disabled and connect through
Paseo's SSH transport; Haoshoku does not open a port or alter the firewall.

To operate a VPS from a PC agent without enabling a public Paseo port, first
configure and verify a normal SSH alias in `~/.ssh/config`, then pass that alias
after each Paseo subcommand (the installed 0.7.2 CLI does not accept a global
`--host` before the command):

```bash
ssh my-vps
paseo ls --host ssh://my-vps --json
paseo reload --host ssh://my-vps --json
```

The desktop app can keep the local PC and VPS available through the same app.
For phone access, run the pairing command on each desired host and accept its
encrypted relay offer in the app. SSH and relay are independent; neither flow
causes Haoshoku to expose port 6767.

This setup does not install or authenticate provider CLIs. Install and log in
to Claude Code, Codex, or another enabled provider separately as
the same user, then verify the daemon's environment and available models:

```bash
paseo provider diagnostic codex
paseo provider models codex
```

The standalone `--server-paseo` flag remains lifecycle-only. Full Debian setup
follows it with `--paseo-profiles` behavior; use that one-shot flag explicitly
after editing the bundled policy. Browser tools require a connected Paseo
desktop app because the headless daemon brokers browser tabs but does not host
a browser itself.

### VPS Hermes conversation relay

`haoshoku --server-hermes-relay` configures a generic Telegram-to-Paseo
conversation transport only on a Debian-family server. Its legacy native plugin
name and data path remain `paseo-review-relay` for compatibility. The full
Debian setup runs this step after native Paseo and the managed Paseo profiles.
Arch/Omarchy setup never calls it and never creates its enable marker.

An existing Hermes installation is reused and never upgraded. If Hermes is
missing, Haoshoku downloads the official installer and installs the validated
commit from [`configs/hermes-relay/hermes-runtime.json`](configs/hermes-relay/hermes-runtime.json)
with `--skip-setup --skip-browser --skip-computer-use --non-interactive`. That
bootstrap deliberately leaves credentials and gateway setup to the operator.
Complete those private steps without placing secrets in this repository:

1. Run `hermes setup` and configure the Telegram bot token in `~/.hermes/.env`.
2. Set one private Telegram owner/DM in Hermes. Haoshoku derives IDs only when
   the existing private configuration is unambiguous; otherwise set
   `telegramChatId` and `telegramUserId` in
   `~/.hermes/plugin-data/paseo-review-relay/config.json`.
3. Install login startup with
   `hermes gateway install --no-start-now --start-on-login`, start or verify the
   gateway manually, then rerun `haoshoku --server-hermes-relay`.

Missing credentials, an unverifiable local Paseo identity, plugin doctor
failure, or pending activation returns failure rather than reporting success.
The helper preserves Hermes YAML, auth, unrelated plugins, database, and relay
anchors; it backs up a changed plugin directory, deploys only allowlisted files,
and creates `~/.local/bin/hermes-relay` as a symlink. A changed installation is
restarted only after an interactive confirmation that the gateway is idle. A
required activation deferred because the gateway is busy, an unknown gateway
state, and an incomplete noninteractive run revoke the host marker. An
unchanged, previously activated relay remains enabled while its running gateway
is busy. Haoshoku never restarts Paseo or changes schedules.

Relay source is controlled by [`configs/hermes-relay/lock.json`](configs/hermes-relay/lock.json).
It pins the public `paseo-hermes-relay` v0.2.0 release to immutable commit
`73846214657a165379a1698b6bccff6c9c9e484f`. Haoshoku fetches that exact commit,
verifies both `HEAD` and the peeled tag, and rejects mismatches. An offline test
checkout may be supplied with `HAOSHOKU_HERMES_RELAY_SOURCE=/absolute/path`; the
same commit, tag, and manifest checks still apply.

Only a fully configured and activated server receives
`~/.config/haoshoku/hermes-relay.json` with `version: 1` and `enabled: true`.
Bundled PR workflows must run their `hermes-relay-host-enabled` check before any
relay command, pending-state inspection, or escalation transport. A missing or
disabled marker means normal local handling in the Paseo conversation with no
Hermes or remote relay calls. Bundled PR workflows explicitly use `mode: "pr"`,
whose receipts retain the live GitHub head/base/open-state guard. Generic
conversation receipts are separately opt-in delivery only: they do not activate
local work, and the persistent owner must revalidate authority, context, and live
state before acting. High-stakes decisions and action authority stay with the
human in the Paseo conversation.

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
