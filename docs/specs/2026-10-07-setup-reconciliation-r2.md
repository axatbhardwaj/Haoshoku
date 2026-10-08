## Approval receipt — 2026-10-07

Axat approved r2 in T3 driver thread `ac403707-3880-496d-a6bc-adc20964bc05` with the reply "approved". This receipt changes the status of the frozen draft below to approved; its original bytes and historical language remain intact.

- Frozen r2 specification SHA-256: `9291e751997d11ab1991919c2cf97e7350ba5e62c6119c1c688f32f06c77ab91`.
- Approved full issue body before this receipt SHA-256: `c5ba63c4e13c1b1a840bb3e51f19fdd21de6785644960e473d8e4d8078d702c0`.
- Human merges remain required. No release or live-host rollout is authorized by this approval.

### Explicit follow-up — Executor clients

Axat additionally requested Executor MCP setup for agents, specifically Claude and Codex, using the existing self-hosted endpoint. Add reproducible client connection setup to Haoshoku for both supported harnesses. Preserve existing Executor entries and unrelated MCP configuration; keep credentials out of tracked files, command logs and backup payloads. This is additive client setup, separate from server provisioning. It does not authorize changing Executor accounts, API keys, policies or connected integrations. Other agent clients require an identified supported configuration contract; do not claim universal coverage.

Acceptance M1: both Claude and Codex user-scope configurations can register the same explicit HTTPS Executor endpoint with supported authentication; an unchanged configuration is a no-op and a conflicting entry stops with actionable guidance.
Acceptance M2: disposable-home tests prove fresh setup, repeat setup, conflict/malformed configuration handling, unrelated settings preservation, missing authentication reporting, and no credential leakage. No personal endpoint or secret is hard-coded into the package.
Acceptance M3: documentation explains the endpoint and authentication prerequisites for CLI and T3-launched sessions, and distinguishes configuration written from an authenticated MCP handshake/tool-discovery check. Existing live entries remain untouched during this repository run.


---

# Haoshoku setup reconciliation and legacy retirement — r2

Status: DRAFT for user approval, 2026-10-07. Proposed amendment to issue #63 and tasks #65–68. The September approved baseline remains historical evidence; this draft does not authorize execution until approved.

## Outcome and authority

Make future Haoshoku installations match the selected Notion setup pages: T3 Code provides orchestration, Axstack supplies workflow skills, Hermes remains the Telegram transport, Executor remains the integration endpoint, and SSH access stays on the tailnet.

The original request to solve the issues and setup drift grounds units 2 and 3; approval of this revision confirms those proposed fixes. The user separately selected an opt-in Executor installer that preserves existing deployments (unit 4). The user explicitly selected retirement of Matt Pocock skills, visual-explainer, Claude Remote Control, Claude stay-awake, and PR watch from future Haoshoku installs. This revision covers repository changes and GitHub reconciliation. Existing host services, skills, data, credentials, firewalls, schedules, and package installations remain intact.

Authoritative store: GitHub issue #63, preserving its prior approved body. Existing #65/#66 will receive explicit scope amendments (preserving their historical bodies) and track source retirement and verification; #67/#68 remain separate host-migration work requiring revised approval and fresh host evidence.

## Evidence and decisions

- Inspected source: stable de11fb3a084a59f6f3048e2decdc89f15819c09d, Haoshoku 12.2.2.
- Approved issue #104 and its repository spec retain T3/Hermes and remove Paseo. They supersede contrary September choices.
- Four Notion pages fetched through the configured Executor on 2026-10-07: T3 Code setup on io; Axstack automation prompts; Self-hosted Executor on axat-vps; SSH between machines.
- The Notion documents are setup evidence, not a fresh probe of host state.
- PR #86's intended Executor routing exists in all three current templates, README, and tests, with T3 replacing Orca. Close it as superseded after final comparison, not merged.
- PR #72 is unmerged and absent from stable. Its old image and tailnet-derived origin conflict with the reported working Executor deployment. Replace its implementation through a fresh bounded candidate; close the obsolete PR only after the replacement is linked.
- Keep T3, Hermes, Claude/Codex CLIs, Axstack, Git/gh/gh-stack, shared agent instructions, and unrelated desktop/editor configuration. This revision does not retire every item listed in September #65.
- Keep the live Axstack review-manager schedule and its owner intact. Notion's automation snapshot is not permission to recreate or edit schedules.

## Delivery units

### 1. Retire the five selected legacy tools

Remove installer/default-setup calls, backup/update routes, CLI options, helper modules, packaged payloads, and maintained documentation for the five selected families. Remove unused dependencies only after checking remaining consumers.

