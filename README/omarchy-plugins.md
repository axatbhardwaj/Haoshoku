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

Superwhisper is the desktop dictation backend on io (`pc`) and iobook
(`laptop`). Setup uses `omarchy-install-dictation-superwhisper --background`
only when Superwhisper is absent. Existing installs keep their models and
preferences; setup enables `superwhisper.service`, selects the backend with
`omarchy-dictation-use superwhisper`, and sets only its native hold shortcut
to `none` to avoid a duplicate F9 action.

Haoshoku deploys `configs/omarchy/haoshoku/dictation.lua` to
`~/.config/hypr/haoshoku/dictation.lua` and loads it after personal bindings
from `~/.config/hypr/hyprland.lua`. The module replaces any existing F9 pair
with one generic `omarchy-dictation start` on hold and `omarchy-dictation stop`
on release (transcribe and paste). Personal `~/.config/hypr/bindings.lua` stays
intact; changed managed files and the main Lua config receive backups.
An active Hyprland session reloads; otherwise the binding takes effect at login.

Speech Orb is retired from the manifest and managed bar. The dictation helper
also disables an installed, enabled orb through
`omarchy plugin disable io.github.nodrej.speech-orb`, and disables/stops a loaded
`voxtype.service` without removing its package, configs or downloaded models.
This retirement runs on engineering workers too, but iobox, iosatellite,
unknown hosts and Debian/VPS never receive the desktop backend or F9 module.
T3 voice settings and models remain independent and unchanged.

For a focused migration, call `configureOmarchyDictation()` from
`src/helpers/configure_omarchy_dictation.js` in the target user's Omarchy session;
check its `ok` result. It needs the user's graphical-session environment for
native plugin IPC and Superwhisper. Do not rerun an entire profile just for
speech migration. Validate microphone recording, transcription and paste in a
real app separately; automated fixtures do not establish end-to-end audio.

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

The saved bar uses stock `omarchy.workspaces` and `omarchy.agents`. Decent
Workspaces and Pullbar's pull request counter are absent from both the layout
and install manifest, so reruns do not reinstall or re-enable them. Existing
plugin files are retained.

The full Arch setup still deploys the `~/.local/bin/omarchy-agent-usage-update`
wrapper. It scopes the Omarchy 4.0.0 Codex collector's retired `-a untrusted`
compatibility translation to usage refreshes; ordinary Codex commands still
execute the user's normal binary unchanged.
