export const meta = {
  name: 'pr-review',
  description: 'Review a GitHub PR: Codex lenses in parallel, Claude adversarial verification, canonical local HTML deliverable. Never posts to GitHub.',
  whenToUse:
    'Any pull-request review, any repo. Deliberately does NOT run the dvandva build graph: a PR is already-written, human-authored code, so there is no plan to gate. Bulk diff analysis rides Codex (quota routing); Claude keeps the judgment stations — refutation, synthesis, taste.',
  phases: [
    { title: 'Scope', detail: 'pin base/head SHAs, collect the spec anchor', model: 'sonnet' },
    { title: 'Review', detail: 'Codex lenses in parallel, read-only, priority tier' },
    { title: 'Verify', detail: 'Claude extracts and refutes; unsupported findings are dropped' },
    { title: 'Render', detail: 'synthesize into the canonical HTML review file' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs. `today` is required because workflow scripts cannot call Date.now() —
// it would break resume — and the review header carries a mandatory date field.
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
if (!a.pr) throw new Error('args.pr is required — the PR number to review.')
if (!a.today) throw new Error('args.today is required (YYYY-MM-DD). Workflow scripts cannot call Date.now(); the chair passes the date in.')
if (!a.repo) throw new Error('args.repo is required — the GitHub repository in owner/name form.')
if (!a.dir) throw new Error('args.dir is required — the local checkout directory.')
if (!a.reviewFile) throw new Error('args.reviewFile is required — the canonical local HTML review output path.')

const PR = String(a.pr)
const REPO = a.repo
const TODAY = a.today
const DEEP = a.deep === true
const WORKDIR = a.dir
const REVIEW_FILE = a.reviewFile

// ---------------------------------------------------------------------------
// Lane assignment, and why each station sits where it does:
//
//   FIND   -> codex-wrapper, --mode review. Bulk diff analysis is exactly the work
//             that should ride Codex quota. Review mode is read-only by launcher
//             construction and carries NO clean-tree precondition, so it runs fine
//             against a dirty working tree (review worktrees often are).
//
//   VERIFY -> Claude. Refutation is judgment, which is what Claude quota funds.
//             It also absorbs extraction: wrapper stations must never be given a
//             `schema` (it kills the wrapper mid-supervision), so the Codex lens
//             returns prose and this station turns prose into structure AND
//             attacks it in one hop — no separate structurer, one less serial step.
//
//   RENDER -> Claude, a STATED SUBSTITUTION for the rupakara lane. Policy assigns
//             HTML deliverables to Codex, but authoring requires --mode
//             implementation, which enforces a clean tree, and the review file
//             may live inside a dirty workspace. Such dispatches return
//             blocked_dirty_tree, so keeping this station on Claude avoids coupling
//             review rendering to the caller's output-repository state.
//
// Effort is NEVER named here: the launcher derives it from --mode (review -> xhigh,
// implementation -> high). --tier priority is the one speed dial the chair owns; it
// buys processing speed, not shallower thinking.
// ---------------------------------------------------------------------------
const TIER = a.tier || 'priority'

const SCOPE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    author: { type: 'string' },
    url: { type: 'string' },
    headRef: { type: 'string' },
    baseRef: { type: 'string' },
    headSha: { type: 'string' },
    baseSha: { type: 'string' },
    mergeBase: { type: 'string' },
    additions: { type: 'number' },
    deletions: { type: 'number' },
    filesChanged: { type: 'number' },
    files: { type: 'array', items: { type: 'string' } },
    state: { type: 'string' },
    specAnchor: { type: 'string' },
    isStacked: { type: 'boolean' },
  },
  required: ['title', 'author', 'url', 'headRef', 'baseRef', 'headSha', 'baseSha', 'mergeBase', 'additions', 'deletions', 'filesChanged', 'files', 'state', 'specAnchor', 'isStacked'],
  additionalProperties: false,
}

// One schema, one station: the verifier extracts Codex's prose findings AND rules on
// them. Carrying both in the same object removes the summary-matching step entirely —
// there is no way for a finding to fall through a name mismatch and vanish.
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    dispatchOk: { type: 'boolean' },
    checked: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit', 'suggestion', 'not verified'] },
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          detail: { type: 'string' },
          failureScenario: { type: 'string' },
          suggestedFix: { type: 'string' },
          confirmed: { type: 'boolean' },
          evidence: { type: 'string' },
          reasonIfRefuted: { type: 'string' },
        },
        required: ['severity', 'file', 'line', 'summary', 'detail', 'failureScenario', 'suggestedFix', 'confirmed', 'evidence', 'reasonIfRefuted'],
        additionalProperties: false,
      },
    },
  },
  required: ['dimension', 'dispatchOk', 'checked', 'findings'],
  additionalProperties: false,
}

