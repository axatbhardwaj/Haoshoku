export const meta = {
  name: 'review-station',
  description: 'Non-author review of a set of durable writes, anchored to the original request verbatim. Routes the reviewer by author family. Callable standalone or nested inside another workflow.',
  whenToUse:
    'The cross-review of any tier-2 or tier-3 work item. Call it as the last station of a tier-2 script — `await workflow("review-station", {...})` — so review is carried by the graph and cannot be forgotten. Call it standalone to discharge accumulated review debt over a batch of paths.',
  phases: [
    { title: 'Review', detail: 'non-author reads the diff against the original request' },
    { title: 'Adjudicate', detail: 'structure the findings and rule on each' },
  ],
}

// ---------------------------------------------------------------------------
// Family disjointness is an EDGE CONSTRAINT (reviewer.family !== author.family),
// so the author decides the lane — it is not a preference and not a per-call choice:
//
//   author 'chair'/'claude'/'human' -> Codex reviews (codex-wrapper, --mode review, read-only)
//   author 'codex'                  -> Claude reviews (the vadi; Codex must not review its own lane)
//
// Note the asymmetry the policy already records: a Claude review of Codex-authored
// work emits NO codex receipt, so the routing gate cannot see it. That is a known
// blind spot of the gate, not a gap in the review.
// ---------------------------------------------------------------------------
let a = args || {}
if (typeof a === 'string') {
  try {
    a = JSON.parse(a)
  } catch (e) {
    throw new Error(
      `args arrived as a non-JSON string (the harness marshals args to a string): ${e.message}`,
    )
  }
}
const PATHS = Array.isArray(a.paths) ? a.paths.filter(Boolean) : []
if (!PATHS.length) throw new Error('args.paths is required — the durable writes to review.')
if (!a.request) throw new Error('args.request is required — the original human request(s) VERBATIM. A diff-only review approves the spec bugs in its own premise.')

const AUTHOR = (a.author || '').toLowerCase()
if (!['chair', 'claude', 'codex', 'human'].includes(AUTHOR)) {
  throw new Error("args.author must be 'chair', 'claude', 'codex', or 'human' — the reviewer family is derived from it and must differ from the author.")
}
const CODEX_AUTHORED = AUTHOR === 'codex'
const WORKSPACE = a.workspace || '~/.claude'
const TIER = a.tier === 3 ? 3 : 2
const DIFF_CMD = a.diffCmd || null

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    reviewer: { type: 'string' },
    checked: { type: 'string' },
    dispatchVerified: { type: 'boolean' },
    runDir: { type: 'string' },
    requestSatisfied: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit', 'suggestion'] },
          file: { type: 'string' },
          summary: { type: 'string' },
          detail: { type: 'string' },
          failureScenario: { type: 'string' },
          suggestedFix: { type: 'string' },
          confirmed: { type: 'boolean' },
        },
        required: ['severity', 'file', 'summary', 'detail', 'failureScenario', 'suggestedFix', 'confirmed'],
        additionalProperties: false,
      },
    },
  },
  required: ['reviewer', 'checked', 'dispatchVerified', 'runDir', 'requestSatisfied', 'findings'],
  additionalProperties: false,
}

// Both anchors, always. Diff-scoped review misses pre-existing defects in adjacent
// untouched code; plan-anchored review approves the plan's own spec bugs. The original
// request verbatim is the only anchor the work cannot have already agreed with.
const brief = `PATHS UNDER REVIEW (${PATHS.length}):
${PATHS.map((p) => `  - ${p}`).join('\n')}

THE ORIGINAL REQUEST, VERBATIM — review against THIS, not against the change's own internal logic:
--------------------------------------------------------
${a.request}
--------------------------------------------------------

${DIFF_CMD ? `Get the diff with: ${DIFF_CMD}\n` : 'Read each path directly; use git diff/log in the workspace where the path is tracked.\n'}
Report findings-or-explicit-none and state what you actually examined. A bare approval with no account of what was checked is a non-compliant review.${TIER === 3 ? '\n\nTIER 3 — additionally make one system-state pass over each touched module as it now stands, not only the changed hunks. Pre-existing defects in adjacent code are in scope.' : ''}`

phase('Review')
const raw = CODEX_AUTHORED
  ? null
  : await agent(
      `LIGHT DISPATCH — batched read-only review. Expand the lines below into the full self-contained Codex prompt per your light-dispatch procedure.

Launcher invocation — pass EXACTLY these chair-owned flags:
  --mode review --model sol --workspace ${WORKSPACE} --tier ${a.tier === 3 ? 'priority' : 'default'} --resume-from-pointer

Do NOT add --effort (the launcher derives xhigh from --mode review).

OBJECTIVE: Adversarially review the durable writes below. ${AUTHOR === 'human' ? 'A human wrote this change.' : 'The chair wrote this change.'} You did not author them. Find defects: correctness, error handling, missing tests, production risk, and — most importantly — anywhere the change fails to do what the original request actually asked for, silently drops a stated requirement, or widens scope past it.

${brief}

WORKSPACE + PATHS: ${WORKSPACE}; paths as listed above.

WRITE SCOPE: read-only.

VERIFICATION: every finding cites a path that exists and a concrete failure scenario (specific inputs or state -> wrong output; "this could break" is not one).

Report report.json and result.json verbatim.`,
      { label: 'review:codex', phase: 'Review', agentType: 'codex-wrapper' },
    )

