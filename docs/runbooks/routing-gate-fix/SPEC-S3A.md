# S3A IMPLEMENTATION SPEC — routing-gate.sh tighten-only change (final, self-contained)

**This document supersedes PLAN.md entirely. Do not read PLAN.md.**

Author: madhyastha (Fable). Status: FINAL. Plan-review loop closed (two rounds + human scope
decision + disposition). No S0(v3); adversarial scrutiny continues at S3A-R and S6.

**Context.** `routing-gate.sh` is a Claude Code Stop hook (bash wrapping heredoc python3, JSON hook
input on stdin, wired with `timeout: 15`). It blocks a session stop when durable writes lack a later
covering worker dispatch or review receipt. It FAILS OPEN by deliberate design. This change is
strictly *tightening*: every behavioural delta must add blocking, add detection, or be message-only
— with exactly one classified exception (§T4). Work in the scratch git repo; the pristine baseline is
the repo's initial commit and must never be modified.

**Skills binding this dispatch:** `test-driven-development` (failing test first for every behaviour
change; S2's characterization tests are already green and may flip only per §Flips),
`verification-before-completion`.

**Prohibited:** any edit to `dispatch_failed` or to the redirection-scanning span of
`bash_write_targets` (both hash-pinned by tests — if a change seems to require touching either, STOP
and report); any persistent state file; any parsing of `last_assistant_message` other than the CH2
staleness comparison (no waiver/carve-out logic — evaluated and cut); any `background_tasks` logic;
any `additionalContext` output; any edit to `settings.json`; any non-stdlib python dependency;
removing or weakening any existing fail-open exit (malformed stdin, non-dict hook input, missing
transcript, `stop_hook_active` short-circuit, interior malformed transcript line,
unreadable/oversized/symlink/non-regular receipt, unparseable receipt JSON).

---

## Changes

### CH1 — torn-tail handling
Replace the single broad try around the transcript loop with per-line parse handling:
- `json.loads` failure on an **interior** non-empty line ⇒ `sys.exit(0)` (unchanged fail-open, data
  corruption).
- Failure on the **final** non-empty line ⇒ set `suspected_stale = True` and continue to the decision
  phase. The torn tail is the expected symptom of transcript lag; today it silently fail-opens the
  entire hook.
All other exception behaviour in the loop is unchanged.

### CH2 — staleness detector + re-poll + stale block
During the transcript pass, retain the concatenated text blocks of the last assistant message seen.
After the pass: if hook-input `last_assistant_message` is a non-empty string and, after whitespace
normalization (collapse all whitespace runs to single spaces, strip), the transcript's last assistant
text does not contain the normalized final 200 characters of it ⇒ `suspected_stale = True`.
Absent/empty/non-string field ⇒ no staleness determination (older harness — behave as today).

If `suspected_stale`: re-poll — up to 5 iterations, sleeping `ROUTING_GATE_POLL_MS` ms each (env
var, default 500, integer, invalid ⇒ default), re-reading and re-parsing the transcript fully each
iteration; exit early when no longer suspected stale.

Decision phase after polling:
- (a) uncovered targets remain after CH5 ⇒ normal block (CH6 message);
- (b) no uncovered targets and not suspected stale ⇒ exit 0;
- (c) still suspected stale after exhaustion — **regardless of coverage** ⇒ stale block (CH6, second
  message).

The detector proves *suspected* staleness only; message wording must say "appears". S2's
transcript-representation probe findings (real transcripts under `~/.claude/projects/`) govern the
text-block extraction details; if the probe showed representation quirks, match them and record how.

### CH3 — writer-verb detection (union-only)
Applies inside `bash_write_targets` **after** the existing `AMBIGUOUS_BASH` bail (ambiguous commands
still return `[]` for the whole command — unchanged) and **alongside** the untouched redirection
scanner, whose results are unioned with verb results.

Segment the command on unquoted `;`, `&&`, `||`, `|`, `&`, and newlines using the same quote-aware
discipline as the existing tokenizer. Per segment: if it begins with `VAR=value` assignments ⇒ `[]`
for that segment; the first word selects the verb. **The entire verb extraction per command is
wrapped in its own try/except returning `[]`** — no exception may reach the transcript loop (a
propagated exception would fail the whole hook open and suppress existing detection).

Grammar table — any construct outside it ⇒ `[]` for that segment:

| Verb | Targets | Arg-taking flags (consume next word) | Bail conditions |
|---|---|---|---|
| `cp`, `mv` | `-t DIR` if present, else last operand | `-t`, `-S`, `--target-directory`, `--suffix` | any unknown `--long` option without `=`; zero or one operand |
| `install` | `-t DIR` if present, else last operand | `-t`, `-m`, `-o`, `-g`, `-S`, `--target-directory`, `--mode`, `--owner`, `--group`, `--suffix` | same |
| `tee` | all operands | none (`-a`, `-i`, `-p` argless) | unknown `--long` without `=` |
| `dd` | `of=PATH` operands only | n/a | none (no `of=` ⇒ `[]`) |
| `rm` | all operands | none | unknown `--long` without `=` |
| `sed` | file operands, **only if `-i` present** (incl. `-i.bak`, `--in-place[=…]`) | `-e`, `-f`, `--expression`, `--file` | no `-e`/`-f` and <2 operands (first operand is the script); any uncertainty |

`--` terminates flag parsing for all verbs. Every extracted target goes through `durable_path`
exactly as redirection targets do.

### CH4 — receipt future-skew bound (D9)
In receipt eligibility add: `completed_at <= now + 300`, where `now = time.time()` captured once at
scan start. Rejecting future-dated receipts only adds blocking.

### CH5 — per-target receipt coverage
Replaces the latest-write-only check and whole-set `exit(0)` (currently lines 387–394).
**Transcript-dispatch semantics are unchanged** (a later successful in-transcript dispatch still
discharges all earlier writes; pseudo- and real targets alike).

The receipt arm becomes per-target:

- Scan both report globs once. A receipt is *eligible* iff: regular file via the existing
  `O_NOFOLLOW`/size/fstat discipline (unchanged), `mode == "review"`, `launcher_status == "ok"`
  (exact string), `completed_at` parses as UTC, `completed_at >= session_started_at`, and
  `completed_at <= now + 300`.
- `COVERS(W, T)`: `W` must be a non-empty absolute string, else the receipt covers nothing.
  Normalize `W` through the same `realpath(normpath(…))` pipeline targets already passed. Reject
  `W == "/"` as degenerate. Then covered iff `T == W or T.startswith(W + os.sep)`. Component-safe by
  the separator suffix; **raw string-prefix matching is forbidden** (`/a/bc` must not match `/a/b`).
  A workspace nested *beneath* a target does **not** cover it. Equality covers.
  **MCP pseudo-targets (`<mcp__…>`) are never receipt-coverable** — only the transcript-dispatch arm
  can cover them (more blocking than pristine — monotonic).
- A target `T` is covered iff **some** eligible receipt has `COVERS(workspace, T)` and its
  `completed_at >` the latest uncovered-write timestamp **of `T` itself** (a write with no parseable
  timestamp is never receipt-coverable — over-block, safe). Different receipts may cover different
  targets.
- Remaining uncovered targets after coverage ⇒ block listing **only** those; all covered ⇒ exit 0
  (unless CH2 case (c) applies).

### CH6 — messages
**Normal block** (formatting may be tidied; every element mandatory):
- header `ROUTING GATE — durable writes with no covering review.`
- count line stating `N uncovered target(s)` with the scope parenthetical
  `(detected: Write/Edit/NotebookEdit/MultiEdit, MCP mutations, shell redirections,
  cp/mv/install/tee/dd/rm/sed -i; heredocs and other shell writes are NOT tracked — the true count
  may be higher)`
- the target list (existing 8-item truncation kept)
- a coverage sentence naming **all three** worker wrappers
  (`codex-wrapper / opencode-wrapper / grok-wrapper` — fixes the current omission) and "a review
  receipt whose workspace contains the target"
- an honest exits paragraph: *"To proceed: dispatch a batched review covering these paths (mode
  review, --resume-from-pointer). If a named carve-out or exemption genuinely applies, state it for
  the completion ledger and stop again — the gate cannot verify statements; the statement is your
  record, not the gate's."*

