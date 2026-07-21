import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CHECK_FAILING_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
]);
const CHECK_GREEN_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const STATUS_FAILING_STATES = new Set(["FAILURE", "ERROR"]);
const STATUS_GREEN_STATES = new Set(["SUCCESS"]);
const DEFAULT_INTERVAL_SECONDS = 120;
const HEARTBEAT_MILLISECONDS = 15 * 60 * 1_000;
const GH_TIMEOUT_MS = 30000;
const GH_PR_FIELDS = [
  "number",
  "state",
  "isDraft",
  "headRefOid",
  "baseRefName",
  "baseRefOid",
  "mergeable",
  "mergeStateStatus",
  "reviewDecision",
  "statusCheckRollup",
  "reviews",
  "comments",
].join(",");
const REVIEW_THREADS_QUERY = `
query($owner:String!,$name:String!,$number:Int!) {
  repository(owner:$owner,name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first:100) {
            nodes { author { login } databaseId body path }
          }
        }
      }
    }
  }
}`;

function safeToken(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export function prSlug(url) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (!match) {
    throw new Error(`not a GitHub pull-request URL: ${url}`);
  }
  return `${safeToken(match[1])}-${safeToken(match[2])}-${match[3]}`;
}

function checkStatus(check) {
  if (check.__typename === "CheckRun") {
    if (CHECK_FAILING_CONCLUSIONS.has(check.conclusion)) {
      return "failing";
    }
    if (CHECK_GREEN_CONCLUSIONS.has(check.conclusion)) {
      return "green";
    }
    return "pending";
  }
  if (check.__typename === "StatusContext") {
    if (STATUS_FAILING_STATES.has(check.state)) {
      return "failing";
    }
    if (STATUS_GREEN_STATES.has(check.state)) {
      return "green";
    }
  }
  return "pending";
}

function normalizeCheck(check, headSha) {
  const type = check.__typename ?? "Unknown";
  const name = check.name ?? check.context ?? "unknown";
  return {
    type,
    name,
    head_sha: headSha,
    key: JSON.stringify([type, name, headSha]),
    status: checkStatus(check),
    conclusion: check.conclusion ?? null,
    state: check.state ?? null,
    workflowName: check.workflowName ?? null,
    detailsUrl: check.detailsUrl ?? check.targetUrl ?? null,
    startedAt: check.startedAt ?? null,
    completedAt: check.completedAt ?? null,
  };
}

function normalizeReview(review) {
  return {
    id: String(review.id),
    author: review.author?.login ?? null,
    authorAssociation: review.authorAssociation ?? null,
    body: review.body ?? "",
    state: review.state ?? null,
    submittedAt: review.submittedAt ?? null,
    commitOid: review.commit?.oid ?? null,
  };
}

function normalizeComment(comment) {
  return {
    id: String(comment.id),
    author: comment.author?.login ?? null,
    authorAssociation: comment.authorAssociation ?? null,
    body: comment.body ?? "",
    createdAt: comment.createdAt ?? null,
    url: comment.url ?? null,
    viewerDidAuthor: Boolean(comment.viewerDidAuthor),
    isMinimized: Boolean(comment.isMinimized),
  };
}

function normalizeThread(thread) {
  const nodes = Array.isArray(thread.comments?.nodes)
    ? thread.comments.nodes
    : [];
  return {
    id: String(thread.id),
    isResolved: Boolean(thread.isResolved),
    isOutdated: Boolean(thread.isOutdated),
    comments: nodes.map((comment) => ({
      databaseId: String(comment.databaseId),
      author: comment.author?.login ?? null,
      body: comment.body ?? "",
      path: comment.path ?? null,
    })),
  };
}

