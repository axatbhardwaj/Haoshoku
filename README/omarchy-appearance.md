## Omarchy appearance

[`configs/omarchy/appearance.json`](../configs/omarchy/appearance.json) declares a
public theme repository at an immutable Git commit, one background filename
inside that theme, and the font family. Full Arch setup and
`haoshoku --omarchy-appearance` reconcile the theme under
`~/.config/omarchy/themes/`, then call Omarchy's own theme, background, and font
commands. `haoshoku --discord-theme` then deploys that theme's Vencord CSS from
`configs/discord/theme.json` into Vesktop and Vencord as a symlink, setting
`enabledThemes` while preserving every other settings key. Aurora owns the
Discord styling; there is no separate editable client copy. Replaced copies
are preserved under the client’s `theme-backups/` directory, outside the theme
picker. The pinned Aurora v3.0.7 includes the server-badge and menu contrast fixes.

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
