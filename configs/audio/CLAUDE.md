# configs/audio/

PipeWire and WirePlumber drop-in config files for audio-rate handling.

## Files

| File                                                        | What                                                                                                            | When to read                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pipewire/pipewire.conf.d/10-allowed-rates.conf`            | Tells the PipeWire clock to accept both 44100 Hz and 48000 Hz as valid rates (default clock stays at 48 kHz)   | Changing allowed sample rates or default PipeWire clock rate            |
| `pipewire/pipewire-pulse.conf.d/50-spotify-44100.conf`      | PulseAudio-compat rule that pins Spotify's pulse node to 44100 Hz / 1024-frame latency (currently a no-op; future-proofing) | Adjusting Spotify-specific rate or latency in the PulseAudio layer |
| `wireplumber/pc/51-logitech-prox-44100.conf`                | ALSA monitor rule that hard-pins the Logitech G PRO X USB sink to 44100 Hz exclusively, preventing PipeWire from resampling to 48 kHz | Changing the headset rate or adding rules for another sink on the PC |
| `wireplumber/pc/52-fifine-default-source.conf`             | ALSA monitor rule that raises the FIFINE USB mic's `priority.session` to 3000 so it wins default-capture-source selection over the higher-priority Lenovo webcam mic | Changing the default mic or its capture priority on the PC |

## How deviceType selection works

The two **PipeWire** drop-ins (`pipewire.conf.d/` and `pipewire-pulse.conf.d/`) are **portable** — they contain only generic rate settings and are valid on any machine. They are tracked directly under `configs/audio/pipewire/…`, mirroring their target `~/.config/pipewire/…` paths.

The **WirePlumber** drop-ins are **device-specific**: they hardcode this PC's exact devices by `node.name` (the Logitech G PRO X sink rate-pin, and the FIFINE mic default-source pin), so they live under a per-device subdirectory:

- `deviceType === "pc"`     → deploys from `wireplumber/pc/`     → `~/.config/wireplumber/wireplumber.conf.d/`
- `deviceType === "laptop"` → no WirePlumber rule currently ships; laptop does not need the lossless hard-pin setup
- Anything else (unset, malformed, `"other"`) → skip device-specific WirePlumber rules

This mirrors the pattern already used in `configs/caelestia/` where `hypr-user-pc.conf` vs `hypr-user-laptop.conf` are routed by the `deviceType` field in `~/.haoshoku.json`.

The `src/helpers/configure_audio.js` helper reads `deviceType`, syncs the portable PipeWire drop-ins, and deploys a matching WirePlumber variant only when a known variant exists. Run `haoshoku --audio` to deploy `configs/audio/` into `~/.config/`, and `haoshoku --audio-backup` to snapshot the live configs back.

## Notes

- `51-logitech-prox-44100.conf` matches the node by the exact string `alsa_output.usb-Logitech_PRO_X_000000000000-00.analog-stereo`. If the USB serial changes or a different headset is used on the PC, update this `node.name` to match.
- `52-fifine-default-source.conf` bumps the FIFINE mic's `priority.session` to 3000 so it becomes the default capture source deterministically. Without it the default input falls to the Lenovo webcam mic (stock `priority.session` 2109 vs the FIFINE's 2100) whenever WirePlumber's configured-default state is cleared. Matches `alsa_input.usb-MV-SILICON_fifine_Microphone_20190808-00.mono-fallback`; update the `node.name` if the USB serial changes. The G PRO X is no longer connected, so `51` is currently inert but kept for when the headset returns.
- Laptop currently has no WirePlumber rule. If that changes, create `wireplumber/laptop/<name>.conf` with a laptop-specific output node rather than reusing the PC headset rule.
- These files were originally created following the `linux-lossless-setup` Notion runbook (2026-05-21).
