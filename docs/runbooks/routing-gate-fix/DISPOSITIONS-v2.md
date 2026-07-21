# PLAN v2 — dispositions of the S0 findings, and the redesigned mechanism

Author: madhyastha (Fable), same standing seat that authored `PLAN.md`.
Status: awaiting re-review. **The effective plan is `PLAN.md` AS AMENDED BY THIS DOCUMENT.**
Where the two conflict, this document wins.

Planner's own headline: *"this is a material revision — v2 changes the D1/D2/D4/D5 mechanism
design, not just parameters."* Three findings broke load-bearing parts of v1 reasoning, stated
plainly by the author: the D1 justification was wrong (it conflated enforcement with visibility —
there **is** a guarantee in the current hook, namely one visible block per uncovered stop, and the
v1 design deleted it), the D2 cap created a lifetime path waiver, and D4 clause (iii) was
attributable-in-name-only.

The planner re-verified three load-bearing source claims before dispositioning: the whole-set
discharge at `:392-394` is real; the receipt window at `:304-307` genuinely has no upper bound; the
one-broad-`try` transcript loop at `:337-386` fails the entire hook open on any malformed line,
including a torn tail. *"The reviewer read the source correctly everywhere I checked."*

---

## Dispositions — all 13, severity assigned by the planner

**F1 — D1 first-stop silence. ACCEPTED, blocker.** Redesign below; the waiver never silences a
first block. Fenced-code false-fire also accepted: strip fenced blocks before matching. Consequence
of a false parse is now only a spurious audit entry plus earlier downgrade, never a silent discharge.

**F2 — D2 permanent session exemption. ACCEPTED, blocker.** A path-lifetime cap is a lifetime waiver
for future mutations. The numeric cap is replaced entirely with generation-keyed state.

**F3 — D4 whole-set discharge + UUID arm. ACCEPTED, blocker / major.** Per-target coverage is
mandatory — one receipt discharges only the targets its workspace contains. Clause (iii) **deleted**.
The "D5 lands by construction" claim is **withdrawn** and rewritten honestly: a junk same-session
scratch review no longer discharges anything; a junk review *of the target's own tree*, and a junk
in-transcript dispatch, still would — pre-existing coarseness, explicitly out of scope, recorded in
the header.

**F4 — state storage hardening. ACCEPTED, major.** Spec for the S3B brief: state dir
`/tmp/claude-routing-gate-<uid>/` mode 0700; ownership/symlink/mode verified every run (any anomaly →
treat as no-state); `session_id` sanitized to `[A-Za-z0-9_-]{1,128}` else no-state; atomic
`os.replace` writes; `O_NOFOLLOW` reads; 256 KB size cap; strict schema validation (anything
unexpected → no-state); bounded GC of files older than 7 days. "No-state" is uniformly safe under v2:
no state → no waiver effect → *more* blocking. Audit claim corrected: **a waiver whose audit write
fails has no mechanical effect** — the record *is* the effect. Residual accepted honestly: the model
can forge state via Bash (invisible under the `/tmp` exclusion); that gains nothing over stating a
dishonest waiver post-block, which is audited. Tripwire, not wall, per the hook's own charter.

**F5 — background_tasks broad bypass. ACCEPTED-WITH-MODIFICATION, major.** Unconditional exit-0
suppression is a repeatable silent bypass (start any background task, stop silently forever). But
reverting to hard-block restores the observed nuisance. **v2: no silent suppression anywhere.** When
uncovered writes exist and either (a) a *pending in-transcript dispatch to a WORKER_AGENT invoked
after the latest uncovered write* exists — a structured, non-prose, in-band signal meaning the
covering review is provably in flight — or (b) `background_tasks` is present and non-empty, the hook
emits `additionalContext` ("gate deferred; uncovered: […]; re-gates at final stop") **instead of**
`decision: block`. Feedback is visible in the transcript; nothing is silent; a hung or failed task
means the next stop hard-blocks because no discharge ever arrives. Malformed `background_tasks` →
treated as absent → hard block (ambiguity resolved toward current behaviour). D8 staleness is
evaluated **before** this arm, and the deferral message states suspected staleness when present.
S6 gains an explicit re-gate check.

