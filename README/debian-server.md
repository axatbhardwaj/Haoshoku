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
Local environment is disabled. A missing key means enabled. When desktop
settings are missing and a desktop installation, unit or process is detected,
Haoshoku creates them with Local environment off after checking the directories.
You do not need to open the desktop first. Creation is exclusive: an existing
settings file is never overwritten. Headless setups can proceed without settings;
an unused listening port does not prove a headless setup.

Enabled, malformed, unreadable or conflicting directory/settings evidence, and
failed probes, return incomplete setup before T3 service changes. Disable
**Local environment** in the T3 Code desktop, then pair the desktop to the
existing service. Resolve directory conflicts or unreadable evidence and retry.
Haoshoku never rewrites existing desktop settings or reads or changes existing
pairing state. Explicitly disabled desktops and headless setups can proceed;
service installation/restart uses the checked base directory. Environment-file
and unsupported launch-directory overrides require manual reconciliation.

At the end of a successful Arch T3 step on a host in `configs/fleet.json`,
Haoshoku mints one `t3 pair --tailscale` link per other fleet client (roles
`control` or `access`). Workers do not pair outbound. Each link is labeled with
its target host and expires after 15 minutes; paste it in that client's
**Add environment** dialog. The local desktop can pair to its own service with
`t3 pair --tailscale`; the phone pairing hint is also printed. Haoshoku leaves
the encrypted desktop connection catalog unchanged. Link minting requires
Tailscale `Running` with the fleet's `MagicDNSSuffix`; a mismatched tailnet or
failed mint produces a warning and does not fail service setup.

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
admin console. For a non-root service account, Haoshoku sets the Tailscale
operator with `sudo -n tailscale set --operator=$USER` when unset or different,
then re-reads the preferences to verify it so T3 can manage its Serve route. Your
phone must also be logged in to the same tailnet. Haoshoku does not install
Tailscale or log in for you.

Haoshoku prepares a compatible Node.js runtime and requires stable >= `0.1.0`.
It verifies npm's current stable version before accepting an existing CLI.
On Debian, it reuses the supported `~/.local` npm installation when stable;
for a missing CLI or a known older managed nightly, it runs
`npm --global --prefix ~/.local install t3@latest` and verifies the result.
Unmanaged CLI origins, unknown versions, or versions newer than verified stable
hold setup without replacing the executable or downgrading it.

Upstream's [stable CLI](https://github.com/pingdotgg/t3code/blob/v0.1.0/apps/server/src/cli/update.ts)
derives its default update channel from its installed version; `t3 update --channel stable`
is the supported explicit channel command. Setup installs the stable npm CLI
and reconciles the service through that CLI rather than invoking an updater or
passing guessed channel flags to `service install`. Existing newer services,
unknown launcher state, pending updates/restarts and unmanaged server records
hold setup. Inspect CLI (`t3 --version`) and running-server versions separately
before migration; an HTTPS response alone does not prove the server version.

The desktop has a separate update preference. If it still selects nightly,
setup holds: choose **Stable** in T3 desktop Settings (stored as `latest`),
quit/reopen the stable desktop, keep **Local environment** disabled and retry.
Haoshoku preserves desktop/provider preferences and never changes providers.
Setup reads `t3 connect status --json`, unlinks enabled Connect exposure,
and confirms it is disabled before changing the service.

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
of this flow. If the service has advanced past verified stable, setup holds.
Inspect the CLI, service state and running-server version; do not force a downgrade.

The full Debian path asks about Git and the daily disk-cleanup job.

### One-time current Omarchy palette in T3 desktop

The [importable Aurora snapshot](../configs/t3/omarchy-current.json) is an unchanged
copy of io's Omarchy-generated `~/.t3/userdata/themes/omarchy.json`, read on
2026-10-16. It already uses T3's version-1 custom-theme format; no converter is
needed. To take a newer snapshot, use the current generated file on that desktop.

**Manual import and visual verification remain pending.** In the stable desktop:

1. Keep **Local environment** disabled and connect to the existing standalone
   service. Do not start another server for appearance setup.
2. Open **Settings → Appearance**, open the theme import dialog, choose the JSON
   file above (or paste its contents), and import it. If Aurora is already saved,
   keep that copy unless you explicitly intend to replace its colors.
3. Select **Aurora** for the desired appearance preview (the snapshot is dark)
   and confirm the desktop renders it. This is a client-local choice; do not
   perform these steps in Android or another browser.

Upstream documents [custom-theme import and environment-theme limits](https://github.com/pingdotgg/t3code/blob/v0.1.0/docs/user/appearance.md).
With Local environment disabled, the desktop cannot receive this palette from
its main local environment. The supported importer saves custom themes in
client storage; Haoshoku does not edit Electron storage or pretend that
`t3 theme set omarchy` imported a theme into this client. Re-running setup does
not import, select or overwrite themes. There is no automatic palette sync,
daemon or change to the current Omarchy theme. Providers and other preferences
stay unchanged. Live import, rendering and fleet/phone verification are separate
rollout checkpoints.

### VPS Hermes Telegram transport

`haoshoku --server-hermes-relay` verifies Hermes Telegram transport on a
Debian-family server. Full Debian setup fails if Hermes readiness is incomplete.
Arch/Omarchy setup never calls it.

An existing usable Hermes installation is kept without upgrading or replacing
it. If Hermes is absent, Haoshoku downloads the official installer and installs
the pinned commit from
[`configs/hermes-relay/hermes-runtime.json`](../configs/hermes-relay/hermes-runtime.json)
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
