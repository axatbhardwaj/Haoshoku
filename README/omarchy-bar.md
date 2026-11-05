## Omarchy bar

Use `haoshoku --omarchy-bar` to deploy `configs/omarchy/bar.json`, and use
`haoshoku --omarchy-bar-backup` to capture the live bar back into the repo.
The saved layout uses Omarchy's stock workspace and tray widgets, with the
Elsewhen world clock immediately after the main clock. On Omarchy 4.5, the
native `bar.layout.tray` drawer holds Galaxy Buds, hyprmoncfg, Display, and No
Sleep controls alongside status notifier items. Feishin and Omarchy's generic
MPRIS widget remain on the left; stock Agents and Advanced Audio Control stay
visible on the right. Pullbar's pull request counter is omitted.

The bundled `xzat.tray` files remain available for older/custom layouts. Deploy
and backup commands copy them at `~/.config/omarchy/plugins/xzat.tray` only when
the selected layout uses `xzat.tray`; the stock tray needs no embedded widgets.

Haoshoku claims the `bar` key of `~/.config/omarchy/shell.json` wholesale,
including bar-widget enablement. Disabling a bar widget through Omarchy's UI is
therefore reverted on the next deploy. Every other top-level key — including
`idle`, `plugins`, `disabledPlugins`, `version`, and unknown keys — is preserved.
