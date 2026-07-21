# Research brief — Claude Code Stop hook contract (for the routing-gate fix)

Source: `https://code.claude.com/docs/en/hooks` fetched as `.md` (236 KB) on 2026-07-21.
Retrieved via `curl` after the Claude subagent lane and WebFetch both returned 529 twice —
substitution stated. Facts below are quoted/derived from that document; empirical items are
labelled as such.

---

## The finding that changes the fix design

**Stop hooks receive `last_assistant_message`.** Quoted: *"The `last_assistant_message` field
contains the text content of Claude's final response, so hooks can access it without parsing the
transcript file."*

This means **D1 does not need a waiver file.** The hook already receives what the model said, so a
stated carve-out is observable in-band. My original proposed fix (a `routing-gate-waivers.jsonl`
the model writes) is now the *inferior* option — it adds a file, a write, and a new trust surface
to obtain something the harness already hands the hook for free.

## Stop hook input — event-specific fields

| Field | Notes |
| --- | --- |
| `stop_hook_active` | *"`true` when Claude Code is already continuing as a result of a stop hook."* |
| `last_assistant_message` | Text of Claude's final response. **The D1 lever.** |
| `background_tasks` | Array, in-flight tasks. Present v2.1.145+. Empty when nothing in flight. |
| `session_crons` | Array, scheduled crons. Same version gate. |

Quoted on the last two: *"let hooks distinguish 'session is done' from 'session is paused waiting
for background work to wake it back up'."* Directly relevant — the observed session was blocked
four times while worker dispatches were still in flight.

## Common input fields (all events)

`session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `effort`,
`hook_event_name`. Plus `agent_id` / `agent_type` when inside a subagent or under `--agent`.

**There is NO session-scoped writable directory field.** Any state file must be keyed on
`session_id` at a path the hook chooses itself.

## Two documented facts the current hook does not account for

1. **A built-in circuit breaker already exists.** Quoted: *"Claude Code overrides the hook and ends
   the turn after 8 consecutive blocks."* So the gate cannot trap a session indefinitely — but 8
   blocks is far past useful, and the observed session hit 4.

2. **`transcript_path` may be stale.** Quoted: *"The transcript file is written asynchronously and
   may lag the in-memory conversation, so it may not yet include the current turn's most recent
   messages when a hook fires. Hooks that need the final assistant text of the current turn should
   use `last_assistant_message` … instead of reading the transcript."*

   **This is a new defect, not in the original report.** The hook's entire write-detection reads
   `transcript_path`. If the transcript lags, the most recent writes of the current turn may be
   absent at Stop time — the hook would see no uncovered write and stay silent. That is an
   **under-block** (unsafe direction), and it is undocumented in the hook's own limitation notes.
   Call this **D8**.

## Stop hook output contract

| Field | Effect |
| --- | --- |
| `decision: "block"` + `reason` | Hard block. `reason` required. Surfaces as a **hook error**. |
| `hookSpecificOutput.additionalContext` (with `hookEventName: "Stop"`) | *"Non-error feedback for Claude. The conversation continues so Claude can act on it, but unlike `decision: "block"` it is shown in the transcript as hook feedback rather than a hook error."* |

Quoted guidance: *"Use `additionalContext` when the hook is working as designed and giving Claude
guidance… It keeps the conversation going through the same loop protections… but the transcript
labels it `Stop hook feedback` and no hook error notification is shown."*

**This is the D2 lever.** A per-path block cap can *downgrade* from `decision: "block"` to
`additionalContext` rather than going silent — the debt stays visible without the loop being
unresolvable, and without dishonestly pretending coverage exists.

Not found in the docs: any way for a Stop hook to message the **user** without also continuing the
model. Treat "notify the user only" as unavailable.

## Empirical facts from the observed session (not from docs)

- `stop_hook_active` does **not** persist across turns: the gate blocked on 4 separate turns
  (06:40:03Z, 06:51:24Z, 07:00:43Z, 07:02:42Z) for the same unresolved target, and the model
  responded each time. Confirms the doc reading.
  *(Note: the existing defect report says "five times". That is wrong — it is four. The report
  needs correcting as part of this work item.)*
- Subagent tool calls do **not** appear in the main transcript: all 143 `tool_use` blocks in the
  session transcript carry `isSidechain: false`. The hook correctly never sees worker writes.
  Hypothesis retired — no defect here.
- The receipt scan is cheap: 127 `report.json` across 135 run dirs parsed in **0.036 s**, well
  inside the hook's `timeout: 15`. But the glob grows unboundedly — there is no pruning.
- **34 `ok`-review receipts already exist on disk**, any of which currently satisfies any write
  (D4). The hazard is ambient, not theoretical.

## Environment constraints

- Hook wired at `~/.claude/settings.json:149`, `timeout: 15`, `statusMessage: "Checking routing gate..."`.
- `~/.claude/hooks/routing-gate.sh` is **untracked by git** — `git ls-files --error-unmatch` fails.
  **There is no rollback.** A backup is a hard prerequisite before any edit.
- **No tests exist** for the hook anywhere under `~/.claude`. A characterization harness must be
  built before changing behaviour.
- The hook is `bash` wrapping a heredoc'd `python3` program; `python3` presence is already checked
  with a fail-open guard.

## Defects to be fixed (from the existing report, plus D8)

D1 blocker — three exits offered, one implemented (now fixable via `last_assistant_message`).
D2 blocker — correction loops cannot terminate (now fixable via `additionalContext` downgrade).
D3 major — write detection follows tool choice; `cp`, `rm`, heredocs invisible.
D4 major — any review receipt discharges any write; `workspace` field never consulted.
D5 major — only observable exit is "dispatch", rewarding junk dispatches.
D6 minor — the uncovered-target count is not a count of writes.
D7 minor — memory writes cost a full heavy-model round; unexamined default.
**D8 new** — write detection reads a data source documented as possibly stale (under-blocks).

## Open design forks for the planner

1. Parsing `last_assistant_message` for a carve-out is **model-controlled input**. The model can
   emit the magic phrase at will. Is that acceptable? Argument for: stating a carve-out is already
   model-controlled and currently produces *nothing*, so making it observable strictly improves
   auditability over the status quo. Argument against: it converts a hard gate into an honour
   system with a syntax. Needs a judgment call, and possibly a middle path (e.g. require the
   carve-out to name the specific path, so it cannot be blanket).
2. Whether to scope receipts by `workspace` (D4) — this would have refused several of the observed
   session's own receipts, because reviews ran against scratch copies rather than the live file.
   That is arguably correct but changes behaviour for the existing workflow pattern.
3. Whether `~/.claude/**` should be exempt (D7) — policy says memory needs review; practice says a
   40-line note costs a 7-minute heavy-model round.
4. Scope: fix all eight, or land D1+D2 (usability) and D4 (meaning) first? The report recommends
   D1+D2 together, then D4, then D3+D6, then D7.