export function normalizeSnapshot(raw, threads = []) {
  const threadNodes = Array.isArray(threads)
    ? threads
    : Array.isArray(threads?.nodes)
      ? threads.nodes
      : [];
  return {
    number: raw.number,
    state: raw.state,
    isDraft: Boolean(raw.isDraft),
    headRefOid: raw.headRefOid,
    baseRefName: raw.baseRefName,
    baseRefOid: raw.baseRefOid,
    mergeable: raw.mergeable,
    mergeStateStatus: raw.mergeStateStatus,
    reviewDecision: raw.reviewDecision ?? null,
    checks: (raw.statusCheckRollup ?? []).map((check) =>
      normalizeCheck(check, raw.headRefOid),
    ),
    reviews: (raw.reviews ?? []).map(normalizeReview),
    comments: (raw.comments ?? []).map(normalizeComment),
    threads: threadNodes.map(normalizeThread),
  };
}

export function computeReadiness(snapshot) {
  const reasons = [];
  if (snapshot.state !== "OPEN") {
    reasons.push(`PR state is ${snapshot.state ?? "unknown"}`);
  }
  if (snapshot.isDraft) {
    reasons.push("PR is a draft");
  }
  if (snapshot.reviewDecision !== "APPROVED") {
    reasons.push(
      `review decision is ${snapshot.reviewDecision ?? "not approved"}`,
    );
  }
  if (snapshot.mergeStateStatus !== "CLEAN") {
    reasons.push(`merge state is ${snapshot.mergeStateStatus ?? "unknown"}`);
  }
  const failingChecks = (snapshot.checks ?? []).filter(
    (check) => check.status === "failing",
  ).length;
  const pendingChecks = (snapshot.checks ?? []).filter(
    (check) => check.status === "pending",
  ).length;
  if (failingChecks > 0 || pendingChecks > 0) {
    reasons.push(
      `checks are not all green (${failingChecks} failing, ${pendingChecks} pending)`,
    );
  }
  const unresolvedThreads = (snapshot.threads ?? []).filter(
    (thread) => !thread.isResolved,
  ).length;
  if (unresolvedThreads > 0) {
    reasons.push(`unresolved review threads: ${unresolvedThreads}`);
  }
  return { looks_ready: reasons.length === 0, reasons };
}

function commentIds(snapshot) {
  return [
    ...(snapshot?.seenCommentIds ?? []),
    ...(snapshot?.comments ?? []).map((comment) => String(comment.id)),
    ...(snapshot?.threads ?? []).flatMap((thread) =>
      (thread.comments ?? []).map((comment) => String(comment.databaseId)),
    ),
  ];
}

function reviewIds(snapshot) {
  return [
    ...(snapshot?.seenReviewIds ?? []),
    ...(snapshot?.reviews ?? []).map((review) => String(review.id)),
  ];
}

function seenCheckMap(snapshot) {
  const checks = { ...(snapshot?.seenChecks ?? {}) };
  for (const check of snapshot?.checks ?? []) {
    if (!checks[check.key]) {
      checks[check.key] = check;
    }
  }
  return checks;
}

function watchSummary(snapshot) {
  return {
    state: snapshot.state,
    head: snapshot.headRefOid,
    comments:
      (snapshot.comments ?? []).length +
      (snapshot.threads ?? []).reduce(
        (count, thread) => count + (thread.comments ?? []).length,
        0,
      ),
    reviews: (snapshot.reviews ?? []).length,
    checks: (snapshot.checks ?? []).length,
    unresolved_threads: (snapshot.threads ?? []).filter(
      (thread) => !thread.isResolved,
    ).length,
    readiness: computeReadiness(snapshot),
  };
}

