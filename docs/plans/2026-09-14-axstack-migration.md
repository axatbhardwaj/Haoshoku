# Axstack migration execution map

Approved spec: [Haoshoku #63](https://github.com/axatbhardwaj/Haoshoku/issues/63), r2, approved 2026-09-14.
Authoritative store: GitHub issues (user-selected).
Approved body SHA-256: `7129b97a0cf4c314d8aea417a059fb64e9a48868e1188f0d94b9583b5ec76280`.
Immutable counterpart: `docs/specs/2026-09-14-axstack-migration-r2.md` at local commit `2faa85fb6262b56654a00250eb19065822cbaa22`.
The counterpart preserves the originally approved text, including historical DRAFT wording; approval is established by this record and the parent issue receipt. No material scope revision.

## Capability map

| Task | Issue | Dependencies | Acceptance | State |
| --- | --- | --- | --- | --- |
| T1 | [Own Claude/Codex instruction routing blocks](https://github.com/axatbhardwaj/axstack/issues/19) | Approved spec | A1, A2, A6, A10 | Ready |
| T2 | [Install Axstack with required AI runtimes](https://github.com/axatbhardwaj/Haoshoku/issues/64) | T1 | A3, A4, A7, A9, A10 | Waiting |
| T3 | [Retire legacy AI configuration and bundled tooling](https://github.com/axatbhardwaj/Haoshoku/issues/65) | T2 | A5, A6, A7, A10 | Waiting |
| T4 | [Verify integration and document recoverable host migration](https://github.com/axatbhardwaj/Haoshoku/issues/66) | T2, T3 | A1–A10 (integration and rollout preparation) | Waiting |
| T5 | [Migrate IO to the approved Axstack setup](https://github.com/axatbhardwaj/Haoshoku/issues/67) | T4 | A8, A9, A10 | Waiting |
| T6 | [Migrate VPS and reconcile final migration evidence](https://github.com/axatbhardwaj/Haoshoku/issues/68) | T5 | A8, A9, A10 | Waiting |

## Internal tasks and isolation

The current driver owns preparation and integration. At execution dispatch, assign one persistent PR owner and record its actual session/worktree in the private run record. No owner or worktree is fabricated at planning time. Exactly one writer per candidate; author and reviewer are independent. Re-pin current repository bases, live profiles and package releases before dispatch. Human merges remain required.

- **T1:** Two candidate themes if green separation permits: block/manifest primitives (<=2000 lines); CLI transaction integration/tests (<=2000). Reassess from actual diff; one writer each.
- **T2:** Installer and OS integration can form separate green stacked PRs, each target <=2000 lines. Feature-release merge/publication is a dependency, not granted merge authority.
- **T3:** Split skills/profile payloads, automation helpers/flags, and AI-only desktop/package entries into independent green themes. Vendored visual-explainer deletion may exceed 2500 lines by itself: record reproducible bulk count, actual total/base/head and why further splitting a single retired payload would leave invalid intermediate packaging. No silent subtraction.
- **T4:** Runbook/fixtures and final integration checks are separate bounded units; target <=2000 lines per PR. Draft runbook and fixtures may proceed independently while source tasks run; integration completion waits for T2/T3.
- **T5:** Operational task, no fixed source-line estimate. One execution owner on IO. Do not stop active dependencies merely to satisfy completion; hold affected retirement with evidence.
- **T6:** Operational task, no fixed source-line estimate. Same execution host coordinates remote work; one owner. Final capability completion requires all applicable checks, not merely merged PRs.

T1 executes in an Axstack worktree. T2/T3 use separate Haoshoku candidate worktrees and gh stack for dependent PRs. T4 runbook/fixture preparation can run independently; final integration waits for T2/T3. T5/T6 are single-owner operational tasks coordinated from IO, with private before/after evidence; VPS follows successful IO migration. No source task mutates live home configuration during development.

## Completion and handoff

T1 is ready for dispatch; T2 awaits the reviewed, human-merged feature and verified release. No task is Done. A reviewed PR remains In Review until required merge and acceptance evidence exists. Host retirement requires positive provenance and dependency checks, not just a matching name. Preserve unknown items and mark affected retirement incomplete.

Preparation is complete when issue readbacks, approved snapshot and this map agree. Implementation has not begun. No timers or execution workers were launched. Resume through Axstack implementation using the approved identity; do not repeat spec approval or settled Fable decisions.
