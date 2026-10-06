# Ticket map — Replace Paseo with T3 Code

Spec: #104 rev r4, body SHA-256 038bce54153d204ca09cf6449bb86134ff6dbc9ce5c15a996e1d67d34b50b7a7
Store: GitHub Issues (axatbhardwaj/Haoshoku); capability issues #105-#109. Execution detail lives here and in the repository plan (docs/plans/2026-10-06-replace-paseo-with-t3.md, added in PR1).
Stack: gh stack, bottom-up from stable 9a0717193f5ddc6151f7b8a366e24db884d4664e. Each PR green alone. Each PR adds a CHANGELOG `## Unreleased` entry (PR1 creates the heading).
Shape decision: the spec's PR2 "Remove Paseo orchestration" is split into T2 (task lifecycle + schedules, ~2.1k lines) and T3 (profiles, ~1.8k lines) to stay near the 2000-line target; spec PR3-PR6 become PR4-PR7.

Capability: #105 Hermes on Debian without the Paseo relay plugin
Internal task: T1 -> PR1 -> author worktree axstack/20261006-retire-paseo-routing/axstack-author/t1-a1
Theme: Hermes relay setup without Paseo (spec PR1)
Size est: rationale band (~2.2-2.5k, deletion-dominated: helper rewrite + 1.1k-line test file rewrite + two deleted tests)
Acceptance: A1; A5; A4 Hermes failure path; A10 for PROFILE.md text; checker instructions removed (spec PR1 bullet); docs/specs + docs/plans snapshot added
Depends: none

Capability: #106 Paseo and its routing policy removed
Internal task: T2 -> PR2 -> axstack/20261006-retire-paseo-routing/axstack-author/t2-a1
Theme: remove Paseo task lifecycle and schedules (configure_paseo_tasks.js, configure_paseo_schedules.js, paseo_schedule_client.js, @getpaseo/client, flags --paseo-tasks/--paseo-schedules/--paseo-schedules-check/--paseo-schedules-apply/--paseo-tasks-enabled/--paseo-task-cleanup/--paseo-task-renaming, ensurePaseoTaskConfig import+call, task-config test cases, docs)
Size est: rationale band (~2.1-2.3k, deletion-dominated)
Acceptance: A1; A3 for its flags
Depends: T1

Internal task: T3 -> PR3 -> axstack/20261006-retire-paseo-routing/axstack-author/t3-a1
Theme: remove Paseo profiles (configure_paseo_profiles.js, configs/paseo/, --paseo-profiles, --paseo-profiles-backup, CachyOS + Debian profile-sync step, workflow_routing_policy profile-data case, default-run/side-effect/CachyOS/Debian/gh-stack/cli-utils/help tests, docs)
Size est: target band (~1.9-2.0k, deletion-dominated)
Acceptance: A1; A3 for its flags
Depends: T2

Internal task: T4 -> PR4 -> axstack/20261006-retire-paseo-routing/axstack-author/t4-a1
Theme: remove bundled routing skills (spec PR3)
Size est: target band (~0.9-1.1k)
Acceptance: A1; A3 for --agent-skills-backup; A7
Depends: T3

Capability: #107 T3 Code replaces Paseo
Internal task: T5 -> PR5 -> axstack/20261006-retire-paseo-routing/axstack-author/t5-a1
Theme: T3 Code server over Tailscale (spec PR4)
Size est: target band (~0.8-1.2k)
Acceptance: A1; A4 (T3 required, no prompt, failure returns false); A6
Depends: T4

Internal task: T6 -> PR6 -> axstack/20261006-retire-paseo-routing/axstack-author/t6-a1
Theme: remove Paseo server and desktop integration; SUPER+T -> T3 (spec PR5)
Size est: target band (~1.8-2.0k, deletion-dominated)
Acceptance: A1; A3 for --server-paseo; A4 never calls Paseo (top of stack from here); A8
Depends: T5

Capability: #108 T3-native Axstack 0.24.1 pin
Internal task: T7 -> PR7 -> axstack/20261006-retire-paseo-routing/axstack-author/t7-a1
Theme: pin Axstack 0.24.1 + roles.json readback + Omarchy t3 link (spec PR6)
Size est: target band (~0.3-0.5k)
Acceptance: A1; A2 (final stack head); A9
Depends: T6

Capability: #109 Release v12.0.0
Internal task: T8 -> driver -> driver worktree on stable
Theme: release
Size est: n/a (release.js commit)
Acceptance: A11
Depends: T1-T7 merged, PR #103 merged

Acceptance coverage: A1 all PRs; A2 T7 (final); A3 T2/T3/T4/T6 (each removed-flag family, one table test grows per PR); A4 T1 (Hermes), T5 (T3), T6 (never Paseo); A5 T1; A6 T5; A7 T4; A8 T6; A9 T7; A10 T1 (and every PR keeps it); A11 T8.
