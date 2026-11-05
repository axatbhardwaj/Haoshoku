## Omarchy workspace policy

Omarchy 4.5 owns workspace IDs, focused-monitor number navigation, and its stock
workspace widget. Hyprmoncfg owns display geometry; the saved PC profile turns
its global workspace planner Off (`enabled: false`, no rules). Haoshoku never
edits generated `monitors.lua` or Omarchy's packaged Lua/QML.

Only hostname **io** with device type **pc** selects `workspaces-io.lua` and
`workspace-monitors-io`. It uses five local slots per screen. Omarchy's internal
stride remains **ten**: a monitor in native block B owns IDs `B * 10 + slot`.
No block numbers are baked into Haoshoku. The TSV maps logical app favorites to
connectors and local slots; the Lua adapter uses `o.workspaces.workspace_id`,
and the shell adapter reads Omarchy's current state and checks live monitors.

| io monitor | Local slots | Preferred app action |
| --- | --- | --- |
| DP-1, center | 1 primary, 2 games/Omakade, 3 retained, 4 former global 8 | Meta+F1 primary; Meta+F2 Omakade |
| DP-2, left | 1 primary destination, 2 Ghostty, 3 Notion | Meta+F6 primary; Meta+F7 Ghostty; Meta+F10 Notion |
| HDMI-A-1, right | 3 former global 9, 4 Vesktop, 5 Teams/Telegram | Meta+F4 Vesktop; Meta+F5 Teams/Telegram |

Meta+Ctrl+F1/F2/F3 focus left/center/right on io. Meta+1–5 and their Shift and
Shift+Alt variants keep the stock focused-monitor actions. Only io unbinds the
corresponding 6–0 actions. Stock Tab and wheel navigation stay unchanged;
existing extra workspaces remain visible until the driver migrates them. This
is a five-slot usage policy, not a compositor capacity limit. Bare F9 dictation
is unchanged. No app actions are assigned to Meta+F3/F8/F9.

Other PC and laptop routes retain ten single-monitor slots, including favorites
6, 7, and 10. They select the internal panel when it is present, otherwise the
sole connected display. Multiple external displays without an internal panel
are ambiguous: helpers defer instead of guessing. No io count cap, portrait
layout, or three-monitor pinning is applied to an unknown host's PC fallback.

Window-open routing resolves the current target, so disconnected screens do not
leave stale numeric placement rules. Missing roles, state, or monitor identity
cause shell app actions to fail without dispatching or launching. Login helpers
can be replayed after Omarchy initializes state. A game still launches when its
placement watcher has no safe target; placement resumes only for a validated
mapping. The gaming toggle returns to slot 1 on its physical screen, rather
than a global previous workspace. Special workspaces remain unchanged.

## Safe io deployment and session migration

These steps are for the owning driver in the existing io session, after its
backup and client inventory. Do not run them on other hosts or from a root home.
This author candidate does not execute them. Keep clients running throughout.

1. Record `hyprctl monitors -j`, `hyprctl workspaces -j`, `hyprctl clients -j`,
   `hyprctl binds -j`, and both native `monitor-workspaces*` state files. Back up
   and checksum every destination below, including absent-file markers. Pause
   other display/profile writers. If the daemon is active, stop it temporarily:
   `systemctl --user stop hyprmoncfgd.service`. Record its previous state.
2. Record `hyprctl getoption misc:disable_autoreload -j`, then set
   `hyprctl keyword misc:disable_autoreload true` and verify success before
   staging files. This prevents the file watcher from loading a partially staged
   combination. Keep a recovery terminal available. Verify hostname is `io`
   and the saved device type is `pc`; never fake hostname on another device.
3. From this candidate's repository root, stage the complete overlay, role map,
   and all four helpers without asking the CLI to reload:

   ```bash
   env -u HYPRLAND_INSTANCE_SIGNATURE bun haoshoku.js --workspaces
   install -Dm644 configs/hyprmoncfg/profiles/pc.json "$HOME/.config/hyprmoncfg/profiles/pc.json"
   ```

   The affected destinations are `~/.config/hypr/hyprland.lua` (require wiring),
   `~/.config/hypr/haoshoku/{bindings,workspaces,
   primary_app,workspace_targets}.lua`, `~/.config/haoshoku/{workspace-monitors,
   primary-app,gaming.json}`, and `~/.local/bin/haoshoku-{special-workspace,
   primary-app,gaming-workspace,workspace-target}`. Existing custom primary-app
   and gaming settings are preserved. Also back up the hyprmoncfg profile and
   generated outputs before the next step. Do not hand-edit `monitors.lua`.
4. Apply the updated profile with **`hyprmoncfg apply pc`**, using its normal
   confirmation/revert flow. Its engine must regenerate `monitors.lua` **before
   its reload**, removing the entire `o.workspaces` override, number/Tab/wheel
   rebinds, and global workspace rules. Merely deleting the final rules is
   insufficient. Inspect both generated profile sidecars and `monitors.lua`:
   no `o.workspaces.enabled = false`, no replacements of native workspace
   functions, and no global numbered monitor rules may remain. If they remain,
   stop here and restore through the backup/native profile flow. Haoshoku's
   runtime replay guard will also defer while those overrides remain.
5. Re-read all monitors, workspaces, clients and native mappings immediately.
   **Native reconciliation can renumber occupied workspaces**, preserving their
   physical monitor and old local slot when free, or using a free slot on a
   collision. Thus old left 6/7/10 may temporarily become local 6/7/10; do not
   assume the original IDs survived or reuse a stale source ID.
6. For each captured workspace, resolve the destination with
   `haoshoku-workspace-target FAVORITE`: center old 1/2/3/8 use favorites
   1/2/3/8; left old 6/7/10 use 6/7/10; right old 4/5/9 use 4/5/9. Match sources
   by retained client addresses and physical monitor. Inspect destination
   occupancy first; never overwrite an occupied destination or close its clients.
   With validated numeric `source_ws` and `target_ws`, rename in place:

   ```bash
   target_ws="$(haoshoku-workspace-target "$favorite")"
   hyprctl dispatch "hl.dsp.workspace.change_id({ workspace = \"${source_ws}\", id = ${target_ws} })"
   ```

   Skip identical IDs. If a destination is occupied, resolve that collision
   explicitly from the inventory before dispatching. Preserve unnamed clients
   with their workspace, and never renumber `special:*`. Do not force-delete
   occupied slots 6–10 merely to make the bar look right.
7. Run `bun haoshoku.js --workspaces` after the generated overrides are gone;
   successful reload replays the primary app and owned Ghostty helpers. Confirm
   all client addresses are retained on their physical screens, io has only
   intended occupied local slots 1–5, the three bars have no foreign/duplicate
   labels, Fn actions target the table above, number/move/silent-move actions
   1–5 stay local, and 6–0 actions are absent. Check bare F9 and special toggles.
   Recheck `hyprctl configerrors` and native block state.
8. Restore the daemon only if it was previously active and verify it reapplies
   the disabled-workspace profile without restoring global overrides. Restore
   autoreload to its recorded previous value with
   `hyprctl keyword misc:disable_autoreload PREVIOUS_VALUE`. Repeat the
   state/bind/client checks after the final reload and on a later profile
   reapply. A new unmatched display/profile may have its own workspace planner;
   inspect its strategy before relying on unattended hotplug.

The original stock tray, world clock, Advanced Audio Control, stock Agents and
Pullbar-removal changes remain part of this candidate. Live UI, hardware
hotplug, and native reconciliation require the driver's io verification.