**Stale block:** `ROUTING GATE — cannot verify this turn: transcript appears stale (final assistant
text not flushed after re-poll). Writes made this turn may be unreviewed. Ensure coverage or state
the carve-out for the ledger before stopping again.`

Both use `decision: "block"`.

### CH7 — header rewrite
Keep limitations #1–#3 verbatim; annotate #3 with the CH5 narrowing (receipts now per-target;
in-transcript dispatches remain target-blind). Add #4 (stale-transcript residual: detector is
*suspected*-staleness only, one-shot signal, `stop_hook_active` passes the next stop) and #5
(torn-tail now treated as staleness evidence, interior corruption still fails open). Append the
WONTFIX section (below, verbatim). Record the D7 decision: `~/.claude/**` deliberately not exempt;
the hook mirrors policy.

---

## Test obligations

- **T1** — S2 characterization suite green, minus explicitly flipped tests. **Flips permitted,
  exhaustively:** torn-tail (fail-open → stale path); cp/mv/install/tee/dd/rm/sed-i corpus
  (invisible → detected); any-receipt-discharges (→ per-target); future-receipt (accepted →
  rejected); whole-set-discharge (→ remainder listed); message-text pins. **Any other flip ⇒
  failure.** Enumerate all flips in `result.json` keyed by change ID.
- **T2** — hash pins: `dispatch_failed` span and redirection-scanner span byte-identical to baseline.
- **T3** — function-level differential fuzz: ≥10,000 generated commands per run (random compositions
  of quoting, redirections, the seven verbs, flag clusters, `--`, unicode, adversarial operands,
  ambiguous constructs). For each: pristine and fixed `bash_write_targets` both run in-process;
  assert (a) no exception escapes the fixed version, (b) fixed targets ⊇ pristine targets.
