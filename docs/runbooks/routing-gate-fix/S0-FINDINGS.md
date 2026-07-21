# S0 PLAN REVIEW FINDINGS — verdict: PLAN_NEEDS_REVISION

Reviewer: gpt-5.6-sol, read-only, run-KeWIAaFX. Session id 019f83bd-7001-7080-81cc-8f64180c84ac.
Contract deviation: reviewer returned category/confidence instead of the requested severity field.
All 13 findings are confidence=high. Severity assignment is part of disposition.

## [D1 security surface / unintended first-stop silence] (confidence: high)

The source confirms that `stop_hook_active` exits unconditionally at routing-gate.sh:67-68, but only after a first non-active stop reaches lines 387-409 and emits a visible block. Honoring a waiver in the initial `last_assistant_message` removes that one tripwire and therefore is strictly quieter than the current hook. A multiline `^` anchor does not establish intent: a fenced code block can contain a raw line beginning with the token, and documentation about the hook is especially likely to reproduce both the syntax and the live path. Logging the marker in a model-writable state file is not equivalent to the current user-visible hook error, particularly if state-write failures are swallowed.

## [D2 state semantics / permanent session exemption] (confidence: high)

As specified, the count is keyed only by normalized path and session, not by the write that caused the block. After path P reaches two blocks for write W1, a later successful write W2 to P inherits the at-cap state and is downgraded or silently allowed even though the current hook would treat W2 as a new uncovered write at routing-gate.sh:387-409. A two-round correction cap is not a lifetime waiver for every future mutation of the file.

## [D4 attribution / cross-target receipt acceptance] (confidence: high)

A UUID substring establishes, at most, loose session affiliation; it does not establish what was reviewed. It accepts chosen paths such as `/tmp/other/<uuid>-foreign/review`, any longer component containing the UUID, and an unrelated review run anywhere under the same session scratchpad. The current source makes this more consequential: routing-gate.sh:392-394 checks one receipt against only the latest uncovered write and then exits 0 for the entire uncovered set, so a receipt attributable to one target can clear other targets unless the implementation is explicitly changed to per-target coverage. Thus D5 does not land by construction: an arbitrary successful review in a same-session scratch workspace remains a cheap discharge. Rejecting receipts with no `workspace` is safe and should remain.

## [D2 state storage / concurrency, poisoning, and filesystem safety] (confidence: high)

The plan does not specify validation, ownership, locking, no-follow behavior, atomic replacement, size limits, or garbage collection. An unvalidated `session_id` can escape the intended filename; a pre-created directory or state-file symlink can redirect naïve writes; overlapping hooks can lose increments or audit entries; and one file per session plus append-only waiver records grows without bound until reboot. Treating corrupt state as zero is safe against under-blocking but can defeat D2 termination indefinitely, while a syntactically valid poisoned high count causes immediate under-blocking. Because `/tmp/**` is excluded by routing-gate.sh:96-99, model-authored writes to this state are themselves invisible to the gate. Swallowing writes also makes the claim that every honored waiver is audited false if the hook allows after the audit write fails.

## [background_tasks suppression / broad bypass and ordering] (confidence: high)

This makes the fixed hook silent whenever any background task is present, even if that task is unrelated, failed, hung, or deliberately started to postpone the gate, while the current hook would still block at routing-gate.sh:390-409. The plan assumes every such stop is merely a pause and that a later wake will produce another Stop with an empty list, but S6 only checks suppression, not the later re-evaluation. If the task never wakes or the session is closed, the uncovered write is never surfaced. The rule is also ambiguous because “present and non-empty” conflicts with “malformed behaves as today,” and suppression performed before D8 would silence a provably/suspected stale transcript.

## [D8 mitigation / unsound detector and incompatible performance gate] (confidence: high)

A text mismatch is evidence of suspected staleness, not proof, until actual transcript representation is characterized. Formatting, truncation, redaction, or content-block joining can create false mismatches, while containment can miss staleness when a short/repeated final message such as “Done” appeared earlier. There is another uncovered path: a partially written trailing JSONL record raises at routing-gate.sh:342 and exits 0 through lines 385-386 before a post-parse comparison can run. Blocking once is directionally safer than silent allow when the mismatch is genuine because it at least emits a signal, and the unconditional active-stop pass prevents a same-cycle trap; however, it does not guarantee re-evaluation or review because the next stop still allows. The four observed blocks do not prove freshness for all final-tool-call shapes. Finally, “re-poll up to ~2 s” conflicts mechanically with PLAN.md:214’s total runtime requirement of `< 2 s` including the worst-case re-poll.

## [verification / incomplete under-block proof] (confidence: high)

