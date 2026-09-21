# Spec: Fixed monitor focus and portrait workspace rows

Status: DRAFT r3 — adviser review required before user approval. This repository Markdown file is the user-selected authoritative specification. GitHub Issues will track executable tasks only after approval. No implementation, live activation, deployment, publication, or merge is authorized by this draft.

## Outcome

On the PC Omarchy profile:

- `SUPER+F1` focuses `DP-2` (left portrait), `SUPER+F2` focuses `DP-1` (center), and `SUPER+F3` focuses `HDMI-A-1` (right).
- Focusing a monitor preserves whichever normal or special workspace is already visible there. It does not switch to a numbered workspace, hide a special workspace, move a workspace/window, or launch an application.
- Numbered workspaces 6, 7, and 10 use equal-height, full-width rows for tiled targets. The policy follows those workspace identities if they are moved to another monitor.
- Other numbered, named, and special workspaces retain their existing layout even when displayed on `DP-2`.

## Settled decisions

The user selected equal visible rows rather than vertical scrolling and fixed connector bindings rather than dynamic left/center/right discovery. After source review showed that Hyprland 0.56.2 cannot safely reselect layouts on every workspace move from the current Lua overlay without also running persistent-workspace reconciliation, the user chose the recommended fixed-workspace scope: 6, 7, and 10, which the PC hyprmoncfg profile pins to `DP-2`.

The change remains PC-only. `hyprmoncfg` retains sole ownership of monitor discovery, geometry, transforms, scaling, and workspace pinning. Haoshoku owns the three monitor-focus bindings and the layout preference of workspaces 6, 7, and 10. This narrow ownership carve-out must be documented in `configs/omarchy/CLAUDE.md`.

While the active workspace is 6, 7, or 10, portrait rows are authoritative over Omarchy's per-workspace layout toggle (`SUPER+L`). On other workspaces, the stock toggle behaves unchanged. Haoshoku does not modify, delete, or write `~/.local/state/omarchy/workspace-layouts/`.

## Design baseline

1. Add three direct PC-overlay bindings using Hyprland Lua monitor focus:
   - `SUPER+F1` → `hl.dsp.focus({ monitor = "DP-2" })`
   - `SUPER+F2` → `hl.dsp.focus({ monitor = "DP-1" })`
   - `SUPER+F3` → `hl.dsp.focus({ monitor = "HDMI-A-1" })`
   These keys are currently unbound, so no F1–F3 `hl.unbind` or swap-registry entry is needed.
2. Register one small Hyprland Lua tiled layout owned by Haoshoku. Its `recalculate` callback computes full-width logical boxes and calls `target:place`. It compensates for the top and bottom portions of `general.gaps_in` so the resulting visible outer heights—not merely the pre-gap logical boxes—are equal within one logical pixel. A Hyprland group is one tiled target and occupies one row. Floating, pinned, grouped, and fullscreen semantics remain Hyprland-owned.
3. Apply the registered layout with exactly three workspace rules for `6`, `7`, and `10`, each using `layout = "lua:<name>"`. The `lua:` prefix is mandatory. Do not use a monitor selector, enumerate special workspaces, or subscribe to workspace lifecycle events.
4. Reclaim `SUPER+L` on the PC overlay with `hl.unbind("SUPER + L")` followed by one guarded `o.bind("SUPER + L", ...)`. The callback is a no-op on 6, 7, and 10 and invokes the stock `omarchy-hyprland-workspace-layout-toggle` everywhere else. Add the required `reclaimed_by_overlay` entry to `configs/omarchy/keybinding-swaps.json`.
5. Keep the layout, the three workspace rules, the focus bindings, and the `SUPER+L` guard in `configs/omarchy/haoshoku/workspaces-pc.lua`. No new overlay module or `require` is added. The existing workspace configurator continues to deploy only `bindings.lua` and the device-specific workspace overlay.
6. Do not write `monitors.lua`, `hyprmoncfg-monitors.lua`, the PC monitor profile, or Omarchy's persisted workspace-layout state. Do not add move/swap/special event handlers, a background daemon, compositor plugin, or custom Hyprland build.

Hyprland 0.56.2 evidence supporting this design: fixed workspace rules can select a registered Lua tiled layout; Lua layouts can place target boxes; `focusMonitor` preserves the destination monitor's visible normal or special workspace; and identical workspace selectors merge so hyprmoncfg can retain monitor/persistence fields while Haoshoku supplies layout. Implementation must revalidate these APIs against the installed Hyprland version before editing.

## Acceptance criteria

A1. On the PC profile, `SUPER+F1/F2/F3` focus `DP-2/DP-1/HDMI-A-1` respectively. The binding inventory contains exactly one active binding for each chord.

A2. If the destination monitor shows a special workspace, a focus shortcut leaves it visible and focuses its last eligible window. If it shows only a normal workspace, that workspace remains active. Source-monitor workspace state is unchanged.

A3. A missing or disabled fixed connector produces a bounded Hyprland warning/no-op. No alternative monitor or numbered workspace is selected.

A4. `hyprctl workspaces -j` reports `.tiledLayout == "lua:<name>"` for workspaces 6, 7, and 10. With one, two, three, and four same-decoration tiled targets on each workspace, `hyprctl clients -j` shows equal usable width, top-to-bottom non-overlapping visible outer boxes inside the transformed work area, and heights differing by at most one logical pixel under the host's nonzero `gaps_in`. A group occupies one row; floating, pinned, grouped, and fullscreen behavior remains native.

