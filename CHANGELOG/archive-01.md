## 11.13.2 - 2026-09-22

- Make `Super+7` only switch to workspace 7 without launching Ghostty, while
  keeping login-time workspace-7 ownership.

## 11.13.1 - 2026-09-21

- Make the portrait-row test portable across CI runners: prefer `lua5.4`, fall
  back to `lua`, and skip only its interpreter-backed behavior check when neither
  is installed while keeping the static ownership check active.

## 11.13.0 - 2026-09-21

- Add fixed `Super+F1`/`Super+F2`/`Super+F3` focus hotkeys for the left,
  center, and right monitors.
- Give numbered portrait workspaces 6, 7, and 10 equal visible rows, and guard
  `Super+L` so their owned layout cannot be toggled away.
- Align the bundled Claude and Codex agent profiles with the shared run
  notification policy, a prerequisite for decision, merge-ready/merged, and
  serious-risk Telegram alerts.

## 11.12.0 - 2026-09-20

- Move the Steam client into its own `special:steam` workspace on `Super+S`
  (stash toggle moves to `Super+Alt+S`). Omakade stays on workspace 2 with the
  games, and `Super+Shift+G` now ensures Omakade instead of Steam. Games keep
  landing on workspace 2 through the `haoshoku-gaming-workspace place`
  Steam launch-option wrapper.
- Order the left bar as menu, workspaces, media, Feishin.

## 11.11.0 - 2026-09-20

- Support harness-specific appendix files in the shared agent profile.
  An agent target with `append` (e.g. Antigravity's `GEMINI.append.md` with
  model-routing notes) gets that bundle file appended to the deployed profile
  instead of a plain copy.
- Swap Omarchy plugins: `robzolkos.github` becomes `io.github.ciryon.pullbar`
  (GitHub CLI auth), and the bar drops Agent Usage Plus for the stock
  `omarchy.agents` widget next to Pullbar.
- Switch the primary terminal from Kitty to Ghostty.
  Keep one dedicated home-rooted ghostty terminal on workspace 7.
  `configs/ghostty/config` includes the generated Omarchy theme (which owns colours) and owns 0.70
  background opacity, font, padding, and keybinds; `configureGhostty()` deploys
  it and selects `com.mitchellh.ghostty.desktop` for `xdg-terminal-exec`.
  Workspace 7, Haki, and agents launch owned Ghostty windows (exact
  `haoshoku-*` classes), with the Haki/agents top/bottom splits as tmux
  one-liners plus `haki-terminal`/`agents-terminal` direct-launch recipes for
  the KDE Meta+A launcher. Kitty stays installed as a fallback but is no
  longer deployed or referenced by active launchers.

## 11.10.0 - 2026-09-17

- Add a single configurable shared agent profile in
  `configs/agent-profile/PROFILE.md`, deployed with `haoshoku --agents` to
  Claude (`~/.claude/CLAUDE.md`), Codex (`~/.codex/AGENTS.md`), Opencode
  (`~/.config/opencode/AGENTS.md`), and Antigravity (`~/.gemini/GEMINI.md`),
  with `haoshoku --agents-backup` for the reverse. Arch and Debian default
  setups sync it after the Codex step. The Claude/Codex bundles now carry the
  same Orca-based text.

## 11.9.1 - 2026-09-17

- Replace the Discord client with Vesktop in the package list, Discord URI
  handler, Omarchy workspace-4 launcher and window rules, and KDE activity/output
  placement. Retire the old managed Discord KWin rule on redeploy.
- Add regression coverage for Vesktop launch-if-missing, duplicate prevention,
  workspace and MIME settings, and idempotent KDE rule migration.

## 11.9.0 - 2026-09-16

- Add `--axstack` and `--axstack-check`. `--axstack` downloads the pinned
  Axstack v0.8.0 release tarball, verifies its SHA-256 before any write,
  installs it under `~/.local/share/axstack/releases/<version>/package` with the
  `~/.local/bin/axstack` shim, never downgrades a newer or user-managed
  (suffixed) build, and then runs `axstack install --harness claude|codex` so
  Axstack owns its skills and instruction routing block. `--axstack-check`
  reports the shim, `axstack --version`, and per-harness check state
  separately. CachyOS and Debian default setups run the Axstack step after the
  Claude/Codex CLI installs; failures are reported, not fatal.
- Return truthful results from `installClaude`/`installCodex`; config sync is
  skipped and a warning is logged when the CLI install fails.

## 11.8.5 - 2026-09-13

- Stop auto-launching Omakade on workspace 2 at login; Steam keeps starting
  silently there and `Super+2` remains the on-demand Omakade key.
