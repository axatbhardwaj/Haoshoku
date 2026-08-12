export const meta = {
  name: 'review-station',
  description:
    'Cold Codex review of a stable accumulated change, anchored to the original request, followed by Opus adjudication.',
  whenToUse:
    'After designed work is integrated, or when Opus explicitly requires an independent cold review. Straightforward work normally goes directly from Codex verification to Opus acceptance.',
  phases: [
    { title: 'Review', detail: 'cold read-only Sol review of request and actual change' },
    { title: 'Adjudicate', detail: 'Opus verifies the dispatch and confirmed findings' },
  ],
}

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
if (!PATHS.length) throw new Error('args.paths is required — the stable paths to review.')
if (!a.request) {
  throw new Error(
    'args.request is required — include the original human request verbatim so review cannot inherit the implementation premise.',
  )
}

const WORKSPACE = a.workspace || '~/.claude'
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
          severity: {
            type: 'string',
            enum: ['blocker', 'major', 'minor', 'nit', 'suggestion'],
          },
          file: { type: 'string' },
          summary: { type: 'string' },
          detail: { type: 'string' },
          failureScenario: { type: 'string' },
          suggestedFix: { type: 'string' },
          confirmed: { type: 'boolean' },
        },
        required: [
          'severity',
          'file',
          'summary',
          'detail',
          'failureScenario',
          'suggestedFix',
          'confirmed',
        ],
        additionalProperties: false,
      },
    },
  },
  required: [
    'reviewer',
    'checked',
    'dispatchVerified',
    'runDir',
    'requestSatisfied',
    'findings',
  ],
  additionalProperties: false,
}

const brief = `PATHS UNDER REVIEW (${PATHS.length}):
${PATHS.map((p) => `  - ${p}`).join('\n')}

ORIGINAL REQUEST — review against this, not the change's own explanation:
--------------------------------------------------------
${a.request}
--------------------------------------------------------

${DIFF_CMD ? `Get the stable diff with: ${DIFF_CMD}` : 'Read each path and inspect its stable git diff or snapshot.'}

Check correctness, error handling, tests, production risk, scope, and whether the result actually satisfies the request. Read full context around findings. Every finding names a real path and a concrete state or input that causes the wrong result. Report findings or explicit none, plus what you examined.`

phase('Review')
const raw = await agent(
  `Expand these four core fields into the normal self-contained Codex review prompt.

Dispatch contract:
  MODE: review
  WORKSPACE: ${WORKSPACE}

OBJECTIVE: Perform a cold adversarial review of the stable accumulated change below. You did not receive the implementation conversation and must establish the result from the request, files, diff, and executable evidence.

${brief}

WORKSPACE + PATHS: ${WORKSPACE}; paths listed above.

WRITE SCOPE: read-only.

VERIFICATION: every finding cites an existing path and a concrete failure scenario. Report report.json and result.json verbatim.`,
  { label: 'review:cold-codex', phase: 'Review', agentType: 'sol-wrapper' },
)

if (!raw) {
  log('CODEX REVIEW FAILED — no wrapper result; this work remains unreviewed.')
  return {
    reviewed: false,
    reviewer: 'codex',
    paths: PATHS,
    findings: [],
    requestSatisfied: false,
    clean: false,
    debt: true,
  }
}

phase('Adjudicate')
const result = await agent(
  `A cold Codex reviewer examined the stable change below. Verify that the dispatch happened, extract its findings, and adjudicate each one against the actual files.

${brief}

First extract the run directory from the wrapper report. Confirm it exists, report.json parses, launcher_status is ok, codex_exit_code is zero, result_file_valid is true, and no blocker state contradicts completion. Set dispatchVerified true only when every check holds. A confident narrative without a verified completed result is not a review.

Refute claims the cited code does not support, impossible failure scenarios, pre-existing behavior untouched by this change, and taste preferences presented as defects. Confirm real defects even when Codex understates them. Set requestSatisfied from the original request and actual result.

You are READ-ONLY. This is Opus's independent final judgment step, not an implementation station.

RAW WRAPPER REPORT:
${typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)}`,
  { label: 'review:opus-adjudicate', phase: 'Adjudicate', model: 'opus', schema: FINDINGS_SCHEMA },
)

if (!result || result.dispatchVerified !== true) {
  log('REVIEW COULD NOT BE VERIFIED — this work remains unreviewed.')
  return {
    reviewed: false,
    reviewer: 'codex',
    paths: PATHS,
    findings: [],
    requestSatisfied: false,
    runDir: result?.runDir,
    clean: false,
    debt: true,
  }
}

const confirmed = (result.findings || []).filter((finding) => finding.confirmed)
const blocking = confirmed.filter(
  (finding) => finding.severity === 'blocker' || finding.severity === 'major',
)

log(
  `Cold Codex review complete: ${confirmed.length} confirmed finding(s), ${blocking.length} blocking. Request satisfied: ${result.requestSatisfied}. Run dir: ${result.runDir}.`,
)
for (const finding of blocking) {
  log(`  [${finding.severity}] ${finding.file} — ${finding.summary}`)
}

return {
  reviewed: true,
  reviewer: 'codex',
  freshContext: true,
  paths: PATHS,
  checked: result.checked,
  runDir: result.runDir,
  dispatchVerified: true,
  requestSatisfied: result.requestSatisfied,
  findings: confirmed,
  blocking: blocking.length,
  clean: confirmed.length === 0 && result.requestSatisfied === true,
  debt: false,
}
