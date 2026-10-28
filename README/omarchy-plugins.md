## Omarchy plugins

On Arch-family desktops, Haoshoku installs the plugins listed in
[`common/omarchy-plugins.json`](../common/omarchy-plugins.json) by running
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

Vitals (`io.github.woogy7.vitals`) occupies the system-monitor slot in the
center of the bar, replacing BattleStation (`io.github.vk2r.battle-station`),
which itself replaced `dizziee.system-stats`. The bar shows a chip icon;
clicking it opens a tabbed btop-style panel covering CPU (per-core usage and
temperature, frequency, fans, package power), memory, disks (including NVMe
temperatures), network, GPU (busy %, clocks, temperature, power, VRAM),
every machine sensor, and a sortable process list with terminate/kill
actions. Its Python collector is standard-library only and runs only while
the panel is open, so a closed panel costs nothing. Haoshoku never
uninstalls plugins, so existing machines keep the old BattleStation files
until they are removed manually with
`omarchy plugin remove io.github.vk2r.battle-station`.

Advanced Audio Control (`ssupt.audio-control`) adds per-app audio routing, so
Spotify can play through a USB speaker while other apps use headphones. It
replaces the stock audio widget in the same bar slot; stock `omarchy.audio` is
disabled on first install. To remove it, run
`omarchy plugin remove ssupt.audio-control`, then
`omarchy plugin enable omarchy.audio`. Haoshoku reruns restore the default
plugin and bar layout; for a lasting change, also remove its manifest entry and
restore `omarchy.audio` in `configs/omarchy/bar.json`.

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