Exact retired flags: --skills, --skills-update, --skills-list, --agent-skills, --explainer-theme <theme>, --claude-remote-control, --claude-remote-control-backup, --claude-stay-awake, --claude-stay-awake-backup, --pr-watch, and --pr-watch-backup, including their cli_utils option keys. Remove Debian stay-awake/Remote-Control prompts and calls to configurePrWatch, configureSkills and syncAgentSkills, and the corresponding existing Arch calls. Delete only the selected configs/claude-remote-control, configs/claude-stay-awake, configs/pr-watch, and configs/upstream-skills/visual-explainer payloads (plus uniquely supporting lock/provenance files), and their unreachable helpers. Retire the whole --agent-skills route rather than retaining an empty archive/unlink command.

Retired commands fail with a nonzero exit and actionable guidance before any installer/service/network operation; they cannot fall through to full OS setup. Cover boolean and value-bearing forms, including visual-explainer theme arguments. Remove the external Skills CLI inventory route with its retired integration; direct users to manage independent skills themselves.

Do not archive, unlink, stop, or delete live copies during normal setup. In particular, do not turn removal of visual-explainer into a name-based purge of user skill directories. Preserve independently installed specialist skills and user instructions. Historical changelog/spec/plan documents remain historical.

Split portable skill retirement and service/watch retirement into green themes; use gh stack for dependencies. Keep semantic commits near 200 lines where practical. Record the exact bulk vendored payload deletion as a justified size exception rather than fragmenting an invalid package.

### 2. Guard T3's single-backend setup

Before Haoshoku starts or restarts a T3 service sharing the desktop's data directory, detect a desktop local backend that is enabled or whose state cannot be safely established. Return incomplete setup with instructions to disable Local environment first and then pair the desktop to the existing service. Do not rewrite the desktop settings or manipulate pairing tokens.

Read desktop-settings.json under the effective T3 data directory (normally ~/.t3/userdata), consistently with the service base directory. Missing localEnvironmentEnabled is enabled, matching the installed desktop default. Missing settings with a detected desktop installation or process is unsafe; a missing file is a headless pass only when no desktop installation, unit or process is found. Malformed, unreadable, or conflicting directory evidence fails closed. The installed desktop bundle confirms localEnvironmentEnabled defaults true; record its hash in private evidence.

Keep existing loopback and tailnet-only service checks. Cover both Arch and Debian entry points whenever a desktop installation, unit, process, or settings file is detected; a genuinely headless installation remains supported. Do not infer safety merely from a currently unused port.

### 3. Preserve tailnet-only SSH

The Debian firewall step must never create a broad public SSH allow rule. Require a logged-in, running tailnet and a valid tailnet interface before firewall mutation; add the OpenSSH rule for tailscale0 before any default-deny/enable action. Keep the firewall step in its existing sequence, but return an explicit result and propagate any skipped, declined-on-inactive-UFW, or failed configuration to an incomplete overall Debian result with prerequisite/retry guidance. Fail truthfully if prerequisite checks or rule installation fail; no full-setup success may hide the firewall gap.

Preserve OpenSSH and its deploy/key behavior. Do not enable Tailscale SSH on the VPS, edit authorized_keys, disable sshd, or modify tailnet ACLs. Do not silently remove existing broad rules: detect/report them as incomplete hardening with explicit manual migration guidance. Keep the existing UFW enable confirmation. When UFW is already enabled, the same preflight and ordering apply; no public-rule pruning or blanket reset occurs. HTTP/HTTPS policy remains as before. Verify IPv4/IPv6 handling through command fixtures.

### 4. Replace stale Executor provisioning

Provide haoshoku --server-executor <https-origin> as an opt-in Debian command, never a default OS-setup step. Require an origin with HTTPS, host and optional port; reject credentials, path beyond /, query and fragment. No personal domain is hard-coded. Document external nginx/TLS provisioning and OAuth's public callback/client-metadata requirement. Do not create a Tailscale Serve route or modify nginx, DNS, certificates, firewall ports, or client credentials.

Use ghcr.io/usefulsoftwareco/executor-selfhost:latest as the selected upstream image reference, record the pulled digest for a fresh deployment, and verify its runtime UID and /data contract during implementation, keep port 4788 bound to loopback, and prepare ownership only for a newly created empty data directory. Never recursively change ownership of existing data.

Existing deployments are preserved: a differing compose file or incompatible directory state stops with guidance before overwrite/startup. An unchanged managed configuration is verified without pulling, recreating, restarting, or updating its container. Retain existing secret files and database; do not create owners, API keys, policy rules, or OAuth connections.