- Add a configurable workspace-2 gaming autostart policy in
  `~/.config/haoshoku/gaming.json` (Steam on, Omakade off by default) with
  `haoshoku --gaming`, `--gaming-steam-autostart enabled|disabled`, and
  `--gaming-omakade-autostart enabled|disabled`. `--workspaces` redeploys
  reconcile the live overlay with the saved policy instead of reverting it.

## 11.8.4 - 2026-09-12

- Add native `--paseo-schedules`, `--paseo-schedules-check`, and
  `--paseo-schedules-apply` workflows for host-local configuration, read-only
  validation, and explicit-ID diff-only updates. Policy/profile installation
  leaves schedules unchanged; schedule apply remains a separate explicit
  operation.
- Select one implementation pair by risk: Sol medium author with independent
  Opus medium review for ordinary work, or Opus high author with a fresh Sol
  high reviewer for high-stakes work. Apply the pair at `/implement` and
  whole-spec intake and per authored-PR repair batch, including exact candidate
  and response-digest gates, same-author fixes, and explicit escalation
  checkpoints. Peer PR review and monitor/watchdog roles remain unchanged.
- Set only `explore-codebase` and `explainer` to the explicit Sonnet xhigh
  preference while preserving all 21 stable role IDs and Luna max visual
  review. Other xhigh use remains exceptional rather than a blanket default.
- Use Sonnet xhigh for visual artifact authoring and Luna max for independent
  exact-artifact review; preserve rendering and review requirements.
- Optimize the bundled workflow to 2 high, 10 medium, 6 low, 2 xhigh, and 1 max
  profile defaults. Keep Astra low as driver, Fable medium for
  unresolved consequential decisions, and phase-specific high escalation.
- Default ordinary nontrivial changes to one implementer and one independent
  single-session Standards, Spec, and simplicity reviewer. Reserve extra
  research and six-angle PR review for distinct unresolved or justified
  high-risk coverage, while preserving explicit upstream `code-review` use.
- Cache unchanged task discovery, workspace ownership, skill references and
  selected capability fields; reuse changed evidence and reviewer sessions,
  while refreshing every approval against the current SHA.
- Retire the managed Astra advisor profile during setup while preserving
  custom profiles and provider credentials.
- Remove the unreleased local provider-remapping layer; managed Codex roles
  use the direct Codex provider.

## 11.8.3 - 2026-09-11

- Keep delegated workflow chats available until the driver accepts all
  evidence, then require exit cleanup reconciliation before completion,
  handoff, or driver archive. Receipt-bind supported background CLI launches
  with null parentage, hard-retain mismatched non-null parentage, settle and
  rebind cross-run reuse, and report a reason for every retained worker.
- Default ordinary implementation and exact-candidate code review to medium,
  with explicit per-launch high escalation, while retaining xhigh Decision
  Council advisors and all existing revision, review, test, and authority gates.
  Replace model/effort-bearing managed profile aliases with responsibility IDs
  during upgrade without changing custom profiles or provider secrets.
- Restore Astra Advisor (`technical-advisor`) and name the existing Fable
  profile (`planning-advisor`) Fable Advisor. Run both at xhigh as a frequently
  consulted Decision Council for initial nontrivial approaches and remaining
  decision uncertainty.
- Keep pre-created peer-review angle checkouts under the reviewed repository's
  existing Paseo project by requiring explicit project registration and
  workspace-ID launches at the point of dispatch.

## 11.8.2 - 2026-09-11

- Retire the separate Astra advisor profile; keep the selected model as driver
  and Fable as general planning/design advisor. Preserve human escalation and
  independent review.
- Add an independent Opus-high Complexity and Simplicity angle to peer PR
  reviews, and apply its shared checklist inside the existing Opus
  implementation checkpoint without adding another checkpoint agent.
- Replace active Grok workflow routes with renamed Claude Opus 5 research,
  correctness, monitor, and watchdog profiles while preserving generic Grok
  provider support and safely retiring superseded managed profile IDs.

## 11.8.1 - 2026-09-11

- Make the main conversation's selected model the workflow driver, use Fable
  before substantial planning, and add a high-effort Astra technical advisor
  before consequential design without changing the independent Opus review or
  human publication gates.
- Preserve the existing Astra-then-Fable consensus requirement for new
  high-stakes decisions, including explicit verdicts against the same evidence,
  while keeping routine work proportional and advisor sessions reusable.

## 11.8.0 - 2026-09-11

