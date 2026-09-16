# Spec r2: Axstack-owned AI setup and Haoshoku migration

Status: DRAFT — awaiting user approval. This issue is the authoritative specification. Task checklist is provisional until approval; no implementation is authorized by issue creation.

## Outcome and accepted decisions

Haoshoku installs Axstack, Claude Code, Codex, Paseo and their required prerequisites. Axstack owns its engineering workflow skills, initial profile setup and a small routing block in each supported harness instruction file. Haoshoku no longer installs or manages a second AI workflow/configuration layer. Migrate the primary workstation and VPS after reviewed changes, retiring verified legacy services and schedules. Preserve independently installed specialist skills, native Paseo dependencies, personal instructions, credentials, sessions and unrelated system settings.

The user explicitly selected "IO + VPS; retire verified legacy services/schedules" after reviewing removal of Claude Remote Control, stay-awake, Hermes and T3 setup. These services are retirement candidates under that current decision; any older retention advice is superseded. Required connectivity means Paseo connectivity, not a blanket exemption for legacy Claude/T3 services. Active dependencies still hold the affected retirement.

GitHub issues are the user-selected authoritative spec/task store, overriding the workflow's default Linear store. The driver coordinates both repositories and rollout. Human merges remain required. Review approval does not grant merge authority.

## Verified starting point

Haoshoku source inspected at 12fdc56ed51da3a0df01977950f5d05a5d8534af. Local Axstack source was 3491905f8beb51eaa1b4ee12169b0da919f5d45d (v0.4.0); both hosts now report v0.5.0, whose release commit is fd74a79a922471285da56e6523350fce2c3868a0. Implementation must start from revalidated current bases, not downgrade to the older inspected checkout.

Both hosts already expose 16 Axstack profiles and Axstack routing text; legacy skill names were absent from the surveyed roots. Both retain old task/theme settings. The workstation has active Claude Remote Control and stay-awake services. The VPS has active Hermes/T3 services, two additional system Claude services of unverified ownership, and eight active Paseo schedules. Three schedule IDs match Haoshoku's saved mapping; five do not. The workstation reports no schedules. These are discovery snapshots, not proof that resources are safe to retire. Raw paths, IDs, hashes and configuration remain in private run evidence.

Axstack 0.5.0 has no instruction-block CLI support. Its release asset is a GitHub tarball; reported asset SHA-256 is 9a3fea09c250d1a196e516d3ed541d45d1f5e368457e8ea5d6c8672728d27e1c. This is the current baseline, not the future feature-release pin or downloaded-byte verification.

## A. Axstack instruction ownership

Add a deterministic, versioned HTML-comment block containing only the Axstack entry pointer and minimal routing prose; model choices remain in profiles. Derive the entry path from the actual skills directory.

Support explicit instruction file selection, with Claude/Codex defaults resolved by the existing harness conventions, including CODEX_HOME. Extend the existing manifest with canonical instruction-file binding and owned block hash; preserve compatibility with existing manifests and their current hashing rules. Do not introduce a second manifest or rewrite other instruction text.

Plan/validate all affected skill, profile and instruction writes before mutation:
- Missing file: create the block. Existing file without markers: append once with recorded separation.
- Unchanged owned block: update or no-op. Edited or unowned block: preserve/report conflict; ordinary migration never forces adoption.
- Duplicate, nested or incomplete markers, invalid manifests, or unsafe symlinks: refuse without partial writes.
- Uninstall removes only the unchanged owned block and recorded added separation; leaves all unrelated bytes and the instruction file itself intact.
- Stage atomically, preserve permissions, detect concurrent changes and roll back partial failure. Report failed recovery accurately.

Axstack reports old Haoshoku routing outside its block; it does not delete unowned sections. The migration runbook archives and removes only verified old routing text, including existing unmarked Axstack pointers when converting to owned blocks. Preserve personal preferences.

## B. Haoshoku ownership reduction