Success requires bounded checks of the expected application health and configured public origin; a generic 4xx from an arbitrary proxy is insufficient. Separate container readiness from owner onboarding, authentication, and integration status. Failures report the unfinished step without claiming deployment success.

### 5. Reconcile documentation and issues

Update README.md, docs/haoshoku.md, docs/runbooks/axstack-migration.md, root CLAUDE.md and AGENTS.md together, and affected per-directory CLAUDE.md indexes for retained tools, retired flags, single-backend pairing, tailnet-only SSH, and the Executor prerequisite. Preserve the old approved spec and explain which obligations were superseded.

Amend #65/#66 explicitly to this revision and list unselected September removals as retained. Reconcile already-closed #64 and merged PR #69 as completed source/documentation history, without re-opening or claiming host proof. Record axstack#19 status read-only; no changes to that external repository. Update the runbook to resolve npm latest then verify the selected tarball against dist.integrity (SHA-512), recording that exact release identity instead of requiring the obsolete fixed release pin.

Map #65/#66 to this revision. Keep #67/#68 open and explicitly deferred pending host-rollout authority; do not label host migration complete from source tests or Notion notes. Keep #63 open while required follow-up work remains. Record #86 as superseded and link #72's replacement once verified.

## Design

Usage: normal Arch/Debian setup no longer installs the five retired families; haoshoku --tailscale-t3 and --server-t3-code enforce safe service preflight; the opt-in haoshoku --server-executor <https-origin> command accepts an explicit public origin.
Shape: existing CLI and OS setup -> small focused helpers -> injected process/filesystem/probe boundaries.
Binding: public interfaces, preservation rules, and observable success/failure above are commitments; helper decomposition is author-owned.
Flow + failure: prerequisite check -> safe configuration -> bounded verification; malformed desktop settings, unavailable tailnet, incompatible Executor data, or unreachable origin return incomplete without destructive fallback.
We accept: manual desktop pairing, reverse-proxy provisioning, and existing-host migration for a small installer with clear ownership.
Rejected: blanket home cleanup; public SSH fallback; automatically editing desktop pairing state; tailnet-only OAuth origin; automatic nginx/firewall/credential migration.
Open: none requiring a new product preference (the user expressly selected the preserving opt-in Executor installer); exact implementation details must satisfy these acceptance checks.

## Acceptance checks

A1. Fresh and repeated default Arch/Debian setup never installs, updates, backs up, or activates any of the five retired tool families.
A2. Every retired CLI form exits nonzero before host or network effects. Independent skills, user configuration, and existing legacy installations remain byte-identical in disposable-home fixtures.
A3. The published package contains no executable retired payload or reachable route. T3/Hermes/Axstack and unrelated setup continue to work in focused tests.
A4. T3 preflight refuses enabled, malformed, unreadable, or ambiguous desktop-local state before service mutation; disabled local state and a genuine headless case pass. No settings rewrite or token output occurs.
A5. Firewall fixtures include absent Tailscale on fresh Debian, active/inactive UFW, declined enable, command failure, repeated setup, and existing broad rules; they prove propagation to the overall Debian result, no public SSH allow command, no mutation on failed tailnet preflight, tailnet allow-before-deny ordering, truthful failures, and no sshd/Tailscale-SSH/key/ACL changes.
A6. Executor fixtures prove explicit HTTPS-origin validation, loopback binding, current image contract, fresh-directory permissions, unchanged rerun, conflict preservation, no existing-data chown, and bounded application/origin verification.
A7. Executor never changes reverse proxy, firewall, Serve routes, secrets, account ownership, or connected integrations. Tests simulate every external operation.
A8. Maintained docs and GitHub states match actual source/release evidence; host evidence stays unverified and deferred. Historical approvals and unresolved host tasks remain visible.
A9. Each behavior change has meaningful red/green evidence. Full bun test, bun run lint, package inspection, and independent exact-head review pass for each candidate. Existing failures are investigated, not silently counted green.
A10. Delivery uses gh stack where dependent, narrow PR themes, one writer per candidate, and source-bound receipts. Release publication and live-host rollout are separate, unrequested actions.

## Exclusions

No live-host mutation, password rotation, OAuth reauthorization, schedule edits, wholesale package cleanup, automatic release/publish, or removal of extra AI apps/editor configuration beyond references uniquely belonging to the five retired tools. No closure of incomplete migration tasks.

## Approval

Approve this exact revision to authorize the repository delivery units and GitHub reconciliation. Retain the September human-merge requirement for PRs governed by #63 unless the user separately changes it.