This is a differential check over a corpus whose completeness is unknown, not a proof of absence of unintended under-blocking. RESEARCH-BRIEF.md:97-98 states that no tests exist, so S2 will create both the corpus and the oracle from scratch. A new block-to-allow transition in an omitted state—such as a newer write after the path cap, a quoted waiver, a stale transcript plus background task, or a same-session receipt for another target—will not appear as an unexplained flip. Single-invocation tests are especially inadequate for the new persistent state machine.

## [source accuracy / untouchable dispatch logic] (confidence: high)

The seven named non-`ok` launcher-status strings are correctly rejected: routing-gate.sh:217 defines `OK_LAUNCHER_STATUS={"ok"}`, and lines 229-231 reject any string outside it. But “only ok discharges” is not universally true because a missing, null, numeric, or otherwise non-string `launcher_status` is not rejected; unrecognized payloads return false from `dispatch_failed` and therefore count as successful dispatches at lines 380-382, exactly as the documented blind spot at lines 125-128 says. `NON_SUCCESS_STATUS` at line 211 is a separate generic-status set: failed, blocked, partial, cancelled, canceled, timeout, and error. A textual prohibition on touching `dispatch_failed` is also weaker than a mechanical no-change gate, and a seven-status sweep alone would not detect all recursion changes.

## [station graph / hidden global receipt coupling] (confidence: high)

The review lanes are not side-effect-free even when their code workspaces are independent: S0 and S4’s Codex review create `mode=review`, `launcher_status=ok` receipts under globally scanned roots. The current hook scans `/tmp/codex-wrapper/run-*/report.json` and `/tmp/opencode-wrapper/run-*/report.json` at routing-gate.sh:218-220 and accepts by status and timestamp alone at 302-307. If S1’s durable backup write occurs before an overlapping S0 or S4 review receipt completes, that unrelated receipt can discharge the backup at lines 392-394. The plan itself recognizes the same global side effect at PLAN.md:132-134 for test fixtures. S2→S3 is correctly serial and output-coupled; the two read-only S3R voices are genuinely parallel-safe with respect to the reviewed source.

## [scope / too many security-relevant mechanisms in one implementation station] (confidence: high)

S3 combines a new shell-command detector, a waiver parser, a persistent counter/audit store, receipt-attribution logic, stale-transcript polling, and background-task suppression. Three of those deliberately create quieter outcomes, and there are no pre-existing tests. A single final green suite cannot isolate which mechanism introduced an unexpected allow, while the interactions among state, stale data, active stops, background tasks, and receipts are the highest-risk part of the work. The existing S2/S2R separation is good but does not reduce the behavioral blast radius inside S3.

## [D3 parser design / possible whole-hook fail-open regression] (confidence: high)

That direction claim is not guaranteed by the proposed implementation constraints. The current transcript loop wraps classification in one broad exception handler; any exception from a new writer-verb extractor propagating through `classify_tool` reaches routing-gate.sh:385-386 and exits 0, potentially suppressing a block that the existing redirection detector would have produced. “Unknown flag shapes yield no targets” is a desired property, not yet a mechanically enforced one. The seven commands also have materially different operand grammars—such as `cp -t`, `install -t`, multiple `tee` outputs, `dd of=`, `rm --`, and `sed -i[SUFFIX]`—so “known target-argument positions” is underspecified.

## [receipt trust and time window / persistent forged-future coverage] (confidence: high)

The current receipt window has only lower bounds: routing-gate.sh:304-307 requires `completed_at > write_timestamp` and `>= session_start`, but never requires `completed_at <= hook-now` or a bounded future skew. A regular JSON receipt with a far-future completion time can remain eligible for later writes until wall time catches it. The scan’s `O_NOFOLLOW`, regular-file, and size checks protect file reading but do not authenticate the producer. PLAN.md:132-134 explicitly acknowledges that a fabricated fresh fixture under the real glob could discharge concurrent sessions, and S6 itself proposes constructing a real-shaped receipt, so the plan cannot simultaneously treat file presence as proof that the launcher actually performed review. Workspace/session matching narrows attribution but does not establish authenticity or content.

## [D6 messaging / remaining source-scope mismatch] (confidence: high)

The current output says there was no later Codex/OpenCode dispatch at routing-gate.sh:401, but `WORKER_AGENTS` also recognizes `grok-wrapper` at line 73. The plan does not explicitly correct that mismatch. The reported number is a count of unique normalized detected targets, not tool calls or writes, and detection also includes MCP mutation-name heuristics and pseudo-targets. The proposed marker syntax says `<abs-path>` while separately allowing non-path `<mcp__...>` targets.

## [station acceptance / non-mechanical terminal gate] (confidence: high)

Most station acceptance conditions are mechanically checkable, but S6(b)’s final condition is an unconstrained judgment rather than an executable acceptance test. A cold reviewer is useful, yet “accepted by chair” and “ledger assembled” do not define required verdict fields, evidence, artifact hashes, or what happens when the reviewer identifies a new blocker. This makes the terminal gate weaker than S2R/S3R’s explicit findings-and-disposition requirements.