Retain prerequisite installation (Bun, Git, gh/gh-stack), Claude Code and Codex CLI installation, native Paseo skills, and minimal Paseo runtime/service setup. Preserve required phone/runtime connectivity. Add one thin Axstack setup entry point and wire Arch/Debian defaults to it. Install a reviewed release tarball with a pinned version and verified SHA-256; do not assume an npm-registry package. Reuse the existing release-directory/shim layout where applicable. Never downgrade a newer/user-managed installation silently.

Use Axstack's CLI for its skill/profile/instruction setup; no copied editable Axstack payload or independent profile writer. Existing profile ownership stays bound to its current manifest; do not bind the same profile file through a second installation. Fresh installations target Claude and Codex only, using their resolved native skill directories. Existing independently managed OpenCode installations remain outside automatic host cleanup. On hosts whose profile file is already bound through the shared skills manifest, preserve that binding and omit the profile flag from harness-directory installs; do not migrate its ownership implicitly. Install new harness skills as real directories rather than adding the old Haoshoku symlink scheme. File setup and any necessary Paseo reload/readback are separate steps; preserve active sessions and report deferred activation honestly.

Remove these source families and their CLI/default-setup/backup/update paths:
- Matt Pocock collection installation; model-routing, paseo-pr-review, paseo-pr-babysit and bundled visual-explainer payloads/references.
- configure_agent_skills, configure_visual_explainer, legacy configure_paseo_profiles policy/backup, configure_paseo_tasks, configure_paseo_schedules and paseo_schedule_client. Retain only independently necessary runtime activation code.
- Claude/Codex personal config/statusline/backup deployment; keep or extract their CLI installers.
- Claude Remote Control, stay-awake, PR-watch, Hermes relay and T3 setup helpers/payloads.
- Extra AI app package entries (Claude/Codex desktop apps and OpenCode); keep Paseo. Audit installed extras separately rather than uninstalling arbitrary user tools.
- AI-only parts of Omarchy workspace/binding/bar entries, user scripts, Claude MIME handlers, Zed agent presets and Warp agent layouts. Preserve general desktop configuration; retain minimal Paseo access needed for its runtime.
- Active documentation/tests/imports/flags that recreate removed behavior. Historical changelog references may remain. Remove @getpaseo/client only if no retained consumer needs it.

