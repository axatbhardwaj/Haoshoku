> # SUPERSEDED — DO NOT EXECUTE
>
> This plan is superseded in full by `SPEC-S3A.md`. S3B was dropped by human decision after two
> plan-review rounds (blocker R2-B2: no trustworthy place within a Stop hook's reach to record that
> a block occurred). Sections below retain executable steps for mechanisms that no longer exist —
> an at-cap downgrade, UUID receipt acceptance, a single `< 2 s` re-poll budget, silent background
> suppression, and the `/tmp/claude-routing-gate` state path. Following them literally will test the
> wrong outcomes. Retained for the audit trail only.

# PLAN — routing-gate.sh fix (D1–D8), full dvandva

Author: madhyastha (Fable). Status: awaiting pre-execution review by a different model family.

## Material fact derived from the source, which shapes everything

**After any block, the very next stop carries `stop_hook_active=true` and the hook exits 0
unconditionally.** The current gate is therefore already a one-block-per-turn tripwire that any
response clears. There is **no hard guarantee to weaken** — there is only an *unauditable
acknowledgment to make auditable*. Several judgments below rest on this.

## 1. Scope

**Land:** D1, D2, D3, D4 (narrowed), D6, D8 (mitigation), `background_tasks` suppression, the D7
decision (no exemption, documented), the report correction (five→four), hook-header limitation
updates. D5 lands by construction, not mechanism.
**Defer:** launcher-side per-target receipts (requires changing `codex-wrapper`'s `report.json`
schema — shared infrastructure, separate work item, confirm-before-change).

Reasoning on the D8-ranking question:

- D8 outranks the usability fixes in **direction** but not **magnitude**, and cannot be fully fixed
  from inside a hook. The exposure window is narrow: a turn's tool records have the whole final-
  response generation time to flush; only writes from the turn's last tool calls followed by a fast
  final message can be missing. That shape is real, but the observed session's four blocks prove
  the transcript was fresh enough to catch exactly it. Treatment is detector + bounded mitigation +
  honest limitation note, not redesign. It lands now because it shares the transcript-read code
  path being touched anyway. It does not displace D1/D2, because D1/D2 stop the gate training the
  behaviour it exists to prevent — itself a safety property.
- D1+D2 are the spine and interlock: D2's cap needs D1's marker vocabulary, or the cap just
  relocates the dead end.
- D4 lands **narrowed**. The report's prefix-match would refuse every scratch-copy review — the
  dominant legitimate pattern, including this work item — making the gate a permanent over-blocker
  that trains marker abuse.
- D3+D6 land together; the rewording is only honest once detection scope is final. New failure
  modes all point safe (over-block).
- D7 **decided, not changed**: global policy lists memory among reviewed durable writes; the hook
  mirrors policy; changing policy is the human's call. D1+D2 discharge the practical sting.
- D5 needs no mechanism: with an honest exit cheaper than a junk dispatch, and foreign receipts no
  longer discharging, the cheapest path becomes the truthful one. State in header; add no code.

## 2. Design decisions

**Fork 1 — parse `last_assistant_message` for a carve-out? YES**, with three load-bearing
constraints. Acceptability rests on the material fact above: the model can already clear any block
by stopping again, and a junk dispatch already discharges everything. Parsing weakens nothing and
converts an invisible prose promise into an auditable record.

- (a) Rigid line-anchored syntax carrying the **specific normalized absolute path**:
  `ROUTING-GATE-WAIVER: <abs-path> — <reason>`, matched multiline with `^` anchor, non-empty reason
  required. Exact token is the implementer's choice but must be collision-improbable.
- (b) The path must match an **actually-uncovered target** after the same `durable_path`
  normalization (MCP pseudo-targets `<mcp__...>` match as exact strings). No blanket waivers. This
  is what requiring the path buys: prose *about* carve-outs cannot fire, because the hook reads only
  `last_assistant_message` of the stopping turn (never the transcript) and requires anchor + token +
  exact current uncovered path.
- (c) Every honored marker is appended to session state as `{session_id, path, reason, ts}` — the
  audit record D1's complaint was really about.
- Additionally: on the `stop_hook_active` pass, still **parse-and-log** a marker before exiting 0 —
  otherwise carve-outs stated *in response to* a block (the observed pattern) vanish unlogged, which
  was the original defect.
- Residual risk accepted: a final message quoting the syntax verbatim with a live uncovered path is
  treated as stating it. That text is effectively a statement.

**Fork 2 — workspace-scope receipts (D4)? Yes, by attribution, not content.** Accept a receipt iff
mode/status/time-window as today AND one of:
  (i) receipt `workspace` is a path-prefix of the uncovered target;
  (ii) the uncovered target is under `workspace`;
  (iii) `workspace` contains the current `session_id` as a substring (scratch-copy reviews under the
       session scratchpad — the established pattern).
