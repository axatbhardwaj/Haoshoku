# routing-gate.sh fix — state at close (2026-07-21)

**Nothing is deployed.** The live hook `~/.claude/hooks/routing-gate.sh` is byte-identical to its
backup (`sha256 67eae333…`). The gate behaves exactly as it did before this work started.

The finished, tested change sits in a scratch git repo, one station short of deployment.

## Where the work lives

`/tmp/claude-1000/-home-xzat-defi/f4f7bc52-7f34-4504-a969-d418e5451d66/scratchpad/routing-gate-fix`

**⚠ This is tmpfs — it does not survive a reboot.** If it matters, copy it somewhere durable:

```
cp -r /tmp/claude-1000/-home-xzat-defi/f4f7bc52-7f34-4504-a969-d418e5451d66/scratchpad/routing-gate-fix ~/routing-gate-fix
```

Git history in that repo (each station is a commit):

```
aa60e1d  feat(S3A): tighten-only routing-gate changes CH1-CH7 with 78-test suite
0935289  test: characterization harness pinning current behaviour (46 tests)
49845ec  test(seam): env-var override for report glob roots, production defaults preserved
873b644  docs: final S3A spec; supersede PLAN.md
37cf7f9  docs: freeze S0(v2) round-2 findings
8e7100b  docs: PLAN v2 — dispositions of all 13 S0 findings
51d82e6  docs: freeze S0 plan-review findings
b3dc515  docs: freeze plan + defect report for S0 review
93e7372  baseline: pristine routing-gate.sh    <-- the behavioural oracle
```

Key files: `SPEC-S3A.md` (the specification — self-contained, supersedes `PLAN.md`),
`routing-gate.sh` (the fixed hook), `tests/` (78 tests), `S0-FINDINGS.md` / `S0v2-FINDINGS.md`
(two rounds of plan review), `DISPOSITIONS-v2.md`.

## What the change does — all strictly tightening

| ID | Change | Direction |
|----|--------|-----------|
| CH1 | Torn final JSONL line becomes staleness evidence instead of failing the whole hook open | noisier |
| CH2 | Suspected-staleness detector + bounded re-poll + stale block | noisier |
| CH3 | Writer-verb detection: `cp` `mv` `install` `tee` `dd` `rm` `sed -i` | more detection |
| CH4 | Receipt future-skew bound (`completed_at <= now + 300s`) | more blocking |
| CH5 | Per-target receipt coverage, replacing whole-set discharge | more blocking |
| CH6 | Honest scope message; adds the missing `grok-wrapper` | message-only |
| CH7 | Header rewrite: limitations #4/#5, D7 decision, WONTFIX section | docs |

Verified by the chair, independently: 78 tests green (11.6 s), `bash -n` clean, both source hash
pins intact (`dispatch_failed` and the redirection scanner unchanged), and a behavioural probe via
`tests.harness.load_bash_write_targets` confirming `cp`/`rm`/`mv`/`tee`/`dd`/`sed -i` now resolve
targets while `sed` without `-i`, heredocs, and `/tmp` paths correctly do not.

## Remaining stations before it can ship

1. **S3A-R** — two-voice adversarial review: chair deep review anchored to the diff + spec + a
   system-state pass over the whole file, and a Claude-native `adversarial-analyst` running attack
   hypotheses. **Not started.**
   Also outstanding from S3A's own acceptance: the **direction-audit table** and the **flip list**
   were required as top-level `result.json` fields and are not present as such
   (`/tmp/codex-wrapper/run-wQRyrGCZ/result.json` has `findings`/`verification` instead).
   Confirm every characterization flip is on the permitted list before accepting.
2. **S5** — deploy: byte-verified copy of `routing-gate.sh` + `tests/` into `~/.claude/hooks/`.
3. **S6** — live-fire (unreviewed write blocks; a `cp` write blocks; non-matching-workspace receipt
   does not discharge; matching one does; future-dated one does not) then a **cold madhyastha**
   verdict — a fresh spawn, since the standing planner is anchored to its own design.

## Deploy command, when the reviews pass

```
W=.../scratchpad/routing-gate-fix      # or ~/routing-gate-fix if copied
cp "$W/routing-gate.sh" ~/.claude/hooks/routing-gate.sh
mkdir -p ~/.claude/hooks/tests/routing-gate && cp -r "$W/tests/." ~/.claude/hooks/tests/routing-gate/
bash -n ~/.claude/hooks/routing-gate.sh
```

`~/.claude/settings.json` needs no change — the path and `timeout: 15` are unchanged by design.

## Rollback

```
cp -p ~/.claude/hooks/routing-gate.sh.pre-fix-2026-07-21 ~/.claude/hooks/routing-gate.sh
cmp ~/.claude/hooks/routing-gate.sh ~/.claude/hooks/routing-gate.sh.pre-fix-2026-07-21
```

Under a minute, no restart needed (the hook re-executes per stop). No state directory exists to
clean up — dropping S3B removed the need for persistent state entirely.

## What is deliberately NOT fixed

D1/D2 — the gate still cannot verify a stated carve-out, and the same uncovered write re-blocks once
per turn until genuinely covered.

**Why:** every design that honoured statements or capped repeat blocks needed the hook to trust a
durable record that a block had already occurred. The only storage within a Stop hook's reach is
`/tmp`, which `durable_path` excludes — so it is writable by the same model the gate watches, and
invisible to the gate. A strict-valid forged `{blocked, waived}` record would silence the tripwire
before it ever fired (S0-v2 finding **R2-B2**). Filesystem hardening cannot close this: it separates
*corrupted* state from *hook-written* state, never *forged* same-UID state from hook-written state.

Keeping the noise beat shipping a quietable gate.

**Possible future direction** (recorded, not designed): derive "was blocked" from the **transcript**,
which the harness writes, rather than from model-writable state. Two empirical gates first —
(1) do block events actually land in the transcript JSONL in stable parseable form, not just the UI;
(2) does flush timing make a turn-N block visible to the turn-N+1 Stop, given the very transcript lag
this change documents. If either fails, D1/D2 are not fixable at the hook layer and belong in the
harness as a feature request.

## Also unfixed, recorded honestly

- In-transcript dispatches remain target-blind — a junk dispatch still discharges everything (D5).
- Stops with work in flight still hard-block (any deferral that can repeat is a standing bypass).
- Receipts remain unauthenticated launcher files; per-target scoping and the skew bound narrow
  forgery, they do not close it.
