## Omarchy appearance

[`configs/omarchy/appearance.json`](../configs/omarchy/appearance.json) declares a
public theme repository at an immutable Git commit, one background filename
inside that theme, the font family, and an optional GTK icon theme. Full Arch setup and
`haoshoku --omarchy-appearance` reconcile the theme under
`~/.config/omarchy/themes/`, then call Omarchy's own theme, background, and font
commands. If the manifest declares `iconTheme`, setup applies it last.

To change folder icons and other GTK icons for your current user, run
`haoshoku --icon-theme Papirus-Dark` from your desktop session. Use the
installed theme’s directory name. Haoshoku looks for its `index.theme` in
user and system icon directories, then sets `org.gnome.desktop.interface
icon-theme` with `gsettings`. The standalone command also works without Omarchy.
The next full appearance setup selects the manifest value (shipped as
`Yaru-olive`); omit `iconTheme` to leave icon selection to Omarchy. Current Omarchy releases reset GTK icons
to Adwaita on theme switches. Run the icon command again to restore your choice.

`haoshoku --discord-theme` then deploys that theme's Vencord CSS from
`configs/discord/theme.json` into Vesktop and Vencord as a symlink, setting
`enabledThemes` while preserving every other settings key. Aurora owns the
Discord styling; there is no separate editable client copy. Replaced copies
are preserved under the client’s `theme-backups/` directory, outside the theme
picker. Aurora updates voice labels and server-badge contrast.

For the matching terminal and Files appearance, run the pinned theme’s
desktop installer as your desktop user after applying Aurora:

```bash
theme="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/themes/aurora"
python3 "$theme/desktop/install.py"
```

When Omarchy publishes the T3 palette as `omarchy.json`, copy the lake under
the same ID on the host running T3. Use the serving process's configured
base directory if it differs from the default:

```bash
themes="${T3CODE_HOME:-$HOME/.t3}/userdata/themes"
install -m 644 "$theme/backgrounds/0-aurora-lake.jpg" "$themes/omarchy.jpg"
```

Select **Omarchy** in the serving web app. For an independent **Aurora** theme,
a headless server, or a desktop using a remote connection, see
[Aurora in T3 web and desktop](debian-server.md#aurora-in-t3-web-and-desktop).

An existing checkout from another repository is never replaced. A matching
checkout with local changes is preserved and applied as-is; a clean matching
checkout advances to the declared commit. The manifest may identify exact
legacy revisions from older local-origin installs. Those recognized checkouts
are moved to a timestamped sibling backup before Haoshoku installs the clean
pinned theme, and a failed install restores the original checkout. This keeps
custom work recoverable while making a fresh laptop reproduce the tracked
appearance.

Custom `style` settings are no longer supported. A manifest containing `style`
is rejected before any command runs; remove that key to use the declared theme.
If an unreleased custom variant is already installed, use the retained helper
from the installation revision to disable it before upgrading. The current
helper does not migrate or remove installed variants or their loader state.