**F6 — D8 detector + perf conflict. ACCEPTED, major.** Four sub-points, all taken:
(1) the detector proves **suspected** staleness only — wording, header note and message text all say
"suspected"; S2 gains a characterization probe of real transcript representation using actual
transcripts under `~/.claude/projects/` **before** the detector is designed.
(2) **The torn-tail hole is a genuine latent bug** and lands in the monotonic station: per-line parse
handling where a malformed **final** line becomes staleness evidence and triggers the re-poll, while
a malformed **interior** line keeps today's fail-open. The planner calls this *"the strongest single
catch in the review — the most likely symptom of the exact lag D8 worries about currently fail-opens
the whole hook."*
(3) Block-once remains a signal, not a guarantee — stated.
(4) **The perf arithmetic error was the planner's.** Budgets now split: steady-state (no staleness)
< 1 s over >=500 run dirs; worst-case including full re-poll (<=5 polls, <=2.5 s sleep total) < 5 s.
Both against `timeout: 15`. Two perf tests, not one.

**F7 — under-block proof incompleteness. ACCEPTED, major.** The v2 redesign makes a real invariant
statable, and it becomes the plan's central acceptance artifact — the **monotone visibility
invariant**:

> For every `(path, generation)` that would produce a hard block under the pristine hook, the fixed
> hook emits **at least one hard block**, unless the evidence contains exactly one of: a
> per-target-matching receipt, a successful covering dispatch, or a logged waiver for that
> generation that **postdates a visible block**.

Enforced three ways: the differential corpus (kept, **demoted to "necessary not sufficient"**);
**multi-invocation sequence tests** driving the hook repeatedly over evolving transcript+state and
asserting the full emission sequence — the reviewer's four named omitted states (post-cap new write,
quoted waiver, stale+background, same-session-other-target receipt) each become a named sequence
test; and a **property-based fuzz layer** generating random event sequences and checking the
invariant against a reference predicate, so **the oracle is the invariant, not the old hook**.

**F8 — "only ok discharges" inaccuracy + dispatch_failed gate. ACCEPTED, major.** The claim was wrong
as a universal, and the correction carries a nuance worth pinning: the **receipt** arm requires
literal `"ok"` (strict), while the **transcript-dispatch** arm fail-opens on missing/non-string
`launcher_status` per the documented blind spot at `:125-128`. Characterization pins both separately,
with direction labels. The textual prohibition on `dispatch_failed` is upgraded to a **mechanical
no-change gate**: a test slices the `def dispatch_failed` span from the hook source and asserts its
hash equals a pinned baseline. Any legitimate future change must consciously update the pin.

**F9 — global receipt coupling / S0 ∥ S1. ACCEPTED-WITH-MODIFICATION, minor severity but the graph
changes.** **S1 now runs strictly after S0 disposition** — the overlap saved two minutes and created
exactly the coincidental-discharge coupling the plan itself flags. The ambient coarseness of any
review receipt landing during the work-stream cannot be eliminated until S5 deploys the fix; it is
recorded as a known operating condition, and the completion ledger cites station reviews as the real
coverage evidence, **never coincidental gate discharges**. S4 is scheduled so its review receipt
lands inside the S3 execution window, when the chair makes no durable writes.

**F10 — split S3. ACCEPTED-WITH-MODIFICATION, major.** The interlock argument dissolved under the v2
redesign — the mechanisms now partition cleanly along the safety axis. Split into **two** stations,
not four:
- **S3A "tighten"** — strictly monotonic-or-neutral changes: D3 verb table + F11 isolation, D6
  message, D8 detector/re-poll/torn-tail, D9 upper bound, F3 per-target receipt coverage + arm
  deletion.
- **S3B "terminate"** — the justified-quieting changes: F1/F2 generation-keyed waiver machinery +
  F4-hardened state store, F5 downgrade arms.
Each gets its own review gate; S3B's review anchors entirely on the under-block surface with S3A
frozen green beneath it; **S3A alone is a shippable strictly-safer intermediate if S3B stalls.**
Four stations would buy little beyond the monotonic/quieting cut at the cost of two more review
rounds — the cut is the safety boundary, so the split follows the cut and stops there.