A5. A named, special, or numbered workspace other than 6, 7, or 10 does not acquire portrait rows merely because it is displayed on `DP-2`.

A6. Moving workspace 6, 7, or 10 away from `DP-2` preserves its portrait-row layout. Moving another workspace onto `DP-2`, swapping workspaces across monitors, or showing a special workspace there does not change that workspace's selected layout. No lifecycle listener or refresh action moves a workspace, steals focus, or modifies topology.

A7. After `hyprctl reload` and after a hyprmoncfg monitor-layout refresh, workspaces 6, 7, and 10 report `lua:<name>` and retain their configured `DP-2` pinning; other workspaces retain their own layout. A transient Dwindle pass while Lua layout providers are re-registered during reload is acceptable. `hyprctl reload` succeeds and `hyprctl configerrors` is empty.

A8. `SUPER+L` has exactly one active PC binding. It is a no-op on workspaces 6, 7, and 10 and preserves the stock toggle behavior elsewhere. Existing state files remain byte-for-byte unchanged when the guard blocks the toggle.

A9. The laptop overlay and its bindings are byte-for-byte unaffected. The monitor profile JSON and generated hyprmoncfg files are unaffected.

A10. Tests first establish behavioral failure for the missing bindings/layout/guard contract, then pass with the implementation. Focused tests, the full Bun suite, lint, and format checks pass at the candidate revision.

A11. Separately authorized live verification on this host proves focus preservation for normal and special workspaces, measured three-or-more-window row geometry, the fixed-workspace boundary in A5/A6, the `SUPER+L` guard, successful reload, and a rendered screenshot of portrait rows. Static tests or clean parsing alone do not prove live behavior.

A12. The candidate is independently reviewed at its exact revision. Human merge remains required. After merge, separately authorized deployment through the existing Haoshoku path creates its normal recoverable backups, reloads Hyprland, and repeats A7/A11 against the deployed bytes.

## Delivery shape

- T1: one source candidate/PR for the PC focus bindings, equal-row layout, three fixed workspace rules, `SUPER+L` guard and swap-registry entry, focused tests, and ownership documentation. Live verification before merge is a separate, explicitly authorized temporary activation step—not implicit in implementation approval.
- T2: post-merge local deployment and live verification on this host, dependent on T1 merge and separately authorized deployment. Deployment evidence is not release evidence; no package release is required.
- GitHub Issues are created only after this exact specification is approved and snapshotted. Use `gh stack` for PR work. The human merges.

## Exclusions

- Automatic layout changes based on the monitor currently displaying a workspace.
- Portrait rows for named, moved-in, or special workspaces other than fixed numbered workspaces 6, 7, and 10.
- Dynamic left/center/right monitor discovery or connector fallback.
- Laptop-profile F1–F3 bindings or portrait policy.
- Changes to monitor placement, transform, scale, refresh rate, workspace pinning, or hyprmoncfg ownership.
- Global `dwindle:*` changes, permanent preselect state, scrolling layout, master layout, workspace lifecycle listeners, a background daemon, a compositor plugin, or a custom Hyprland build.
- Per-application row exceptions, user-adjustable row ratios, preservation of manual Dwindle split history, or row order as a stable application-order contract.
- Making `SUPER+L` cycle or override portrait rows on workspaces 6, 7, or 10.
- Automatic merge, release, registry publication, or deployment to another host.

## Failure and rollback boundaries

- A missing monitor is a focus-shortcut no-op, not a topology rewrite.
- A renamed or absent connector does not change the fixed workspace layout rules; hyprmoncfg independently controls whether those workspaces remain pinned to the intended display.
- Before temporary pre-merge activation, record the candidate Git SHA, installed Haoshoku version, hashes and existence of every file the configurator can touch (`bindings.lua`, `workspaces.lua`, `hyprland.lua`, the special-workspace helper, and gaming policy/autostart files), plus every backup path it creates.
- After temporary verification—or immediately on any activation/config error—restore every pre-existing touched file byte-for-byte, remove only files proven to have been created by that activation, reload Hyprland, and revalidate `hyprctl configerrors`.
- Record source-tree state, live-config state, and runtime behavior separately. Source rollback and live-config rollback are separate receipts; neither implies the other occurred.

## Decision evidence

- Align Astra `ctx_71704d843c74` and Align Fable `ctx_64d8a1674c0e`: monitor focus is independent from portrait layout; automatic monitor-following requires lifecycle reconciliation.
- Spec r1 reviews `ctx_96922ee0c80f` and `ctx_cff44fa49a02`: required gap-aware visible geometry, `lua:` layout naming, precedence handling, and reversible live activation.
- Spec r2 reviews `ctx_d066e68aa1c8` and `ctx_f86d045aea1d`: rejected the proposed move-following refresh because Hyprland 0.56.2 refresh masks cause persistent-workspace reconciliation and later exact `SUPER+L` rules can override a monitor rule.
- Checkpoint audit `ctx_fb2d41d4b60e`: confirmed r2 was not approvable and recommended reopening the automatic-versus-fixed scope decision.
- User decisions: equal visible rows; fixed DP-2/DP-1/HDMI-A-1 connectors; repository Markdown authoritative spec; GitHub Issues for tasks; after the verified blocker, proceed with fixed portrait workspaces 6, 7, and 10.

## Approval boundary

Approval of this exact revision authorizes specification snapshotting and GitHub Issue creation. It does not start implementation, publish a branch, merge, deploy, or release. Execution begins only through `axstack-implement`; human merge remains a separate gate.
