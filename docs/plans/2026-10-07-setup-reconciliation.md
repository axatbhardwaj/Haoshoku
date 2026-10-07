# Haoshoku setup reconciliation task map

Spec: [GitHub #63](https://github.com/axatbhardwaj/Haoshoku/issues/63), approved 2026-10-07 r2 plus explicit Claude/Codex Executor client follow-up.
Frozen r2 SHA-256: `9291e751997d11ab1991919c2cf97e7350ba5e62c6119c1c688f32f06c77ab91`.
Approved receipt and client addendum issue-body SHA-256: `1295eccb5954391109ebe1732f701abe1257fc40aab331fd621a289542c4bec5`.
Repository counterpart: [specification](../specs/2026-10-07-setup-reconciliation-r2.md).
Source base: `de11fb3a084a59f6f3048e2decdc89f15819c09d`.
Driver/PR owner: T3 thread `ac403707-3880-496d-a6bc-adc20964bc05`.
Notification policy: Hermes home only for decision holds, serious risk, and at most two merge-ready/merged milestones. No progress notifications.
Authority: repository implementation and GitHub reconciliation; human merges; no live rollout or release.

## Capabilities

### #65 — Future installs retire the five selected legacy families

Acceptance: r2 A1, A2, A3, A9, A10. Default Arch and Debian setup and all eleven retired CLI forms cannot install or reactivate the selected tools. Retired commands fail before side effects; disposable homes preserve independent skills and live copies. Package inspection proves the retired payloads/routes are absent and retained tools work. Every behavior change has observed red/green proof, full tests/lint and exact-head review.
Depends: T1, T2, T7.
Retained September removals: T3, Hermes, Claude/Codex, Axstack, Git/gh/gh-stack, shared agent instructions and unrelated desktop/editor setup. This amendment does not authorize host cleanup.

### #66 — Safe, reproducible T3/SSH/Executor setup

Acceptance: r2 A4, A5, A6, A7, A8, A9, A10 and client-addendum M1, M2, M3. T3 refuses ambiguous desktop-local state; SSH requires tailnet readiness and propagates incomplete hardening; opt-in Executor preserves deployments and bounds readiness checks. Executor client setup covers both Claude and Codex with preservation, supported auth and truthful verification. Documentation and tracker state distinguish source proof from deferred host work. Full fixture details remain binding in the linked spec.
Depends: T3, T4, T5, T6, T7.

## Execution

All tasks form one gh stack. Each starts from its reviewed parent's exact SHA, never an unreviewed moving branch. One Sol author per candidate; same author owns repairs. The driver publishes, links, obtains independent Opus review and Sonnet diligence, and preserves the human merge gate. T3 binds every author to a separate worktree. Runtime IDs and exact revisions belong in the private run record, not this plan.

| Task | Theme and owned boundaries | Dependency | Estimate | Acceptance |
| --- | --- | --- | --- | --- |
| T1 skills-retirement | Remove Matt Pocock and visual-explainer routes/payloads, whole agent-skills route; narrow CLI/default calls and relevant tests/docs | approved planning baseline | medium code plus bulk vendored deletion | A1-A3 skills portion; A9-A10 |
| T2 services-retirement | Remove Remote Control, stay-awake and PR watch routes/payloads/default calls; CLI rejects their forms; relevant tests/docs | reviewed T1 | medium code plus bulk vendored deletion | remaining A1-A3; A9-A10 |
| T3 t3-guard | Both T3 entry points and focused preflight/tests; no desktop config or pairing writes | reviewed T2 | medium | A4; A9-A10 |
| T4 tailnet-ssh | Debian firewall, explicit overall-result propagation and command fixtures; no public-rule deletion | reviewed T3 | medium | A5; A9-A10 |
| T5 executor-server | Opt-in CLI, preserving deployment helper/templates and simulated external-boundary tests | reviewed T4 | large coherent installer | A6-A7; A9-A10 |
| T6 executor-clients | Explicit client setup for Claude/Codex, preserving unrelated config and existing Executor entries; credential-safe tests/docs | reviewed T5 | medium | M1-M3; A9-A10 |
| T7 docs-reconciliation | Final README/docs/runbook/root instruction sync, directory indexes, Unreleased entry and aggregate package/integration verification | reviewed T6 | medium docs | A8; cumulative A1-A7 and M1-M3; A9-A10 |

The focused-helper design is binding: existing CLI/OS entry points -> small helpers -> injected process/filesystem/probe boundaries. Failed prerequisites return incomplete before unsafe effects. Avoid a generic deployment or configuration framework.
Each author updates maintained documentation for its own public behavior; T7 checks the whole final state and resolves cross-cutting wording. Historical specs/plans/changelog entries stay intact. Record bulk deletion separately and prefer semantic commits around 200 lines where practical.
Every author returns named real behavioral red/green logs, full bun test output, lint result, package inspection where relevant, simplification receipt, exact base/head and unverified live boundaries. Tests must observe behavior rather than mirror source text. No installed host configuration is touched by this run.

## Tracker reconciliation

- #63 stays open while follow-up remains; #65/#66 close only after all mapped PRs merge and acceptance passes.
- #67/#68 stay open and explicitly deferred for separately approved host migration. Source tests and Notion notes are not host proof.
- #64 closed, #69 merged and axstack#19 closed remain historical evidence; external Axstack repository is read-only.
- #86 is superseded after final parity verification; its intended template routing is already present.
- #72 closes as obsolete only after the verified replacement PR is linked. Do not merge or execute its old provisioning.
- Record completion evidence and PR references in GitHub without rewriting historical approval bodies.