**F11 — D3 fail-open regression. ACCEPTED, major.** Confirmed against source. Two mandatory
mechanical guarantees: per-command `try/except` returning `[]` around the verb extractor (bail-to-
empty = today's behaviour = monotonic), plus a fuzz test asserting no exception escapes and that
redirection-corpus results are identical with the extractor enabled vs disabled. Per-verb operand
grammar pinned in the S3A brief: cp/mv/install → last operand or `-t` argument, `--` handled, unknown
long-opts-with-args → bail; tee → all non-flag operands; dd → `of=` only; rm → operands post-flags;
sed → `-i` forms only; **any uncertainty → `[]`**.

**F12 — D9 forged-future receipts. ACCEPTED (part 1, lands now), major; authenticity deferred.**
**D9 lands in this change**, in S3A — a three-line bounded-skew check (`completed_at <= now + 300 s`),
failure direction pure over-block. Deferring a known persistent-coverage hole out of a change already
touching `review_receipt_covers` would be indefensible. Receipt **authenticity** (signing, launcher
provenance) is deferred: launcher-side surgery, shared infrastructure, confirm-before-change —
recorded as a follow-up beside per-target launcher receipts. The plan drops any language implying
file presence proves a review happened; it is a tripwire the launcher makes expensive to fake
accidentally, **not authentication**.

**F13 — S6(b) non-mechanical gate. ACCEPTED, minor.** The cold-madhyastha station gets a defined
contract: input set pinned by sha256 (deployed hook, harness tree, PLAN v2, findings + dispositions,
direction-audit table, live-fire outputs); required verdict schema
`{verdict: accept | reject | accept-with-conditions, blockers[], rationale}`; any blocker → immediate
§5 revert of the deployment, finding enters the disposition loop before any redeploy; chair accepts
iff verdict is `accept` or every condition is dispositioned closed.

---

## The redesigned mechanism (replaces v1's D1/D2 design wholesale)

One invariant anchors it: **every `(path, generation)` gets at least one hard, visible block before
anything can quiet it.**

- A **generation** is the latest uncovered write timestamp for a path. A newer write than the stored
  generation **re-arms the path completely** (F2 fixed).
- State per path: `{gen_ts, blocked_shown, waiver_logged}`.
- The waiver marker — `ROUTING-GATE-WAIVER: <target> — <reason>`, fenced code stripped before
  matching, `<target>` being the normalized path **or** the exact `<mcp__…>` pseudo-target (wording
  fixed per F13's cousin in the D6 finding) — **never discharges a first block**. Pre-emptive waivers
  are logged but the generation still blocks once.
- After a generation has blocked, a validly stated **and successfully audited** waiver quiets that
  generation, silently thereafter — justified because the visible block already happened and the
  auditable record exists.
- **The numeric cap is gone.** Termination is always explicit (waiver) or real (coverage).

This maps onto the policy's two-round cap naturally: rounds are bounded by the model stating the
debt, which is exactly what the policy's cap-then-log-debt rule demands, now with a record. The D2
correction loop terminates in at most: block → review round(s) → block → stated waiver → silence,
with every step evidenced.

D6's message rewrite also corrects the `grok-wrapper` omission (`:401` vs `:73`) and states the count
as "unique detected targets", scope enumerated.

## Re-answers to the two flagged-for-attack questions

**D4 clause (iii): the reviewer wins — deleted.** UUID-substring is affiliation, not attribution; the
chosen-path counterexamples are fatal. What made deletion affordable is the v2 waiver design: the
legitimate scratch-copy-review flow it protected now has an honest exit — the gate blocks once, the
chair states the waiver naming the deployment path and citing the scratch-review run dirs, and the
record is audited. **This work item's own S5 deployment will exercise exactly that flow, by design.**
Remaining arms: receipt workspace contains the target, per-target.

**D8 stale-block: recommendation held, reframed as required.** The detector proves *suspected*
staleness; S2 characterizes real transcript representation before the detector is built; the
torn-tail case folds in as staleness evidence rather than fail-open; block-once-after-re-poll stands
because it is noisier-and-safe and the alternative is silent, with the `additionalContext` fallback
dial documented for the case where real-harness lag proves routine. The perf conflict was a genuine
arithmetic error; budgets now split and both mechanically tested.

## Graph deltas (everything else in PLAN.md stands)

- **S0(v2)** — re-run sol review against the amended plan. Mandatory; the design changed materially.
  Nothing overlaps it.
- **S1** — strictly after S0(v2) disposition (F9).
- **S2** — unchanged in position; brief gains: transcript-representation probe, sequence-test + fuzz
  harness scaffolding, receipt-arm vs dispatch-arm `launcher_status` pinning, `dispatch_failed` hash
  pin, split perf tests.
- **S3A (tighten) → S3A-R → S3B (terminate) → S3B-R** — replacing S3/S3R. Same lanes (sol implements;
  chair + `adversarial-analyst` review, family-disjoint, the two voices parallel per review). S3B's
  review anchors on the under-block surface and the monotone visibility invariant explicitly.
- **S4** — scheduled inside the S3 window; chair makes no durable writes while its receipt is in
  flight.
- **S5, S6** — as before, plus F13's mechanical terminal-gate contract, plus S6 live-fire additions:
  re-gate-after-wake check, pre-emptive-waiver-still-blocks check, generation-re-arm check.

The invariant, the sequence tests, and the direction-audit table together are the answer to "prove it
does not under-block" — necessary-plus-sufficient in structure rather than corpus-luck.