// Each lens is a different QUESTION asked of the whole diff, not a different slice of
// it. Redundancy across lenses is the point — diverse lenses catch failure modes that
// N identical reviewers cannot.
const BASE_DIMENSIONS = [
  { key: 'correctness', focus: 'Logic errors, off-by-one, wrong operators, broken control flow, incorrect state transitions, race conditions, resource leaks, and violations of the conventions in the repo CLAUDE.md. Trace actual data flow; do not pattern-match on shape.' },
  { key: 'error-handling', focus: 'Swallowed exceptions, empty catch blocks, fallbacks that mask real failures, errors logged then ignored, promises without rejection handling, and any path where a failure produces a success-shaped result.' },
  { key: 'tests', focus: 'Whether tests exercise the new behaviour or merely execute it. Missing negative and boundary cases, assertions on mocks rather than real behaviour, and behaviour changed with no covering test.' },
  { key: 'production-risk', focus: 'What breaks under production conditions: backward compatibility, migration safety, N+1 and other scaling cliffs, unbounded growth, config and secret handling, blast radius if this ships wrong. Include one pass over the touched modules as they now stand, not only the diff hunks — diff-scoped review misses pre-existing defects in adjacent code.' },
  { key: 'spec-compliance', focus: 'ONLY whether the change does what it was asked to do. Anchor strictly to the SPEC ANCHOR below, NOT to the diff internal logic. A change can be internally flawless and still solve the wrong problem, silently drop a stated requirement, or quietly widen scope. Those are the findings you are here for.' },
]

const DEEP_DIMENSIONS = [
  { key: 'security', focus: 'Injection, authz/authn gaps, unsafe deserialization, SSRF, secret exposure, unvalidated input crossing a trust boundary, dependency risk. Form explicit attack hypotheses and test each against the code.' },
]

const DIMENSIONS = DEEP ? [...BASE_DIMENSIONS, ...DEEP_DIMENSIONS] : BASE_DIMENSIONS

phase('Scope')
const scope = await agent(
  `Collect the review scope for GitHub PR #${PR} in \`${REPO}\`. Work from \`${WORKDIR}\`; if no local checkout exists, use the GitHub API alone.

You are READ-ONLY. Do not edit any file. Do NOT post to GitHub — no \`gh pr review\`, no \`gh pr comment\`, no \`gh api\` with -X POST/PATCH/PUT/DELETE.

Gather:
1. \`gh pr view ${PR} --repo ${REPO} --json title,author,url,headRefName,baseRefName,headRefOid,additions,deletions,changedFiles,state,mergeable,reviewDecision,body\`
2. The base SHA and the merge base. A stacked PR targets another feature branch, NOT the default branch — resolve the ACTUAL configured base, never assume \`dev\`/\`main\`. Set \`isStacked\` true when baseRef is not the repo default branch.
3. The changed-file list.
4. The SPEC ANCHOR: the PR description verbatim, plus the linked ticket requirements if the description references one (Linear/Monday/GitHub issue) and you can read it read-only. This is the contract the change is measured against — reproduce it faithfully, do NOT summarise away specific requirements. If there is genuinely no description and no ticket, set specAnchor to exactly: "NONE — no PR description or linked ticket; spec-compliance cannot be assessed."

Pin real SHAs. A review that cannot name the commit it reviewed is worthless.`,
  { label: `scope:PR-${PR}`, model: 'sonnet', schema: SCOPE_SCHEMA },
)

if (!scope) throw new Error(`Scope station failed for PR #${PR} — refusing to review without pinned SHAs.`)
log(`PR #${PR} "${scope.title}" by ${scope.author} — ${scope.filesChanged} files, +${scope.additions}/−${scope.deletions}, ${scope.headRef} → ${scope.baseRef} @ ${String(scope.headSha).slice(0, 8)}${scope.isStacked ? ' [STACKED]' : ''}`)
if (String(scope.specAnchor).startsWith('NONE')) log('No spec anchor found — spec-compliance findings will be graded "not verified".')
log(`${DIMENSIONS.length} Codex lenses dispatching in parallel (mode=review, tier=${TIER}); wall-clock is one review deep, not ${DIMENSIONS.length}.`)

