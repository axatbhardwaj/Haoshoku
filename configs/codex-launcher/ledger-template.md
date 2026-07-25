# Routing ledger — format spec

**This is a presentation format, not a file.** Earlier drafts prescribed a ledger at
`~/.local/state/codex-wrapper/<slug>.ledger.md`. Nothing ever created, appended to, read,
or validated that file, so the Completion rule depended on an artifact no code maintained —
found by adversarial review 2026-07-20. The rule survives; the phantom file does not.

The chair presents the ledger **in the completion response itself**, assembled from the
work-stream it just ran. A durable file is optional and only worth keeping for a work-stream
that spans sessions; if one is kept, this same shape applies.

**Enforcement status, stated honestly:** this is a *manual* completion requirement. The Stop
hook checks the ordering of writes against worker dispatches; it does not read the completion
response and cannot confirm this table was presented. Removing the phantom file fixed a factual
defect but relocated the burden to an unaudited instruction — do not mistake it for a gate.
The auditable half is the evidence column: run dirs are inspectable on disk after the fact.

| # | Task (verbatim request) | Lane | Carve-out | Durable writes | Review evidence | State |
|---|-------------------------|------|-----------|----------------|-----------------|-------|
| 1 | | prativadi \| rupakara \| vadi | — \| (a) needs Claude-side MCP tools \| (b) live back-and-forth with the human *is* the work \| (c) the final taste pass on user-facing output \| (d) recovery after an external-lane failure this stream \| (e) trivial mechanical edits | paths, or "none" | `/tmp/codex-wrapper/run-*` \| named human/model reviewer + what it checked (`no run dir`) | reviewed \| batched-pending \| **debt** |

The evidence column accepts two forms: a Codex-lane `/tmp/codex-wrapper/run-*` directory, or a
named human/model reviewer plus what it checked when there is `no run dir` (for example, a plain
code review comment, or the vadi reviewing Codex-authored work). A completed non-run-dir review
is still a review; marking it as `debt` would be false.

Rules this table exists to make auditable:

- **Every durable write cites covering review evidence.** An uncovered write means the work is
  not complete. Prefer the applicable Codex run dir — inspectable on disk after the
  fact; where the reviewing lane produces none, name the human/model reviewer and what it checked.
- **Every Claude-native execution of delegable work names its carve-out.** "I already had the
  context" and "faster to do it myself" are not carve-outs. A ledger that is all-vadi with no
  carve-outs is not a valid ledger, it is a confession.
- **Debt is visible, never silent.** If no valid non-author reviewer was reachable, mark `debt`
  and state it in the completion claim as provisional. No new completion claims while
  dischargeable debt stands.
- **Quote the request verbatim in column 2.** Reviews anchor to that column, not to the plan and
  not to the chair's summary of what was asked — that is the whole reason it is stored verbatim.
- **`/tmp` run dirs are volatile** (tmpfs; they do not survive reboot). A ledger citing run dirs
  is evidence for *this* session. Anything that must outlive the session belongs in the commit
  message, the PR body, or memory — never only in a run dir.
