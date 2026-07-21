# routing-gate.sh — S3A tighten-only fix

**Status: MERGED and RELEASED in v5.13.0; harness digest guard in v5.13.1.**
Merged on explicit human instruction with review debt outstanding — see below.

`configs/claude/hooks/` is a `MANAGED_DIR`, so the new hook and its test suite install into
`~/.claude/hooks/` on the next Haoshoku apply. Until you run one, the live gate is still the
pre-fix version.

## Status

Implemented, tested (78 tests), merged, released. **The adversarial cross-review (S3A-R), live-fire
verification, and cold-madhyastha acceptance never ran** — this shipped with that debt recorded
rather than discharged. The harness itself was reviewed twice post-release
(`run-WFBFnUIU`, `run-cD14IjWz`); the hook's own S3A changes were not.

| Station | State |
|---|---|
| S0 / S0v2 — plan review (sol, 2 rounds) | done — 13 findings then 3 blockers, all dispositioned |
| S1 — backup + scratch repo | done |
| S2 / S2R — characterization harness (46 tests) | done, chair-verified |
| S3A — tighten-only implementation (78 tests) | done, chair-verified |
| **S3A-R — adversarial cross-review** | **not started** |
| S5 — deploy | not started (this merge is the deploy) |
| S6 — live-fire + cold madhyastha | not started |

Also outstanding: S3A's `result.json` was required to carry a top-level direction-audit table and
flip list; it does not. Confirm every characterization-test flip is on the permitted list before
merging (permitted: torn-tail, writer-verb corpus, any-receipt-discharges, future-receipt,
whole-set-discharge, block-message pins).

## What changed

CH1 torn final JSONL line → staleness evidence instead of failing the whole hook open ·
CH2 suspected-staleness detector + bounded re-poll + stale block ·
CH3 writer-verb detection (`cp` `mv` `install` `tee` `dd` `rm` `sed -i`) ·
CH4 receipt future-skew bound · CH5 per-target receipt coverage · CH6 honest scope message
(+ the missing `grok-wrapper`) · CH7 header rewrite.

Every change is monotonic — the gate gets strictly noisier or detects more. Never quieter.

## Verify before merging

```bash
cd configs/claude/hooks && python3 -m unittest discover -s tests -t .
bash -n routing-gate.sh
```

78 tests, ~12s. The suite includes hash pins on `dispatch_failed` and the redirection scanner —
if either fails, something touched code that was explicitly out of scope.

## Rollback

The pristine hook is in this repo's history at `f0125cb`:

```bash
git checkout f0125cb -- configs/claude/hooks/routing-gate.sh
```

A machine-local copy also exists at `~/.claude/hooks/routing-gate.sh.pre-fix-2026-07-21`.

## Deliberately not fixed

D1/D2 — the gate cannot verify a stated carve-out, and an uncovered write re-blocks once per turn.
Every design that fixed this needed the hook to trust a durable record that a block had occurred,
and the only storage in a Stop hook's reach (`/tmp`) is excluded by `durable_path` — so it is
writable by the model being watched and invisible to the gate. A forged `{blocked, waived}` record
would silence the tripwire before it fired (finding R2-B2 in `S0v2-FINDINGS.md`). Keeping the noise
beat shipping a quietable gate.

Possible future direction, recorded in `SPEC-S3A.md`: derive "was blocked" from the transcript,
which the harness writes, rather than from model-writable state.

## Files here

`SPEC-S3A.md` — the implementation spec (self-contained; supersedes `PLAN.md`) ·
`PLAN.md` — original plan, superseded, kept for the audit trail ·
`DISPOSITIONS-v2.md` — dispositions of all 13 round-1 findings + the redesign ·
`S0-FINDINGS.md`, `S0v2-FINDINGS.md` — the two plan-review rounds ·
`RESEARCH-BRIEF.md` — Stop-hook contract, from current docs ·
`STATE.md` — resume note · `defect-report.html` — the 7-defect report that started this.
