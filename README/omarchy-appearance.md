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

### Optional Obsidian Glass

[`appearance.obsidian-glass.json`](../configs/omarchy/appearance.obsidian-glass.json)
is an opt-in example of the approved neutral black glass / Aurora-green look.
The default manifest stays unchanged. Add this optional block to
`configs/omarchy/appearance.json` for the normal `haoshoku --omarchy-appearance`
route, or apply the example directly from a Haoshoku source checkout:

```json
"style": {
  "variant": "obsidian-glass",
  "palette": { "tint": "#080a0b", "accent": "#86edb0" },
  "glass": { "t3Opacity": 0.92 }
}
```

```bash
bun --eval 'import { configureOmarchyAppearance } from "./src/helpers/configure_omarchy_appearance.js";
const result = await configureOmarchyAppearance({ manifestPath: "configs/omarchy/appearance.obsidian-glass.json" });
if (result.status !== "configured") process.exit(1);'
```

After applying, open T3 **Settings → Appearance → Dark** and select the
**Obsidian Glass** swatch. An existing per-mode Aurora selection can override
the environment default; click the swatch even if it already looks selected.
The active theme should become `omarchy`, with canvas `#080a0b` and accent
`#86edb0` for the example preset. Later Omarchy changes update that published
theme. Other desktop clients need their own selection.

Applying the example once does not change the default manifest. A later run
using the unchanged default manifest disables the variant; keep the `style`
block in your chosen manifest and use that manifest for subsequent applies.

The `palette` and `glass` objects, and each setting inside them, are optional.
`{ "variant": "obsidian-glass" }` selects the same defaults as the example.

| Setting | Accepted values | Effect |
| --- | --- | --- |
| `palette.tint` | Six-digit `#RRGGBB`; each channel 0–32 | Very dark background; neutral surface shades are derived from it |
| `palette.accent` | Six-digit `#RRGGBB`; at least 4.5:1 against the derived selected surface | Focus, selection, active border, and T3 actions |
| `glass.t3Opacity` | Number 0.90–1; default 0.92 | Active and inactive whole-window opacity for `com.t3tools.T3Code` |

Unknown settings, unsupported variants, null settings, invalid colors and opacity
outside these bounds are rejected before commands or writes. These contrast
checks concern opaque palette colors; the wallpaper can still affect contrast
through compositor glass. Use `t3Opacity: 1` when text readability needs priority.

The helper reads the clean source theme at the manifest's exact pinned revision,
then materializes `~/.config/omarchy/themes/aurora-obsidian-glass/` separately.
An existing source checkout is never fetched, checked out, or edited for this
variant. A missing source can still be installed through the existing pinned
install flow. A dirty, foreign, or wrong-revision existing source is refused;
resolve it deliberately before enabling the variant. Generation uses the source
`colors.toml`, `t3code.json` and `themed/hyprland.lua.tpl`. Source semantic error,
warning and ANSI colors remain; the native Omarchy templates generate the other
app configs. Aurora's static CSS and other custom app files are not cloned into
the derived theme. Discord continues using its separately configured Aurora CSS.

Omarchy's theme command owns rendering and application. The helper does not
copy generated current-theme files, change `/usr/share/omarchy`, add visual
workspace overlays, or modify T3's application bundle. It installs the source
Hyprland template with one extra T3 opacity rule, retaining the native terminal,
Zed, video and credential-window opacity guards. Template overrides are global
to Omarchy: other themes also use this template until the variant is disabled.
Native terminal/Zed background transparency and Omarchy's existing glass toggle
remain under their own owners; this manifest does not configure them.

**Transparency limits:** T3's native canvas, sidebar, cards and input colors are
opaque RGB. The approved mockup's separate surface alpha values cannot be
reproduced by this manifest. The 92% fallback fades the entire T3 window,
including text and controls. It does not provide independent background alpha
or promise that a browser or other client gets compositor transparency. Blur and
all non-T3 window opacity policies come from Aurora's unchanged template; live
Hyprland rules or a glass/opaque toggle can override the result. Check the real
native window after applying. Remote T3 clients receive the RGB theme through
Omarchy but have their own desktop opacity behavior and theme selection.

The selected wallpaper is retained, with Omarchy's background change suppressed
during theme application and the resolved image reapplied through `omarchy theme
bg set`. When no current wallpaper exists, the manifest background is used.
If the selected media lives inside Omarchy's replaceable `current/theme/`
directory, its bytes are first preserved under
`~/.config/omarchy/backgrounds/haoshoku-preserved/<sha256>.<extension>`.
Ordinary wallpaper paths remain unchanged; preserved media is kept for recovery.
Font application retains the manifest's existing behavior.

### Disable and recovery

Remove the entire `style` key and rerun `haoshoku --omarchy-appearance`. When the
default manifest has been left unchanged, the equivalent source-checkout command
is:

```bash
bun --eval 'import { configureOmarchyAppearance } from "./src/helpers/configure_omarchy_appearance.js";
const result = await configureOmarchyAppearance({ manifestPath: "configs/omarchy/appearance.json" });
if (result.status !== "configured") process.exit(1);'
```

This selects Aurora again, restores the exact pre-variant Hyprland template
(or removes it if there was none), and keeps the selected wallpaper. Subsequent
default reruns resume normal behavior: they use Aurora’s current template and
the manifest wallpaper. The derived directory is moved to a hidden
`.aurora-obsidian-glass-disabled-<time>` sibling for recovery; it no longer
affects default runs. Re-enabling saves the then-current template again. To restore an entirely different pre-existing
theme or font, select it explicitly with `omarchy theme set <name>` and
`omarchy font set <family>` after disabling.

The derived directory contains a `.haoshoku-obsidian.json` ownership marker,
output SHA-256 hashes and the previous template's bytes. Identical reruns do not
rewrite files or create backups. Changed settings move the previous owned
directory to a collision-safe `aurora-obsidian-glass.haoshoku-backup-<time>`
sibling before replacement. Failed directory swaps restore the previous
version. Filesystem errors or a failing Omarchy command return an incomplete
status; theme/font/background application is sequential, so an apply failure
can leave partial live state. Correct the failure and rerun, or disable through
the command above. There is no automatic desktop rollback; the helper adds no restarts beyond
Omarchy’s normal apply behavior.

Unowned output directories, symlinks, extra files, locally edited output files,
and an edited active template are preserved and block apply/disable. Do not
remove the marker or overwrite those files to force a rerun. Copy your edits
somewhere safe, inspect the recorded template and sibling backups, then restore
the expected owned bytes or move the conflicting directory aside deliberately.
Theme backups and preserved media are never automatically deleted. A code
revert alone does not undo an applied desktop: disable first while this helper
is available, then revert the feature commits if required.