export function diffSnapshots(previous, next) {
  if (previous === null) {
    return [
      {
        type: "watch_started",
        number: next.number,
        summary: watchSummary(next),
      },
    ];
  }

  const events = [];
  if (previous.headRefOid !== next.headRefOid) {
    events.push({
      type: "new_head",
      number: next.number,
      previous: previous.headRefOid,
      head: next.headRefOid,
    });
  }
  if (
    previous.baseRefName !== next.baseRefName ||
    previous.baseRefOid !== next.baseRefOid
  ) {
    events.push({
      type: "base_changed",
      number: next.number,
      previous: {
        name: previous.baseRefName,
        oid: previous.baseRefOid,
      },
      base: { name: next.baseRefName, oid: next.baseRefOid },
    });
  }

  const previousComments = new Set(commentIds(previous));
  for (const comment of next.comments ?? []) {
    if (!previousComments.has(String(comment.id))) {
      events.push({
        type: "new_comment",
        number: next.number,
        source: "issue",
        id: String(comment.id),
        comment,
      });
    }
  }
  for (const thread of next.threads ?? []) {
    for (const comment of thread.comments ?? []) {
      if (!previousComments.has(String(comment.databaseId))) {
        events.push({
          type: "new_comment",
          number: next.number,
          source: "review_thread",
          id: String(comment.databaseId),
          thread_id: thread.id,
          comment,
        });
      }
    }
  }

  const previousReviews = new Set(reviewIds(previous));
  for (const review of next.reviews ?? []) {
    if (!previousReviews.has(String(review.id))) {
      events.push({
        type: "new_review",
        number: next.number,
        id: String(review.id),
        state: review.state,
        review,
      });
    }
  }

  const previousChecks = seenCheckMap(previous);
  for (const check of next.checks ?? []) {
    const before = previousChecks[check.key];
    if (check.status === "failing" && before?.status !== "failing") {
      events.push({
        type: "check_failed",
        number: next.number,
        key: check.key,
        check,
      });
    } else if (check.status === "green" && before?.status === "failing") {
      events.push({
        type: "check_greened",
        number: next.number,
        key: check.key,
        check,
      });
    }
  }

  const previousReady =
    typeof previous.looks_ready === "boolean"
      ? previous.looks_ready
      : computeReadiness(previous).looks_ready;
  const nextReadiness = computeReadiness(next);
  if (!previousReady && nextReadiness.looks_ready) {
    events.push({
      type: "ready",
      number: next.number,
      readiness: nextReadiness,
    });
  } else if (previousReady && !nextReadiness.looks_ready) {
    events.push({
      type: "readiness_lost",
      number: next.number,
      readiness: nextReadiness,
    });
  }

  if (previous.state !== "MERGED" && next.state === "MERGED") {
    events.push({ type: "merged", number: next.number });
  } else if (previous.state !== "CLOSED" && next.state === "CLOSED") {
    events.push({ type: "closed", number: next.number });
  }
  return events;
}

export function serializeEvent(event) {
  return JSON.stringify(event);
}

export function nextSeenState(previous, next) {
  const seenCommentIds = [
    ...new Set([...commentIds(previous), ...commentIds(next)]),
  ];
  const seenReviewIds = [
    ...new Set([...reviewIds(previous), ...reviewIds(next)]),
  ];
  const seenChecks = seenCheckMap(previous);
  for (const check of next.checks ?? []) {
    seenChecks[check.key] = check;
  }
  return {
    ...next,
    looks_ready: computeReadiness(next).looks_ready,
    seenCommentIds,
    seenReviewIds,
    seenChecks,
  };
}

