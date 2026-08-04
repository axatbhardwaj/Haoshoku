# Omazed Integration and Live Validation Design

## Goal

Make Zed follow the active Omarchy theme on fresh Haoshoku installs, remove the
remaining active Caelestia Zed-theme ownership, and validate the complete
Haoshoku Omarchy setup on the current machine before reinstalling the OS.

## Package and ownership model

Haoshoku will install the `omazed` package from Omarchy's configured package
repository. It will not run the repository's manual `install.sh`, because that
installer deletes unrelated JSON files in `~/.config/zed/themes/`.

Omazed owns only:

- `~/.config/zed/themes/omazed.json`;
- its initialization marker and log under `~/.local/share/omazed/`;
- an Omazed block in the user-owned Omarchy `theme-set` hook.

Haoshoku continues to own portable Zed settings and keybindings, but stops
deploying or selecting the Caelestia theme. Omarchy remains the source of all
colors and visual decisions.

## Installation flow

Add `omazed` to the Arch application list. After application installation,
an idempotent helper checks that the system is Omarchy and that `omazed` is
available, then runs `omazed setup`. Failure is reported but does not prevent
the remaining setup from completing.

The helper will also retire only Haoshoku's known legacy
`~/.config/zed/themes/caelestia.json` file. It will not remove any other user
theme. The tracked Zed settings template will select `Omazed` for light and
dark modes while preserving all non-theme settings.

## Live validation

Before mutating the current home, capture backups of every affected user file.
Then:

1. Install `omazed` from the configured Omarchy repository.
2. Run the same setup helper used by Haoshoku.
3. Deploy the merged monitor and workspace configuration.
4. Run `hyprctl reload` followed by `hyprctl configerrors` until clean.
5. Verify the source line, workspace rules, keybindings, executable helper,
   and isolated Chromium launch arguments without spawning duplicate apps.
6. Run `omazed sync`, parse the generated theme JSON, verify Zed selects
   `Omazed`, and invoke the theme hook directly with the current theme name.
7. Run focused tests, the full Bun suite, Bash syntax checks, and lint.

No Omarchy source file under `~/.local/share/omarchy/` will be modified. The
live test will not switch away from the user's current Omarchy theme, so it
will not cause unnecessary desktop appearance churn.

## Failure and recovery

Package/setup failures are non-fatal in the installer and clearly logged.
Live validation stops at the failing boundary and reports the evidence. User
files changed during the test have timestamped backups, while repository-owned
changes remain recoverable through Git. No reinstall, reset, or Omarchy refresh
command is part of this work.

## Tests

Automated coverage will assert package inclusion, Omarchy-only setup wiring,
non-fatal failure handling, legacy-theme retirement without broad deletion,
idempotency, and preservation of unrelated Zed settings/themes. Live checks
will exercise the installed Omazed binary and Hyprland IPC.
