# S0(v2) ROUND-2 FINDINGS — verdict: PLAN_NEEDS_REVISION

Reviewer: gpt-5.6-sol, read-only, run-3LfPrVG2, resumed session 019f83bd-7001-7080-81cc-8f64180c84ac.
Contract deviation (2nd time): category/confidence returned instead of severity; no residual_risks array.

## Blockers (reviewer's own list)
- R2-B1 — Timestamp-only generations can reuse an already-waived generation when a later successful write has the same or no timestamp.
- R2-B2 — The model-writable state store is trusted to assert `blocked_shown=true`, allowing a strict-valid forged state record to suppress the first tripwire.
- R2-B3 — `additionalContext` deferral can repeat while a background task or pending transcript dispatch remains present, so no hard block is mechanically guaranteed.

## [monotone visibility / generation identity] (confidence: high)

The source requires a string tool-use ID but stores `record.get("timestamp")` without requiring it to exist, then records successful writes with that value at routing-gate.sh:360-384. Sequence: G1 for path P has timestamp `null` or T, blocks, and is waived; a later successful write G2 to P has the same `null` or T; because G2 is not “newer than” stored `gen_ts`, the fixed hook can inherit `blocked_shown=true, waiver_logged=true` and remain silent, whereas the pristine hook recomputes sequence order and blocks at 387-409. A timestamp that moves backward or changes representation after compaction is similarly undefined because the plan only rearms on “newer,” not on any different observed write identity. This means round-1 F2 is not adequately addressed.

## [state poisoning / first-block evidence] (confidence: high)

That equivalence is false under the redesign. The proposed strict-valid state itself contains the authoritative assertions `blocked_shown` and `waiver_logged`; a model can write the current generation as `{blocked_shown:true, waiver_logged:true}` before its first Stop, using a `/tmp` write that routing-gate.sh:96-99 excludes. The fixed hook can then quiet that generation without ever producing a block, while the pristine hook ignores the state and blocks. Permissions, ownership checks, `O_NOFOLLOW`, size limits, schema validation, and atomic replacement protect against accidental corruption and cross-user attacks but cannot distinguish a same-UID forged boolean from a hook-written boolean. This leaves round-1 F1 and F4 inadequately addressed and directly falsifies the central invariant.

## [additionalContext deferral / unbounded non-blocking loop] (confidence: high)

The plan has no mechanism that makes this assertion true. At the first non-active Stop, an uncovered write plus a non-empty `background_tasks` list or a still-pending worker tool use makes the fixed hook emit `additionalContext`, although the pristine hook would hard-block. If the task remains non-empty or the pending tool use remains without a result, the same predicate remains true at every later fresh Stop, so deferral can repeat indefinitely; if continuation produces `stop_hook_active=true`, the current source’s unconditional exit at 67-68 creates another non-blocking path unless v2 explicitly replaces it. A hung task may produce no later Stop at all. The deferral text does surface the paths in transcript feedback, but it is not a hard block, is not established as user-visible, and cannot count as the invariant’s promised hard-visible block. This leaves round-1 F5 inadequately addressed.

## [waiver ordering, generation binding, and false parsing] (confidence: high)

The formal exception requires a waiver that “postdates a visible block,” but a pre-emptive waiver is logged before that block, and the stated schema `{gen_ts, blocked_shown, waiver_logged}` has no block event, waiver timestamp, reason, or ordering data with which to enforce the requirement. A path-only marker also cannot resolve the required G1/G2 case: after G1 blocks, the model can write G2 to the same path and emit a marker intended for G1 in the same continuation; with only the path, the hook cannot tell whether to attach it to the previously blocked G1 or the current unblocked G2. Fenced-block stripping lowers the false-positive stakes compared with v1 because a first block is still intended, but a raw pasted marker at column zero can still create a persistent waiver after that block; four-space code, inline backticks, and blockquotes are safe only if the implementation preserves their leading syntax rather than trimming lines. The redesign therefore lowers this issue from the original first-tripwire blocker to a post-tripwire major risk, but does not fully specify it.

## [per-target receipt semantics] (confidence: high)

The revision fixes the whole-set intent and deletes the fatal UUID arm, but “contains” is not yet a complete rule. It does not specify component-safe ancestry versus string-prefix matching, normalization and symlink treatment, equality, a receipt workspace nested beneath a target directory, or missing/non-absolute workspaces. A filesystem workspace cannot meaningfully contain an MCP pseudo-target such as `<mcp__...>`. It also does not explicitly state the mixed-set outcome when one Stop contains covered and uncovered targets or when different receipts cover different subsets. Although even a naïve subset check cannot be quieter than the pristine hook’s accept-any-receipt behavior, these omissions can make F3 incomplete and make the property oracle ambiguous.

## [S3A monotonicity proof] (confidence: high)

The individual S3A changes are correctly bucketed at the design level: the verb table adds detection, D6 is messaging-only, torn-tail handling and D8 add a block/retry signal, D9 rejects receipts, and per-target coverage is a subset of pristine accept-any-receipt behavior. However, F11 only requires byte-identical redirection results over a fixed corpus, so the test obligation does not yet mechanically prove the claimed monotonicity for arbitrary generated commands. Re-poll can also produce a raw block-to-allow transition when legitimate coverage arrives during the polling window; that is safety-justified evidence, but it should be classified rather than silently counted as neutral.

## [terminal gate schema] (confidence: high)

The terminal verdict schema still has no structured `conditions` field even though the acceptance rule says every condition from `accept-with-conditions` must be dispositioned closed. Conditions embedded only in free-form `rationale` cannot be checked mechanically or mapped to evidence, so round-1 F13 is only partially addressed.

## [effective-plan consistency / stale executable acceptance steps] (confidence: high)

DISPOSITIONS-v2.md wins on conflict, but the still-effective base plan retains executable checks and rollback commands for mechanisms v2 deleted: an at-cap downgrade, UUID receipt acceptance, a single `<2 s` re-poll budget, silent background suppression terminology, and the obsolete `/tmp/claude-routing-gate` state path. A worker following PLAN.md’s §4 or rollback literally can test the wrong outcomes or leave the actual `/tmp/claude-routing-gate-<uid>/` state behind for a redeploy.