Rule (iii) would have **rejected the observed live hazard** (a foreign receipt embedding a foreign
session UUID) while accepting own-session scratch reviews. Receipt missing `workspace` → reject
(over-block, safe). `session_id` missing from input → (iii) cannot match → scratch receipts rejected
→ over-block, safe. The block message states the convention so the model knows how to make receipts
attributable.

**Fork 3 — exempt `~/.claude/**` (D7)? NO.** The gate mirrors policy; D1+D2 remove the motivating
cost; the report concedes the forced reviews caught real defects.

**Fork 4 — `background_tasks` suppression? YES** — exit 0 when the field is present and non-empty.
A stop with in-flight background tasks is "paused awaiting work", not a completion claim. All four
observed nuisance blocks were this shape. `additionalContext` is NOT an alternative — it *continues*
the conversation, exactly wrong for a pausing session. Field absent or malformed → behave as today.
Document as new limitation #5 with direction stated.

**D2 termination mechanics.** Per-path block counter in `/tmp/claude-routing-gate/<session_id>.json`
(hook state *should* die with reboot; the "no /tmp continuity" rule governs prativadi session
pointers, not this; `/tmp/**` is already excluded from `durable_path`, so the hook never gates its
own state). Cap = **2 hard blocks per path**, matching the policy's two-round cap. At cap: emit
`hookSpecificOutput.additionalContext` once — "debt logged for <path>; record it in your completion
claim" — flag in state, allow subsequent stops. Mixed sets: block for under-cap paths, list at-cap
paths as logged debt in the same message. State read errors → treat as zero counts (more blocking =
safe); state write errors → swallowed, never break gating.

**D8 mechanics.** The hook already parses every transcript record; keep the last assistant text
seen. If input `last_assistant_message` is non-empty and does not match it (whitespace-normalized
containment), the transcript is provably stale → re-poll up to ~2 s. If still stale → **block once**
with a stale-specific message. Noisier and safe; the alternative (silent allow) is the quieter
change the constraints demand strong justification for, and none exists. Known weakness stated:
`stop_hook_active` makes this a one-shot honour prompt; if real lag > 2 s proves routine this becomes
nuisance — fallback dial (drop to `additionalContext`) documented in the header, flipped only on
observed noise. If `last_assistant_message` absent (older CC), no determination possible → current
behaviour; limitation #4 records the residual.

**Untouchable zone.** `dispatch_failed` recursion semantics. The header records a fix attempted and
reverted for regressing launcher-status detection entirely. Every implementation brief carries this
as a prohibition; if a change cannot avoid touching it, the worker stops and reports, and the full
launcher-status sweep becomes a hard gate.

## 3. Station graph

Workspace: `~/.claude` is not a repo and the launcher requires a clean tree, so all worker stations
run in a **scratch git repo** at `<scratchpad>/routing-gate-fix/` (baseline commit = byte-identical
pristine hook, `tests/` alongside). Its path embeds the session UUID, so this item's own receipts are
attributable under the new D4 rule. Deployment is a verified copy back. Chair drops `git bundle`
snapshots next to the durable backup after each green station (tmpfs hedge).

- **S0 — Plan review.** `codex-wrapper` review/sol — different family from this plan's author.
  Anchored to: this plan verbatim + defect report + research brief. Gate: findings returned and
  dispositioned by the standing madhyastha; no station output accepted before disposition.
  May overlap S1 only.
- **S1 — Workspace + backup.** Chair. Carve-out: workspace provisioning / trivial mechanical file
  ops; no code authored. (1) durable backup `~/.claude/hooks/routing-gate.sh.pre-fix-2026-07-21`;
  (2) scratch repo init + baseline commit. Acceptance: backup `cmp`-identical to live; clean tree;
  baseline commit byte-identical. Backup is a durable write → enters the batched review.
- **S2 — Characterization harness (TDD phase 1).** `codex-wrapper` implementation/sol, scratch
  workspace, `--persist`. Skills: `test-driven-development` (inversion stated: characterization
  tests are written to PASS against the pristine hook; a failing one signals a misunderstanding to
  report, never a hook edit), `verification-before-completion`. Goal: stdlib-`unittest` harness
  driving the hook **as a subprocess** — synthetic hook-input JSON on stdin, fixture JSONL
  transcripts, fixture receipt tree. One testability seam in scope as its own commit: env-var
  overrides for report-glob roots (and state dir), **defaulting to production paths** — receipts must
  never be fabricated under the real glob, because a fresh ok-review fixture there would discharge
  real concurrent sessions' gates. Must pin, each labeled with failure direction: all fail-open
  exits; the full bash-parser table (cp/heredoc/rm invisible, redirections detected); **the complete
  launcher-status sweep** (only `ok` discharges; each of detached / still_running /
  blocked_dirty_tree / codex_failed / invalid_result / invalid_report / review_violated_readonly does
  not); limitations #1/#2/#3; receipt time-window and first-timestamped-record session-start logic;
  symlink/FIFO/oversize receipt handling; perf test (>=500 fake run dirs, < 2 s). Also: read the
  launcher source and report whether `workspace` is always written. Acceptance: suite green against
  seam-only hook; corpus proof that seam-default output is byte-identical to pristine; `result.json`
  maps every pinned behaviour → test name. Pre-authorized contingency: if moderation blocks
  adversarial fixture construction, those fixture-generators are written by a Claude-native
  `developer` subagent under recovery carve-out (d), then consumed by the codex station.