const anchor = `PR #${PR} in \`${REPO}\` — ${scope.url}
Title: ${scope.title}
Branch: \`${scope.headRef}\` → \`${scope.baseRef}\`${scope.isStacked ? '  (STACKED — review against THIS base, not the default branch)' : ''}
Pinned at: base ${scope.baseSha} / head ${scope.headSha} (merge base ${scope.mergeBase})
Size: +${scope.additions} / −${scope.deletions} across ${scope.filesChanged} files

SPEC ANCHOR (the contract this change is measured against):
--------------------------------------------------------
${scope.specAnchor}
--------------------------------------------------------`

// pipeline, not parallel: each lens goes to verification the moment ITS Codex run
// returns. A barrier would idle every fast lens behind the slowest dispatch.
const reviewed = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(
      `LIGHT DISPATCH — batched read-only review. Expand the four lines below into the full self-contained Codex prompt per your light-dispatch procedure.

Launcher invocation — pass EXACTLY these chair-owned flags:
  --mode review --model sol --workspace ${WORKDIR} --tier ${TIER}

Do NOT add --effort (the launcher derives xhigh from --mode review).
Do NOT add --persist, --resume, or --resume-from-pointer. This is one of ${DIMENSIONS.length} concurrent
dispatches against the same workspace; sharing or racing on one standing session would
corrupt it. These lenses are deliberately cold.

OBJECTIVE: Review GitHub PR #${PR} in \`${REPO}\` through exactly one lens: **${d.key}**.
${d.focus}

  Report only what falls under this lens; other reviewers cover the rest. Get the diff with
  \`gh pr diff ${PR} --repo ${REPO}\`. Read full file context around anything flagged — a diff
  hunk alone is not enough to judge correctness.

  For every finding give: severity (blocker|major|minor|nit|suggestion), the real file path and
  real line number in head commit ${scope.headSha}, a one-sentence summary, the detail, a CONCRETE
  failure scenario (specific inputs or state -> the wrong output or crash; "this could break" is
  not a failure scenario), and a suggested fix.

  Do not invent findings to look thorough. An empty findings list with an honest account of what
  was checked is a valid and useful result.

${anchor}

WORKSPACE + PATHS: ${WORKDIR}; changed files: ${scope.files.slice(0, 40).join(', ')}${scope.files.length > 40 ? ` … (+${scope.files.length - 40} more)` : ''}

WRITE SCOPE: read-only. Additionally: Codex must NOT post to GitHub — read-only \`gh\` only
(\`gh pr view\`, \`gh pr diff\`, \`gh api\` GET). No \`gh pr review\`, no \`gh pr comment\`, no
-X POST/PATCH/PUT/DELETE. Posting requires human approval that has NOT been given.

VERIFICATION: \`gh pr diff ${PR} --repo ${REPO}\` succeeds, and every finding cites a file:line
that actually exists in head commit ${scope.headSha}.

Report report.json and result.json verbatim as usual.`,
      { label: `find:${d.key}`, phase: 'Review', agentType: 'codex-wrapper' },
    ),
  (raw, d) => {
    if (!raw) return { d, raw: null, verify: null }
    return agent(
      `A Codex reviewer examined PR #${PR} in \`${REPO}\` through the **${d.key}** lens. Its raw wrapper report is below.

Do TWO things:
1. EXTRACT its findings into structure. Codex returns prose plus result.json; pull every distinct finding out. Do not merge separate findings, and do not drop one because it is inconvenient to structure.
2. REFUTE each one. You are adversarial, not a rubber stamp.

${anchor}

Refute a finding when: the cited line does not say what the finding claims; the failure scenario cannot actually happen (guarded upstream, unreachable, handled elsewhere); it describes pre-existing behaviour this PR neither introduced nor touched; or it is a taste preference dressed up as a defect. Re-grade severity when a finding is real but overstated.

Read the actual code at each cited location — \`${WORKDIR}\` is the checkout, head is ${scope.headSha}. Do not rule from the prose alone.

Default to \`confirmed: false\` when you cannot substantiate a finding from the code itself. A plausible-sounding finding that survives into a review costs the author more than a missed nit. Where the spec anchor is "NONE", grade spec-compliance findings \`not verified\` rather than confirming them.

Set \`dispatchOk: false\` if the wrapper report shows the Codex run did not actually complete (non-ok launcher_status, nonzero exit, blockers present) — that means this lens did NOT get reviewed and must be reported as a coverage gap, not as a clean result.

You are READ-ONLY and must not post anything to GitHub.

RAW WRAPPER REPORT:
${typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)}`,
      { label: `verify:${d.key}`, phase: 'Verify', model: 'opus', schema: VERIFY_SCHEMA },
    ).then((verify) => ({ d, raw, verify }))
  },
)