- Add a Debian-only Hermes relay setup mode and default post-Paseo-profile step,
  with an immutable Hermes bootstrap pin and immutable public relay source at
  `paseo-hermes-relay` v0.2.0 commit
  `73846214657a165379a1698b6bccff6c9c9e484f`, generic and PR transport modes,
  verified offline-source override, private configuration preservation, and
  receipt-backed activation with marker revocation on incomplete attempts.
- Require a successful per-host enable marker before bundled PR workflows make
  any Hermes relay or remote transport call; PR mode retains its live GitHub
  guard, generic receipts are opt-in delivery only, and local/Arch workflows
  remain local.
- Remove the transitional vendored relay and its duplicate Haoshoku Python test
  suite now that the standalone release and CI are authoritative.

## 11.7.7 - 2026-09-10

- Give Fable explicit early planning triggers for ambiguous requirements, design
  tradeoffs, conflicting research and repeated failed fixes, with bounded
  planning outputs and session reuse. Preserve proportional routine work and
  the existing high-stakes consensus and independent review gates.

- Cap submitted PR review bodies at 7500 characters alongside the existing
  399-line limit, directing reviewers to tighten prose rather than drop
  findings when a review runs long.

- Keep PR review and babysitting workspaces under the repository’s existing Paseo
  project. Require explicit project ownership and verify workspace placement
  before launching workers, preventing temporary role checkouts from becoming
  separate sidebar projects.

- Add validated `~/.config/haoshoku/paseo-tasks.json` defaults and CLI controls
  for future Paseo task metadata and archive-or-keep cleanup policy, preserving
  custom fields and leaving invalid config untouched.
- Add a bundled model-routing lifecycle convention for unique per-run task
  labels, readable role names, explicit parentage-checked rosters, recorded
  completion evidence, and preferred no-force archival with its non-atomic
  preflight limitation documented. This adds no timer, chat migration,
  workspace deletion, or native Paseo UI grouping.

## 11.7.6 - 2026-09-09

- Use Sol at high effort for Visual Review while preserving the existing profile ID and review responsibilities.

## 11.7.5 - 2026-09-09

- Replace the owned HTML-deliverables workflow with the pinned upstream
  visual-explainer skill, keeping ordinary prose in its requested format and
  retaining proportional source and visual review through existing profiles.
- Add a persisted `dark`, `light`, or `system` explainer theme preference with
  dark as the default, and archive the retired live skill before removing only
  its managed Claude/Codex links.
- Give every bundled Paseo profile a readable display name while preserving its
  stable internal ID and runtime configuration.

## 11.7.4 - 2026-09-09

- Remove OpenCode from managed workflow routes. Keep documentation,
  correctness, and requirements on Claude Opus 5 at medium effort; use
  provider-native Grok 4.6 for separate recurring monitor and watchdog
  sessions whose healthy heartbeats remain snapshot-only.

## 11.7.3 - 2026-09-09

- Route substantial research through Opus at high effort and explanatory HTML
  presentation through a separate Opus profile at medium, while raising Opus
  content review and Sonnet exploration to their intended efforts. Upgrades
  retire the two superseded Sonnet profile IDs only when their replacements are
  bundled.
- Expand high-effort Fable from planning into evidence-backed consensus with
  Astra for new high-stakes decisions, with bounded reconciliation, explicit
  escalation, and independent Opus candidate review preserved.

## 11.7.2 - 2026-09-08

- Replace the three managed Muse Spark Free documentation, PR requirements,
  and PR monitoring profiles with GLM 5.3 Flash, including bundled workflow
  references and conditional cleanup of the retired managed profile IDs.

## 11.7.1 - 2026-09-08

- Sync the bundled `paseo-pr-review` skill so peer PR reviews submit the
  consolidated verdict automatically, while preserving report-only overrides,
  separate merge authorization, and exact-head receipt validation.

## 11.7.0 - 2026-09-08

- Make Paseo the default orchestrator: install `paseo-bin` on Arch, launch the
  desktop by its absolute AUR path, require the native daemon on Debian, and
  keep T3 Code as an optional compatibility service.
- Install upstream Paseo orchestration skills and sync the Haoshoku-owned
  routing, review, and HTML-deliverable skills for Claude Code and Codex.
- Add whitelist-only Paseo profile/provider policy sync and backup while
  preserving credentials, network settings, unknown profiles, and unrelated
  configuration.
- Make shared agent instructions portable and document local, SSH-host, and
  optional encrypted-relay operation across PC and VPS hosts.

## 11.6.1 - 2026-09-08

- Support direct root ownership for `--server-paseo`, including root's systemd
  user manager and UID 0 daemon status.
- Run the NodeSource and Node.js installation steps without `sudo` when already
  root, while preserving the existing non-root setup path.
