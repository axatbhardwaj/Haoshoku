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