const confirmed = []
const dropped = []
const gaps = []

for (const result of reviewed.filter(Boolean)) {
  const { d, verify } = result
  if (!verify || verify.dispatchOk === false) {
    gaps.push(d.key)
    continue
  }
  for (const f of verify.findings || []) {
    if (f.confirmed) confirmed.push({ ...f, dimension: d.key })
    else dropped.push({ ...f, dimension: d.key })
  }
}
for (const d of DIMENSIONS) {
  if (!reviewed.some((r) => r && r.d === d)) gaps.push(d.key)
}

const ORDER = ['blocker', 'major', 'minor', 'nit', 'suggestion', 'not verified']
confirmed.sort((x, y) => ORDER.indexOf(x.severity) - ORDER.indexOf(y.severity))

// Never let a filtered finding be invisible — a silent drop reads as "nothing was found".
log(`${confirmed.length} finding(s) survived verification; ${dropped.length} refuted and dropped.`)
for (const f of dropped) log(`  dropped [${f.dimension}] ${f.summary} — ${f.reasonIfRefuted}`)
if (gaps.length) log(`COVERAGE GAP — these lenses did not complete and are NOT covered by this review: ${gaps.join(', ')}`)

phase('Render')
const rendered = await agent(
  `Author the canonical local review file for PR #${PR} in \`${REPO}\`.

Write to: ${REVIEW_FILE}
If that file already EXISTS this is a follow-up round: keep everything there and APPEND a clearly dated round section (${TODAY}). Never overwrite a prior round.

Use the \`html-deliverables\` skill for the visual format (dark, self-contained, token palette verbatim).

Header block, all fields mandatory:
- PR: ${scope.url}
- Title: \`${scope.title}\`
- Author: ${scope.author}
- Branch: \`${scope.headRef}\` → \`${scope.baseRef}\`${scope.isStacked ? '  (stacked — reviewed against its configured base, not the default branch)' : ''}
- Reviewed: ${TODAY}, against \`${scope.baseRef}\` @ \`${scope.baseSha}\` and PR head \`${scope.headSha}\` (merge base \`${scope.mergeBase}\`)
- Size: +${scope.additions} / −${scope.deletions} across ${scope.filesChanged} files
- GitHub state at refresh: ${scope.state}

Body section order: 1. Verdict  2. Severity table (#, Severity, Summary — filterable)  3. What changes  4. Ground truth — what I verified  5. Strengths  6. Issues (collapsible, file:line + suggested fix)  7. Recommended action

Severity vocabulary is fixed: blocker, major, minor, nit, suggestion, resolved, not verified.

You write ONLY ${REVIEW_FILE}. Touch nothing in the repo. Do NOT post to GitHub — posting requires human approval that has not been given, and the review body must contain NO link back to this local file (it is gitignored and unreachable by the PR author).

CONFIRMED FINDINGS (already adversarially verified — do not re-litigate):
${JSON.stringify(confirmed, null, 2)}

REFUTED AND DROPPED (do NOT put these in the body; mention one in Ground truth only if a reader would otherwise wonder why an obvious concern is absent):
${JSON.stringify(dropped, null, 2)}

WHAT EACH LENS EXAMINED (source for the Ground truth section):
${JSON.stringify(reviewed.filter(Boolean).map((r) => ({ dimension: r.d.key, checked: r.verify?.checked || 'lens did not complete' })), null, 2)}
${gaps.length ? `\nSTATE THIS EXPLICITLY in Ground truth — these lenses did not run, so the review does not cover them: ${gaps.join(', ')}` : ''}

Return the absolute path you wrote and a one-line verdict.`,
  { label: `render:PR-${PR}`, phase: 'Render', model: 'opus' },
)

return {
  pr: PR,
  repo: REPO,
  reviewFile: REVIEW_FILE,
  headSha: scope.headSha,
  baseSha: scope.baseSha,
  lanes: { find: `codex-wrapper (mode=review, sol, xhigh, tier=${TIER})`, verify: 'claude opus', render: 'claude opus — STATED SUBSTITUTION for the rupakara lane; avoids implementation-mode clean-tree coupling' },
  confirmed: confirmed.length,
  dropped: dropped.length,
  coverageGaps: gaps,
  bySeverity: ORDER.map((s) => ({ severity: s, count: confirmed.filter((f) => f.severity === s).length })).filter((x) => x.count > 0),
  rendered,
  posted: false, // this workflow never posts; posting is a separate, human-approved step
}