if (!CODEX_AUTHORED && !raw) {
  log('CODEX REVIEW STATION FAILED — this work is UNREVIEWED; do not claim completion.')
  return { reviewed: false, reviewerFamily: CODEX_AUTHORED ? 'claude' : 'codex', paths: PATHS, findings: [], requestSatisfied: false, clean: false, debt: true }
}

phase('Adjudicate')
const result = await agent(
  CODEX_AUTHORED
    ? `You are the vadi reviewing CODEX-AUTHORED work. Codex must not review its own lane, so this review is yours and it is the only one this work will get.

${brief}

Read the actual files. Judge: correctness, error handling, test quality, production risk, scope creep, and whether the change genuinely satisfies the original request. Check negative and boundary cases, not just the happy path.

No Codex dispatch occurs on this path. Set \`dispatchVerified: true\` and \`runDir\` to the literal string \`n/a — no Codex dispatch on this path\`.

Set \`confirmed: true\` on every finding you are prepared to stand behind — you are the sole reviewer here, so do not hedge findings you believe. Set \`requestSatisfied\` false if the work does not do what was asked, even where the code itself is clean.

You are READ-ONLY: report findings and proposed fixes as text; do not edit anything.`
    : `A Codex reviewer examined the durable writes below. Its raw wrapper report follows. Do two things: EXTRACT its findings into structure, and ADJUDICATE each one.

${brief}

Before judging or extracting any findings, verify the dispatch itself. Extract the \`run_dir\` path from the raw wrapper report, use your file-reading tools to confirm that directory exists and its \`report.json\` parses, and confirm \`launcher_status\` is \`ok\`. Set \`dispatchVerified\` to true only when all three checks pass. Echo the extracted path into \`runDir\`; on failure, use your best extraction or a note that no run dir was found. A confident wrapper narrative with no run directory means the dispatch NEVER RAN. This check comes first because a review of a dispatch that did not happen is not a review.

Refute a finding when the cited location does not say what it claims, when the failure cannot actually happen, when it describes pre-existing behaviour these writes neither introduced nor touched, or when it is a taste preference dressed as a defect. Read the actual files — do not rule from the prose alone. Default to \`confirmed: false\` when you cannot substantiate it.

Set \`requestSatisfied\` from your own reading of the original request against the writes, not from Codex's opinion of it.

If the wrapper report shows the run did not complete (non-ok launcher_status, nonzero exit, blockers), say so in \`checked\` and set \`requestSatisfied\` false — an incomplete dispatch is not a clean review.

You are READ-ONLY.

RAW WRAPPER REPORT:
${typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)}`,
  { label: CODEX_AUTHORED ? 'review:claude' : 'adjudicate', phase: 'Adjudicate', model: 'opus', schema: FINDINGS_SCHEMA },
)

if (!result) {
  // A failed review is NOT a pass. Say so loudly and return a shape the caller must handle.
  log('REVIEW FAILED — no verdict returned. This work is UNREVIEWED; do not claim completion.')
  return { reviewed: false, reviewerFamily: CODEX_AUTHORED ? 'claude' : 'codex', paths: PATHS, findings: [], requestSatisfied: false, clean: false, debt: true }
}

if (!CODEX_AUTHORED && result.dispatchVerified !== true) {
  log(`CODEX DISPATCH COULD NOT BE VERIFIED (runDir: ${result.runDir}) — this work is UNREVIEWED; do not claim completion.`)
  return { reviewed: false, reviewerFamily: 'codex', paths: PATHS, findings: [], requestSatisfied: false, runDir: result.runDir, clean: false, debt: true }
}

const confirmed = (result.findings || []).filter((f) => f.confirmed)
const blocking = confirmed.filter((f) => f.severity === 'blocker' || f.severity === 'major')
log(`Review complete (${CODEX_AUTHORED ? 'claude' : 'codex'} reviewed ${AUTHOR}-authored): ${confirmed.length} confirmed finding(s), ${blocking.length} blocking. Request satisfied: ${result.requestSatisfied}. Run dir: ${result.runDir}.`)
for (const f of blocking) log(`  [${f.severity}] ${f.file} — ${f.summary}`)

return {
  reviewed: true,
  reviewerFamily: CODEX_AUTHORED ? 'claude' : 'codex',
  author: AUTHOR,
  tier: TIER,
  paths: PATHS,
  checked: result.checked,
  runDir: result.runDir,
  dispatchVerified: result.dispatchVerified,
  requestSatisfied: result.requestSatisfied,
  findings: confirmed,
  blocking: blocking.length,
  // The caller must not claim completion while this is true.
  clean: blocking.length === 0 && result.requestSatisfied === true,
  debt: false,
}
