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

BattleStation (`io.github.vk2r.battle-station`) replaces the former
`dizziee.system-stats` widget in the center of the bar. It shows CPU, RAM and
GPU meters (plus local LLM runtime state for llama.cpp, Ollama, LM Studio and
vLLM when present) and ships a prebuilt x86_64 Rust engine, so it needs
Omarchy Quattro on x86_64 and `btop` for its Trace action. Haoshoku never
uninstalls plugins, so existing machines keep the old `dizziee.system-stats`
files until they are removed manually with
`omarchy plugin remove dizziee.system-stats`.

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