Key source locations: haoshoku.js, src/common/cli_utils.js, src/os_scripts/{cachyos,debian_server}.js, src/helpers/configure_*.js, configs/{agent-skills,upstream-skills,paseo,claude,codex,claude-remote-control,claude-stay-awake,pr-watch,hermes-relay}, common/paru_applist.txt, configs/omarchy/haoshoku/*.lua, configs/omarchy/bar.json, configs/scripts, configs/mimeapps, configs/zed/settings.json and configs/warp/tab_configs. Mixed files receive narrow edits, not directory deletion. Retired flags exit with actionable guidance and cannot restore legacy configuration.

## C. Existing-host migration

Deliver a one-time runbook, not permanent migration infrastructure. Per host, each item has identity, provenance, current state, replacement, backup, disposition, executor, verification and rollback. Re-read immediately before mutation. Archive edited retired assets outside active discovery; never delete an entire harness/Paseo home or repurpose another manifest's ownership.

Ownership rule: an item must be in the agreed retired role set AND have positive provenance: exact bytes matching a shipped Haoshoku asset, or a verified installation record tying that exact item to a Haoshoku setup operation, or a unit invoking a helper whose own bytes match the shipped helper. A name or marker alone is insufficient. The retained Paseo runtime is never retired merely because Haoshoku installed it. For generated upstream units such as Hermes/T3, verify the installation receipt/helper path and current consumer graph; otherwise preserve and report incomplete. IO Remote Control and stay-awake units match the bundled templates exactly. Schedule mappings identify candidates only; validate object identity and legacy purpose against saved configuration and current dependencies before retirement.

Order: reviewed Axstack feature release -> reviewed Haoshoku integration/release -> workstation -> VPS. Install and verify replacement first. Ensure current agents, watches and notification delivery do not depend on a service before retiring it. Preserve Paseo itself. Stop only verified legacy service instances, disable their future activation and archive their managed units/helpers/config. Preserve unknown services, user data and shared packages pending proof; mark affected retirement incomplete rather than claiming success.

For schedules, saved mapping is a candidate list, not sufficient authorization to delete every daemon schedule. Validate the exact mapped object and its current intent/dependencies, then pause verified legacy schedules before retirement. Keep unrelated schedules. Preserve restorable schedule definitions privately before deletion; rerun/readback must prove disposition. Do not stop general worktree cleanup merely because an AI schedule shared its name.

Hermes/T3 are retirement candidates, not prerequisites for Axstack. Confirm live consumers before stopping them; if this would interrupt active work or required communication, hold only that retirement and report the dependency. Two unverified system Claude services and five unmapped VPS schedules are preserved unless later evidence establishes legacy ownership within this spec. No blanket host sweep.

## Acceptance criteria

A1. Instruction create/update/no-op/uninstall preserve outside bytes and permissions; all malformed/edited/unowned/symlink/concurrency states have meaningful tests.
A2. Existing manifests upgrade compatibly; failed combined writes restore prior state or explicitly report incomplete recovery. No forced ownership adoption in normal paths.
A3. Fresh Arch/Debian AI setup installs only the agreed tool/dependency set and Axstack-owned content. Claude/Codex discover the correct entry path.
A4. Repeated setup/update is idempotent; newer/user-managed Axstack and user profile choices survive; no duplicate profile ownership.
A5. Removed commands/default routes and packaged assets cannot reinstall old skills/config/services. Focused source/package checks enforce this boundary.
A6. Mixed desktop/instruction configuration preserves unrelated content; independent specialist/native Paseo skills, auth, sessions and custom configuration survive.
A7. Replacement failure performs no destructive legacy cleanup and returns a truthful failure/deferred result.
A8. Each host has private before/after evidence, backups and resource dispositions; verified legacy services/schedules are retired and preserved items remain unchanged. Unknown ownership is explicitly incomplete, never silently counted as retired.
A9. Host CLI versions, actual skill discovery, live profile readback and Paseo/phone connectivity are checked separately; a passing axstack check alone is insufficient.
A10. Focused red/green behavior tests, full repository tests, relevant lint, package inspection and independent exact-revision review pass before rollout. Release SHA/asset checksum/installed-byte evidence is recorded. Any runtime gap is reported separately.

## Provisional task map

- T1 Axstack owned instruction blocks and manifest compatibility — A1/A2; prerequisite for T2.
- T2 Axstack release verification and Haoshoku thin installer/runtime integration — A3/A4/A7; depends T1 and human merge/release gate.
- T3 Remove legacy Haoshoku AI management and payloads — A5/A6; depends T2 for integrated behavior. Cohesive sub-PRs may separate skills/policy, automation, and desktop assets; use gh stack.
- T4 Migration runbook, fixtures and integrated verification — A5-A10; depends T2/T3. Fixture/runbook preparation may run alongside independent source tasks; one writer per candidate.
- T5 Workstation migration — A8/A9; depends reviewed, merged and verified releases plus T4.
- T6 VPS migration and final evidence — A8/A9; depends successful T5 and per-resource dependency checks.

Tasks are not executable until this exact spec is approved. After approval, create linked GitHub capability/task issues tied to the approved revision and snapshot a repository counterpart. Routine PR splitting is driver-owned; bulk deletion size exceptions require recorded rationale, not invented small commits.

## Exclusions and approval boundary

No model substitution, automatic human-merge bypass, unrelated desktop redesign, global package cleanup, independent specialist-skill removal, credential/session deletion, unverified service/schedule retirement, or new workflow runtime. No source or host mutations were performed during preparation. This spec authorizes the described implementation and rollout only after explicit approval; human merges remain a separate gate.

## Decision review receipt

Fable 5.1 agreed on the design and acceptance criteria. Driver accepted the explicit provenance rule and fresh-target/binding clarifications in r2. Driver rejected requests to re-ask already settled service-retirement choices: the latest explicit user decision above governs. Release checksum remains reported metadata until downloaded bytes are verified. Luna checkpoint audit is separate evidence, not implementation approval.