function parsePrUrl(url) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (!match) {
    throw new Error(`not a GitHub pull-request URL: ${url}`);
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

function textOutput(value) {
  if (typeof value === "string") {
    return value;
  }
  return new TextDecoder().decode(value ?? new Uint8Array());
}

export function defaultGhRunner(args, { timeout = GH_TIMEOUT_MS } = {}) {
  return Bun.spawnSync(args, {
    stdout: "pipe",
    stderr: "pipe",
    timeout,
  });
}

async function checkedGh(args, ghRunner, ghTimeoutMs) {
  const result = await ghRunner(args, { timeout: ghTimeoutMs });
  const exitCode = result?.exitCode ?? result?.exit_code ?? 1;
  if (exitCode !== 0) {
    const detail = textOutput(result?.stderr).trim() || `exit ${exitCode}`;
    throw new Error(`gh command failed: ${detail}`);
  }
  return textOutput(result.stdout);
}

export async function fetchSnapshot(
  url,
  { ghRunner = defaultGhRunner, ghTimeoutMs = GH_TIMEOUT_MS } = {},
) {
  const { owner, repo, number } = parsePrUrl(url);
  const raw = JSON.parse(
    await checkedGh(
      ["gh", "pr", "view", url, "--json", GH_PR_FIELDS],
      ghRunner,
      ghTimeoutMs,
    ),
  );
  const graphql = JSON.parse(
    await checkedGh(
      [
        "gh",
        "api",
        "graphql",
        "-f",
        `query=${REVIEW_THREADS_QUERY}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${repo}`,
        "-F",
        `number=${number}`,
      ],
      ghRunner,
      ghTimeoutMs,
    ),
  );
  const threads =
    graphql?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return normalizeSnapshot(raw, threads);
}

export function parseInterval(
  value,
  warn = (message) => console.error(message),
) {
  if (value === undefined || value === "") {
    return DEFAULT_INTERVAL_SECONDS;
  }
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    warn(
      `pr-watch: invalid PR_WATCH_INTERVAL=${JSON.stringify(value)} — using ${DEFAULT_INTERVAL_SECONDS}`,
    );
    return DEFAULT_INTERVAL_SECONDS;
  }
  return Number(value);
}

function defaultStateRoot() {
  return path.join(homedir(), ".local", "state", "pr-watch");
}

function readState(fsApi, statePath) {
  if (!fsApi.existsSync(statePath)) {
    return null;
  }
  return JSON.parse(String(fsApi.readFileSync(statePath, "utf8")));
}

function writeStateAtomic(fsApi, statePath, state) {
  const temporaryPath = `${statePath}.tmp`;
  fsApi.writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, "utf8");
  fsApi.renameSync(temporaryPath, statePath);
}

function emitLine(fsApi, logPath, stdout, event) {
  const line = serializeEvent(event);
  stdout(line);
  fsApi.appendFileSync(logPath, `${line}\n`, "utf8");
}

function defaultPidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(fsApi, lockPath, slug, isPidAlive, clock) {
  if (fsApi.existsSync(lockPath)) {
    let existingLock = null;
    try {
      existingLock = JSON.parse(String(fsApi.readFileSync(lockPath, "utf8")));
    } catch {
      existingLock = null; // corrupt lock file → treat as stale, take over
    }
    if (
      existingLock &&
      Number.isInteger(existingLock.pid) &&
      isPidAlive(existingLock.pid)
    ) {
      throw new Error(`already watching ${slug} (pid ${existingLock.pid})`);
    }
  }
  fsApi.writeFileSync(
    lockPath,
    `${JSON.stringify({
      pid: process.pid,
      startedAt: new Date(clock()).toISOString(),
    })}\n`,
    "utf8",
  );
}

function releaseLock(fsApi, lockPath) {
  if (fsApi.existsSync(lockPath)) {
    fsApi.unlinkSync(lockPath);
  }
}

