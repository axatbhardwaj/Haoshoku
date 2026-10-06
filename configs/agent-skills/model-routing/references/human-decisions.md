# Human decisions during PR workflows

Use `HUMAN_DECISION` only when work beyond an already accepted specification
would change a trust or security boundary, perform an irreversible action, or
materially change product or implementation direction. Escalate even when all
agents agree. Existing explicit authorization remains decided; routine review,
repair and evidence gathering stay quiet.

Before escalating, finish the available technical review and record the exact
repository/PR, proposal, consequence, recommendation, question, owner, server,
head, base and proposal digest. Keep one persistent PR owner. While the decision
is pending, do not issue `APPROVE` or `MERGE_READY` and do not merge.

Telegram is a receipt channel, not the source of action state. PR request files
must explicitly set `"mode": "pr"`. Exact `approve`, `reject` or `hold` replies
are proposal-scoped decision receipts; free-form replies are questions. Before
forwarding a receipt, PR mode requires GitHub to report that the PR is still open
at its stored exact head and base. The relay never approves or acts. The driver
must revalidate the receipt, owner, live PR state, head/base and original
authority immediately before any action. A revision or proposal change
supersedes the old decision.

On every later driver run, inspect pending, failed and uncertain relay state before
claiming readiness. Missing/archived owners, stale revisions, closed decisions and
ambiguous delivery are blockers, not permission to guess, resend, or select a new
owner.

Scheduled owners must invoke the relay CLI themselves; the bot does not infer an
escalation or publish an answer automatically. On the VPS, read the installed
operator guide at `/root/.hermes/plugins/paseo-review-relay/README.md`, then use:

The installed relay also supports generic `"mode": "conversation"` requests.
Receipt words are opt-in delivery signals only; they do not activate any local
workflow or authorize action. The persistent Paseo owner must revalidate the
receipt, authority, context, and live state before acting. Omit receipt words to
keep every eligible reply as a question. This generic mode does not weaken the
PR mode GitHub guard above.

```bash
hermes-relay pending
hermes-relay open --request-file /private/path/decision.json
hermes-relay answer DECISION_ID --file /private/path/answer.txt
```

The driver installs the executable at `/root/.local/bin/hermes-relay`. Keep request
and answer files private, and use the guide's `supersede`, `close`, and explicit
failed-attempt `retry` commands for those less common transport transitions.
Blocked and uncertain decisions cannot answer, supersede, or retry. Inspect and
reconcile the external evidence, then close the old record and use `open` with a
fresh decision ID if transport should continue; never replay ambiguity or reroute
the request to another owner.

While waiting, protect the exact persistent owner from the existing stale-thread
soft-archive schedule. Inspect its current labels, preserve every unrelated label,
and add the opt-out label with:

```bash
paseo agent update <owner-id> --label no-auto-archive=true --json
```

Reinspect the same owner to confirm the label. Do not change or duplicate the
cleanup schedule, and remove the opt-out only when the decision lifecycle no
longer requires that persistent owner.