- **T4** — whole-hook differential property harness against the **pristine baseline binary** (the
  oracle is the old hook itself, not a hand-built corpus). Property: pristine-blocks ⟹ fixed-blocks,
  with exactly **one** allowed exception class, classified in the direction-audit table, not neutral:
  *coverage-arrived-during-re-poll* — pristine (single read) blocks, fixed allows because covering
  evidence became visible during the ≤2.5 s poll window. The harness asserts any observed block→allow
  carries that evidence (a cover event timestamped inside the poll window). Includes one deterministic
  mid-poll transcript-swap test via the `ROUTING_GATE_POLL_MS` seam.
- **T5** — per-target COVERS unit matrix: ancestry vs prefix (`/a/bc` vs `/a/b`), equality,
  nested-beneath, `/` rejection, missing/relative/non-string workspace, symlinked workspace,
  pseudo-target non-coverage, mixed-set with disjoint receipt subsets, per-target timestamp (receipt
  postdates T1's write but not T2's).
- **T6** — perf: steady-state < 1 s over ≥500 fixture run dirs (via the glob seam); worst-case ≤5
  polls < 5 s.
- **T7** — fail-open preservation suite (every enumerated exit).
- **T8** — direction-audit table emitted in `result.json`: every delta labeled noisier/message-only,
  plus the single classified quieter row.

**Fixtures must never be created under the real `/tmp/{codex,opencode}-wrapper/`** — a fresh
ok-review fixture there discharges real concurrent sessions' gates. Use
`ROUTING_GATE_REPORT_GLOB_ROOTS`.

## Acceptance (station gate)

All of T1–T8 green under an independent chair re-run; `bash -n` clean; no diff outside
`routing-gate.sh` and `tests/`; flips list exact; direction-audit table present and correctly
classified.

Downstream (not this worker's job, listed for graph completeness): S3A-R two-voice review; S5 deploy
= byte-verified copy of hook + `tests/` to `~/.claude/hooks/` after backup verification; S6 live-fire
= unreviewed Write blocks with the CH6 message; a `cp` write blocks; a non-matching-workspace fixture
receipt (workspace `/tmp/routing-gate-live-check-nonexistent`) does not discharge; a matching-
workspace receipt does; a future-dated receipt does not; then cold-madhyastha verdict under the
Resolution-4 schema. Rollback: restore `~/.claude/hooks/routing-gate.sh.pre-fix-2026-07-21` by copy,
`cmp` verify, one block-fixture smoke; **no state cleanup exists.**

---

## WONTFIX (verbatim, for the hook header and the completion claim)

> **Not fixed, deliberately (2026-07-21; S3B dropped by human decision after two plan-review
> rounds).** D1/D2 stand: the gate still cannot verify a stated carve-out or exemption, and the same
> uncovered write re-blocks once per turn until genuinely covered. Every design that honored
> statements or capped repeat blocks required the hook to trust a durable record that a block had
> already occurred — and the only storage within a Stop hook's reach is writable by the same model
> the gate watches. A strict-valid forged `{blocked, waived}` record would silence the tripwire
> before it ever fired (S0-v2 finding R2-B2). We keep the noise rather than ship a quietable gate.
> Also unfixed: in-transcript dispatches remain target-blind (a junk dispatch still discharges
> everything — D5 residual); stops with work in flight still hard-block (any deferral that can repeat
> is a standing bypass — R2-B3); receipts remain unauthenticated launcher files — per-target scoping
> and the future-skew bound narrow forgery, they do not close it.

## Recorded for S3B's successor — transcript-derived "was blocked"

Plausible, and the most promising direction, with two empirical gates before anyone designs on it.
The transcript is harness-written and is the one record the hook already trusts for everything else;
the docs say Stop-hook feedback is "shown in the transcript", so if block events land there as
parseable records, "generation G of path P was visibly blocked" becomes *derivable* rather than
*stored*, the `/tmp` state store disappears, and R2-B2's objection dissolves — forging the evidence
would require writing into `~/.claude/projects/…`, itself a gate-visible durable write leaving a
reviewable trace in the very artifact reviews read. It would also cure R2-B1 for free, since
generation identity would be recomputed from transcript sequence order each run rather than compared
against a stored timestamp.

**The gates:** (1) confirm empirically that block events appear in the transcript JSONL in a stable,
parseable form across harness versions, not merely in the UI; (2) confirm flush timing makes a turn-N
block visible to the turn-N+1 Stop despite the D8 lag this very change documents — a block record
that lags its own next Stop reintroduces the problem as a race. If either fails, the honest
conclusion is that D1/D2 are not fixable at the hook layer and belong in the harness (a native
block-count or hook-state channel), which is a feature request, not a hook design.