export async function watchPr(url, options = {}) {
  const fsApi = options.fsApi ?? fs;
  const stateRoot = options.stateRoot ?? defaultStateRoot();
  const ghRunner = options.ghRunner ?? defaultGhRunner;
  const ghTimeoutMs = options.ghTimeoutMs ?? GH_TIMEOUT_MS;
  const clock = options.clock ?? Date.now;
  const isPidAlive = options.isPidAlive ?? defaultPidIsAlive;
  const sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
  const stdout = options.stdout ?? ((line) => console.log(line));
  const intervalSeconds =
    options.intervalSeconds ?? parseInterval(process.env.PR_WATCH_INTERVAL);
  const slug = prSlug(url);
  const statePath = path.join(stateRoot, `${slug}.state.json`);
  const logPath = path.join(stateRoot, `${slug}.log`);
  const lockPath = path.join(stateRoot, `${slug}.lock`);

  fsApi.mkdirSync(stateRoot, { recursive: true });
  acquireLock(fsApi, lockPath, slug, isPidAlive, clock);
  try {
    let previous = readState(fsApi, statePath);
    let firstPoll = true;
    let lastEventAt = null;

    while (true) {
      const now = clock();
      let snapshot;
      try {
        snapshot = await fetchSnapshot(url, { ghRunner, ghTimeoutMs });
      } catch (error) {
        const event = {
          type: "poll_error",
          slug,
          at: new Date(now).toISOString(),
          error: error?.message ?? String(error),
        };
        emitLine(fsApi, logPath, stdout, event);
        lastEventAt = now;
        await sleep(intervalSeconds * 1_000);
        continue;
      }

      let events = diffSnapshots(previous, snapshot);
      if (firstPoll && previous !== null) {
        const catchUp = diffSnapshots(null, snapshot)[0];
        events = [{ ...catchUp, resumed: true }, ...events];
      }
      firstPoll = false;

      const terminalType =
        snapshot.state === "MERGED"
          ? "merged"
          : snapshot.state === "CLOSED"
            ? "closed"
            : null;
      if (terminalType && !events.some((event) => event.type === terminalType)) {
        events.push({ type: terminalType, number: snapshot.number });
      }

      if (
        events.length === 0 &&
        lastEventAt !== null &&
        now - lastEventAt >= HEARTBEAT_MILLISECONDS
      ) {
        events = [
          {
            type: "heartbeat",
            slug,
            number: snapshot.number,
            at: new Date(now).toISOString(),
          },
        ];
      }

      for (const event of events) {
        emitLine(fsApi, logPath, stdout, {
          ...event,
          at: event.at ?? new Date(now).toISOString(),
        });
      }
      if (events.length > 0) {
        lastEventAt = now;
      }

      const state = {
        ...nextSeenState(previous, snapshot),
        slug,
        url,
        lastPollAt: new Date(now).toISOString(),
      };
      writeStateAtomic(fsApi, statePath, state);
      previous = state;

      if (terminalType) {
        return 0;
      }
      await sleep(intervalSeconds * 1_000);
    }
  } finally {
    releaseLock(fsApi, lockPath);
  }
}

export async function snapshotPr(url, options = {}) {
  const stdout = options.stdout ?? ((line) => console.log(line));
  const snapshot = await fetchSnapshot(url, options);
  stdout(
    JSON.stringify({ snapshot, readiness: computeReadiness(snapshot) }),
  );
  return snapshot;
}

export function statusPr(options = {}) {
  const fsApi = options.fsApi ?? fs;
  const stateRoot = options.stateRoot ?? defaultStateRoot();
  const clock = options.clock ?? Date.now;
  const stdout = options.stdout ?? ((line) => console.log(line));
  if (!fsApi.existsSync(stateRoot)) {
    return [];
  }
  const statuses = fsApi
    .readdirSync(stateRoot)
    .filter((name) => name.endsWith(".state.json"))
    .sort()
    .map((name) => {
      const state = JSON.parse(
        String(fsApi.readFileSync(path.join(stateRoot, name), "utf8")),
      );
      const lastPoll = Date.parse(state.lastPollAt);
      return {
        slug: name.slice(0, -".state.json".length),
        age_seconds: Number.isFinite(lastPoll)
          ? Math.max(0, Math.floor((clock() - lastPoll) / 1_000))
          : null,
        open: state.state === "OPEN",
      };
    });
  for (const status of statuses) {
    stdout(JSON.stringify(status));
  }
  return statuses;
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const [command, url] = argv;
  if (command === "watch" && url) {
    return watchPr(url, options);
  }
  if (command === "snapshot" && url) {
    await snapshotPr(url, options);
    return 0;
  }
  if (command === "status" && url === undefined) {
    statusPr(options);
    return 0;
  }
  throw new Error(
    "usage: pr-watch watch <url> | pr-watch snapshot <url> | pr-watch status",
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`pr-watch: ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