- **S2R — Harness review.** Chair (opus), family-disjoint from author. Anchored to the diff **plus
  the pinned-behaviour matrix verbatim**. Chair independently runs the suite. Gate: matrix fully
  covered, suite green under chair's own run, findings dispositioned (<=2 rounds). **S3 does not
  dispatch until this gate closes** — S3's brief quotes S2's artifacts.
- **S3 — Implementation (TDD phase 2).** `codex-wrapper` implementation/sol, same workspace, resumed
  session. Skills: `test-driven-development` (Iron Law: new failing test first per behaviour change),
  `verification-before-completion`. Implements §2. D3 verb table: cp, mv, install, tee, dd, rm,
  sed -i; conservative extraction — unknown flag shapes yield no targets; `AMBIGUOUS_BASH` bail-outs
  unchanged. D6: scope-honest count + marker syntax documented in the block message (the block
  message is the marker's API doc). Header updates: limitations #1–#3 retained, #3 annotated with the
  narrowing, new #4 stale-residual and #5 background-suppression, D7 decision recorded, D5 reasoning
  noted. Characterization tests may flip **only** where a behaviour change is the point; every flip
  enumerated in `result.json` with its defect number. Prohibited: touching `dispatch_failed`;
  removing/weakening any fail-open exit; any edit to `settings.json`; exceeding perf budget; scope
  beyond the named defects. Acceptance: full suite green; flip list exactly matches the planned set
  with zero unexplained flips; perf green; `bash -n` clean.
- **S3R — Adversarial cross-review, two parallel read-only voices, both family-disjoint from sol:**
  (a) chair (opus) deep review anchored to the accumulated diff + defect report + this plan verbatim,
  **plus one system-state pass over the whole hook file** (diff-scoped review misses adjacent
  defects); (b) Claude-native `adversarial-analyst` running attack hypotheses — marker spoofing from
  earlier-turn prose, receipt forgery shapes, state-file poisoning, path-normalization bypasses, the
  D8 window — with `sandbox-executor` probes where runtime evidence is needed. This lane exists
  because codex moderation blocked adversarial-fixture work previously. Both read-only over the same
  artifacts → genuinely parallel. Gate: findings-or-explicit-none; dispositions closed (<=2 rounds).
- **S4 — Report correction (independent branch).** `opencode-wrapper` (alias `kimi`) — HTML
  deliverable, rupakara-mandatory; dvandva invoked with no exemptions, so no trivial-edit shortcut.
  In `/home/xzat/reports/routing-gate-hook-report.html`, correct block count five→four at every
  occurrence: the `dvandva-artifact-meta` basis string, thesis paragraph, facts-table basis row,
  header chip `blocked 5×`, verdict paragraph, D1's "five separate turns" and "five blocks to one",
  D3's observed table `Blocked 5×` and SVG text `GATED — blocked 5×` — plus a footer errata line.
  Nothing else changes. Acceptance: grep for five/5× block-count tokens returns zero; four/4× present
  at each spot; word-level diff confined to those spots + footer. Cross-review: `codex-wrapper`
  review (different family from kimi), detached; chair does the Claude-native taste pass. Fan-out
  legs all hold → parallel to S2–S3 any time after S0.
- **S5 — Deployment.** Chair. Named carve-out: target is a non-repo path the external lane cannot
  operate on (launcher requires a git workspace) and the artifact is fully reviewed — verified
  mechanical copy: hook → `~/.claude/hooks/routing-gate.sh`; harness → `~/.claude/hooks/tests/
  routing-gate/` with a README (run command + env-seam docs), ending the "no tests exist" condition.
  Acceptance: `cmp` scratch↔deployed; `bash -n`; manual smoke of the deployed hook with three
  fixtures on stdin (block, waiver-allow, background-suppress); `settings.json` untouched.
- **S6 — Live-fire + cold terminal acceptance.** (a) Chair live-fire in a throwaway session:
  unreviewed durable write → stop → observe block; stated waiver marker naming the path → observe
  allow + debt record in state; construct one real-shaped receipt under the production glob with
  `workspace=/tmp/routing-gate-live-check-nonexistent` (matches no target, no session — cannot
  discharge anything, including other sessions') → confirm no discharge; confirm `background_tasks`
  presence and suppression while a dispatch is in flight. (b) **Cold madhyastha** — fresh Fable
  spawn, no exposure to this plan or stream (the standing one is anchored to its own plan and is
  disqualified) — judging deployed hook + harness + evidence against the acceptance contract.
  Gate: verdict accepted by chair; routing ledger assembled.

Pipeline: S0 → (S1 ∥ S4-start) → S2 → S2R → S3 → S3R(a ∥ b) → S5 → S6. S4 completes and is reviewed
any time before the completion claim. S2→S3 share a write scope and are output-coupled — strictly
serial, no manufactured parallelism.

## 4. Verification before replacement

1. Characterization suite green against pristine-plus-seam, with seam-default byte-identity proof.
2. **Under-block proof — the core obligation.** Every characterization test pinning a BLOCK outcome
   must still block under the fixed hook, except flips on an enumerated allowlist (waiver-marker
   allow, at-cap downgrade, background-suppression), each mapped to its defect and justification.
   Enforced as a dedicated test class over the block-producing corpus; zero unexplained allow-flips
   is a hard gate. Plus a **direction-audit table** in `result.json`: every behavioural delta labeled
   noisier/quieter, every "quieter" row carrying justification — reviewed explicitly in S3R.
3. Strictly-more-detection proof for D3: cp/mv/rm/tee/dd/install/sed-i corpus flips invisible→
   blocked; all pristine-detected cases remain detected.
4. Launcher-status sweep green: only `ok` discharges; all seven non-ok statuses pinned
   non-discharging.
5. Foreign-receipt rejection: mismatched-workspace and foreign-session-UUID receipts do not
   discharge; own-prefix and own-session-UUID receipts do.
6. Perf < 2 s over >=500 fake run dirs including worst-case re-poll.
7. All fail-open exits pinned and preserved: malformed stdin, missing transcript, missing python3,
   unreadable state file, oversized/symlink/FIFO receipts.
8. Deployment byte-identity, `bash -n`, three-fixture smoke, `settings.json` untouched.
9. Live-fire per S6(a). 10. Cold-madhyastha verdict per S6(b).

## 5. Rollback

Backup `~/.claude/hooks/routing-gate.sh.pre-fix-2026-07-21`, created in S1 before anything else,
byte-verified, on durable storage (not /tmp). Scratch baseline commit is a second diffable copy; git
bundles snapshot after each green station. Revert: `cp` backup over the live hook; `cmp` to confirm;
run one block-fixture through it to confirm old behaviour; optionally `rm -rf /tmp/claude-routing-
gate` (harmless if left — the old hook never reads it). No `settings.json` change exists to revert.
Under a minute, no restart (the hook is re-executed per stop). If S6 live-fire fails: revert first,
diagnose in the scratch repo second.

## 6. Premises

**Verified directly by the planner:** hook source in full incl. the three limitation notes, the
reverted-fix warning, the `stop_hook_active` short-circuit, fail-open paths; settings wiring and
timeout; receipt schema incl. `workspace` on real receipts (83 of ~120 carry it; the remainder are
hand-built fixtures from the five prior hook builds, polluting the real glob root — which confirms
the harness must not fabricate receipts there); the defect report's content and its multiple "five"
occurrences; the report's D4 live example being a scratch-workspace receipt embedding a foreign
session UUID.

**Assumed from the research brief (flagged):** the Stop-hook contract quotes — `last_assistant_
message`, `additionalContext` semantics, `background_tasks` v2.1.145+, transcript-lag warning,
8-block circuit breaker. Not re-fetched by the planner. S2's brief re-confirms `additionalContext`
continue-semantics and the input fields against the doc copy; S6 live-fire confirms
`last_assistant_message` / `background_tasks` empirically. Also assumed: four-not-five, the 0.036 s
scan timing, `isSidechain` subagent invisibility. **Assumed pending S2:** that the launcher always
writes `workspace` — S2 reads launcher source to settle it; until then reject-on-missing keeps the
failure direction safe.

**Re-plan triggers:** real transcript lag > 2 s routine (flips D8 to the `additionalContext` dial —
a disposition, not a re-plan); `background_tasks` schema differing materially (suppression stays
dormant behind its guard — degraded, not broken); moderation blocking wider than fixtures
(contingency lane named); `last_assistant_message` transformed/truncated relative to transcript text
(would force a weaker D8 heuristic — cheap probe in S2/S6).

## Two items the planner specifically wants attacked in S0

1. The D4 attribution rule's **session-UUID-substring arm** — is there a cleaner attribution signal?
2. The D8 **stale-block one-shot** — does block-once-then-honour beat silent-allow given
   `stop_hook_active`'s short-circuit? Planner holds yes, at moderate confidence.
