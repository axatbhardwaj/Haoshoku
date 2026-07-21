import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  computeReadiness,
  diffSnapshots,
  nextSeenState,
  normalizeSnapshot,
  parseInterval,
  prSlug,
  serializeEvent,
  snapshotPr,
  statusPr,
  watchPr,
} from "../configs/pr-watch/pr-watch.js";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const BASE_A = "c".repeat(40);
const BASE_B = "d".repeat(40);

function checkRun({
  name = "unit-tests",
  conclusion = "SUCCESS",
  status = "COMPLETED",
} = {}) {
  return {
    __typename: "CheckRun",
    name,
    workflowName: "CI",
    status,
    conclusion,
    detailsUrl: "https://github.com/acme/widget/actions/runs/1",
    startedAt: "2026-07-21T00:00:00Z",
    completedAt: status === "COMPLETED" ? "2026-07-21T00:01:00Z" : null,
  };
}

function statusContext({ context = "buildkite", state = "SUCCESS" } = {}) {
  return {
    __typename: "StatusContext",
    context,
    state,
    targetUrl: "https://ci.example.test/build/1",
  };
}

function review({
  id = "R_1",
  state = "APPROVED",
  body = "Looks good",
} = {}) {
  return {
    id,
    author: { login: "reviewer" },
    authorAssociation: "MEMBER",
    body,
    state,
    submittedAt: "2026-07-21T00:02:00Z",
    commit: { oid: HEAD_A },
  };
}

function issueComment({ id = "IC_1", body = "A comment" } = {}) {
  return {
    id,
    author: { login: "commenter" },
    authorAssociation: "CONTRIBUTOR",
    body,
    createdAt: "2026-07-21T00:03:00Z",
    url: "https://github.com/acme/widget/pull/7#issuecomment-1",
    viewerDidAuthor: false,
    isMinimized: false,
  };
}

function thread({
  id = "PRRT_1",
  isResolved = false,
  isOutdated = false,
  databaseId = 501,
} = {}) {
  return {
    id,
    isResolved,
    isOutdated,
    comments: {
      nodes: [
        {
          author: { login: "thread-reviewer" },
          databaseId,
          body: "Please change this",
          path: "src/index.js",
        },
      ],
    },
  };
}

function rawSnapshot(overrides = {}) {
  return {
    number: 7,
    state: "OPEN",
    isDraft: false,
    headRefOid: HEAD_A,
    baseRefName: "stable",
    baseRefOid: BASE_A,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    statusCheckRollup: [checkRun()],
    reviews: [],
    comments: [],
    ...overrides,
  };
}

function snap(overrides = {}, threads = []) {
  return normalizeSnapshot(rawSnapshot(overrides), threads);
}

function eventTypes(events) {
  return events.map((event) => event.type);
}

class MemoryFs {
  constructor(initialFiles = {}) {
    this.files = new Map(Object.entries(initialFiles));
    this.directories = new Set();
    this.operations = [];
    for (const filePath of this.files.keys()) {
      this.directories.add(path.dirname(filePath));
    }
  }

  existsSync(filePath) {
    return this.files.has(filePath) || this.directories.has(filePath);
  }

  mkdirSync(directory) {
    this.directories.add(directory);
  }

  readFileSync(filePath) {
    if (!this.files.has(filePath)) {
      const error = new Error(`ENOENT: ${filePath}`);
      error.code = "ENOENT";
      throw error;
    }
    return this.files.get(filePath);
  }

  writeFileSync(filePath, contents) {
    this.operations.push(["write", filePath, String(contents)]);
    this.files.set(filePath, String(contents));
  }

  appendFileSync(filePath, contents) {
    this.operations.push(["append", filePath]);
    this.files.set(filePath, (this.files.get(filePath) ?? "") + contents);
  }

  renameSync(from, to) {
    this.operations.push(["rename", from, to]);
    this.files.set(to, this.files.get(from));
    this.files.delete(from);
  }

  unlinkSync(filePath) {
    this.operations.push(["unlink", filePath]);
    this.files.delete(filePath);
  }

  readdirSync(directory) {
    const prefix = `${directory}/`;
    return [...this.files.keys()]
      .filter((filePath) => filePath.startsWith(prefix))
      .map((filePath) => filePath.slice(prefix.length))
      .filter((name) => !name.includes("/"));
  }
}

function ghSequence(entries) {
  let poll = -1;
  return async (args) => {
    if (args.includes("pr") && args.includes("view")) {
      poll += 1;
      const entry = entries[Math.min(poll, entries.length - 1)];
      if (entry.error) {
        return { exitCode: 1, stdout: "", stderr: entry.error };
      }
      return { exitCode: 0, stdout: JSON.stringify(entry.raw), stderr: "" };
    }
    const entry = entries[Math.min(poll, entries.length - 1)];
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        data: {
          repository: {
            pullRequest: { reviewThreads: { nodes: entry.threads ?? [] } },
          },
        },
      }),
      stderr: "",
    };
  };
}

describe("pr-watch deterministic core", () => {
  test("1. open approved clean PR with all checks green looks ready", () => {
    const readiness = computeReadiness(snap());

    expect(readiness).toEqual({ looks_ready: true, reasons: [] });
  });

  test("2. CheckRun FAILURE emits check_failed and makes readiness false", () => {
    const previous = snap();
    const next = snap({
      statusCheckRollup: [checkRun({ conclusion: "FAILURE" })],
    });

    expect(eventTypes(diffSnapshots(previous, next))).toContain("check_failed");
    expect(computeReadiness(next).looks_ready).toBe(false);
  });

  test("3. StatusContext ERROR emits check_failed", () => {
    const previous = snap({
      statusCheckRollup: [statusContext()],
    });
    const next = snap({
      statusCheckRollup: [statusContext({ state: "ERROR" })],
    });

    expect(eventTypes(diffSnapshots(previous, next))).toContain("check_failed");
  });

  test("4. draft PR is not ready and includes a draft reason", () => {
    const readiness = computeReadiness(snap({ isDraft: true }));

    expect(readiness.looks_ready).toBe(false);
    expect(readiness.reasons.some((reason) => reason.includes("draft"))).toBe(
      true,
    );
  });

  test("5. approved PR with BEHIND merge state is not ready", () => {
    const readiness = computeReadiness(
      snap({ mergeStateStatus: "BEHIND" }),
    );

    expect(readiness.looks_ready).toBe(false);
    expect(readiness.reasons.some((reason) => reason.includes("BEHIND"))).toBe(
      true,
    );
  });

  test("6. changes-requested review and unresolved thread emit review and comment", () => {
    const previous = snap();
    const next = snap(
      {
        reviewDecision: "CHANGES_REQUESTED",
        reviews: [review({ state: "CHANGES_REQUESTED" })],
      },
      [thread()],
    );

    const events = diffSnapshots(previous, next);
    expect(eventTypes(events)).toContain("new_review");
    expect(eventTypes(events)).toContain("new_comment");
    expect(
      events.find((event) => event.type === "new_review")?.state,
    ).toBe("CHANGES_REQUESTED");
    const readiness = computeReadiness(next);
    expect(readiness.looks_ready).toBe(false);
    expect(
      readiness.reasons.some((reason) => reason.includes("unresolved")),
    ).toBe(true);
  });

  test("7. new issue comment and FAILURE to SUCCESS flip emit comment and greened", () => {
    const previous = snap({
      reviewDecision: "REVIEW_REQUIRED",
      statusCheckRollup: [checkRun({ conclusion: "FAILURE" })],
    });
    const next = snap({
      comments: [issueComment()],
      statusCheckRollup: [checkRun({ conclusion: "SUCCESS" })],
    });

    const types = eventTypes(diffSnapshots(previous, next));
    expect(types).toContain("new_comment");
    expect(types).toContain("check_greened");
  });

  test("8. new head emits new_head and re-arms failing check identity", () => {
    const previous = snap({
      statusCheckRollup: [checkRun({ conclusion: "FAILURE" })],
    });
    const next = snap({
      headRefOid: HEAD_B,
      statusCheckRollup: [checkRun({ conclusion: "FAILURE" })],
    });

    expect(previous.checks[0].key).not.toBe(next.checks[0].key);
    const types = eventTypes(diffSnapshots(previous, next));
    expect(types).toContain("new_head");
    expect(types).toContain("check_failed");
  });

  test("9. base name or oid change emits base_changed", () => {
    const previous = snap();
    const next = snap({ baseRefName: "main", baseRefOid: BASE_B });

    expect(eventTypes(diffSnapshots(previous, next))).toContain("base_changed");
  });

  test("10. OPEN to MERGED emits merged terminal event", () => {
    const previous = snap();
    const next = snap({ state: "MERGED" });

    expect(eventTypes(diffSnapshots(previous, next))).toContain("merged");
  });

  test("11. unchanged normalized snapshot emits no duplicate events", () => {
    const snapshot = snap();

    expect(diffSnapshots(snapshot, structuredClone(snapshot))).toEqual([]);
  });

  test("ready to not-ready emits readiness_lost with reasons", () => {
    const previous = snap();
    const next = snap({ isDraft: true });

    const event = diffSnapshots(previous, next).find(
      (candidate) => candidate.type === "readiness_lost",
    );
    expect(event).toBeDefined();
    expect(event.number).toBe(7);
    expect(event.readiness.looks_ready).toBe(false);
    expect(event.readiness.reasons).toContain("PR is a draft");
  });

  test("not-ready to not-ready emits no readiness transition", () => {
    const previous = snap({ isDraft: true });
    const next = snap({ mergeStateStatus: "BEHIND" });

    expect(
      eventTypes(diffSnapshots(previous, next)).filter((type) =>
        ["ready", "readiness_lost"].includes(type),
      ),
    ).toEqual([]);
  });

  test("first not-ready poll still emits only watch_started", () => {
    const events = diffSnapshots(null, snap({ isDraft: true }));

    expect(eventTypes(events)).toEqual(["watch_started"]);
  });

  test("baseline, serialization, slugging, and cumulative seen state are deterministic", () => {
    const initial = snap({ comments: [issueComment({ id: "IC_OLD" })] });
    const next = snap({ comments: [issueComment({ id: "IC_NEW" })] });

    const baseline = diffSnapshots(null, initial);
    expect(baseline).toHaveLength(1);
    expect(baseline[0].type).toBe("watch_started");
    expect(baseline[0].summary.comments).toBe(1);

    const state = nextSeenState(initial, next);
    expect(state.seenCommentIds).toContain("IC_OLD");
    expect(state.seenCommentIds).toContain("IC_NEW");
    expect(diffSnapshots(state, next)).toEqual([]);

    expect(prSlug("https://github.com/Owner/My_Repo/pull/42")).toBe(
      "owner-my-repo-42",
    );
    expect(serializeEvent({ type: "ready", number: 42 })).toBe(
      '{"type":"ready","number":42}',
    );
  });
});

describe("pr-watch injected effects and commands", () => {
  test("snapshot command uses injected gh runner and prints normalized readiness", async () => {
    const lines = [];
    const ghRunner = ghSequence([{ raw: rawSnapshot(), threads: [] }]);

    const result = await snapshotPr(
      "https://github.com/acme/widget/pull/7",
      { ghRunner, stdout: (line) => lines.push(line) },
    );

    expect(result.number).toBe(7);
    expect(lines).toHaveLength(1);
    const printed = JSON.parse(lines[0]);
    expect(printed.snapshot.checks[0].status).toBe("green");
    expect(printed.readiness).toEqual({ looks_ready: true, reasons: [] });
  });

  test("watch loop atomically persists state, mirrors NDJSON, sleeps, and exits on merge", async () => {
    const fsApi = new MemoryFs();
    const lines = [];
    const sleeps = [];
    const ghRunner = ghSequence([
      { raw: rawSnapshot(), threads: [] },
      { raw: rawSnapshot({ state: "MERGED" }), threads: [] },
    ]);

    const exitCode = await watchPr(
      "https://github.com/acme/widget/pull/7",
      {
        ghRunner,
        fsApi,
        stateRoot: "/state",
        clock: () => 1_000,
        sleep: async (milliseconds) => sleeps.push(milliseconds),
        stdout: (line) => lines.push(line),
        intervalSeconds: 120,
      },
    );

    expect(exitCode).toBe(0);
    expect(lines.map((line) => JSON.parse(line).type)).toEqual([
      "watch_started",
      "readiness_lost",
      "merged",
    ]);
    expect(sleeps).toEqual([120_000]);
    expect(
      fsApi.operations.some(
        (operation) =>
          operation[0] === "rename" &&
          operation[1].endsWith(".state.json.tmp") &&
          operation[2].endsWith(".state.json"),
      ),
    ).toBe(true);
    const state = JSON.parse(
      fsApi.files.get("/state/acme-widget-7.state.json"),
    );
    expect(state.state).toBe("MERGED");
    expect(fsApi.files.get("/state/acme-widget-7.log")).toBe(
      `${lines.join("\n")}\n`,
    );
  });

  test("watch loop survives poll errors and emits heartbeat after 15 quiet minutes", async () => {
    const fsApi = new MemoryFs();
    const lines = [];
    let now = 0;
    const ghRunner = ghSequence([
      { error: "temporary gh failure" },
      { raw: rawSnapshot(), threads: [] },
      { raw: rawSnapshot(), threads: [] },
      { raw: rawSnapshot({ state: "CLOSED" }), threads: [] },
    ]);

    const exitCode = await watchPr(
      "https://github.com/acme/widget/pull/7",
      {
        ghRunner,
        fsApi,
        stateRoot: "/state",
        clock: () => now,
        sleep: async () => {
          now += 901_000;
        },
        stdout: (line) => lines.push(line),
        intervalSeconds: 1,
      },
    );

    expect(exitCode).toBe(0);
    expect(lines.map((line) => JSON.parse(line).type)).toEqual([
      "poll_error",
      "watch_started",
      "heartbeat",
      "readiness_lost",
      "closed",
    ]);
  });

  test("watch loop treats a timed-out gh call as poll_error and continues", async () => {
    const fsApi = new MemoryFs();
    const lines = [];
    const sleeps = [];
    const runnerOptions = [];
    const successfulRunner = ghSequence([
      { raw: rawSnapshot({ state: "MERGED" }), threads: [] },
    ]);
    let firstCall = true;
    const ghRunner = async (args, options) => {
      runnerOptions.push(options);
      if (firstCall) {
        firstCall = false;
        return {
          exitCode: null,
          signalCode: "SIGTERM",
          success: false,
          stdout: "",
          stderr: "timed out",
        };
      }
      return successfulRunner(args);
    };

    const exitCode = await watchPr(
      "https://github.com/acme/widget/pull/7",
      {
        ghRunner,
        ghTimeoutMs: 123,
        fsApi,
        stateRoot: "/state",
        clock: () => 1_000,
        sleep: async (milliseconds) => sleeps.push(milliseconds),
        stdout: (line) => lines.push(line),
        intervalSeconds: 1,
      },
    );

    expect(exitCode).toBe(0);
    expect(lines.map((line) => JSON.parse(line).type)).toEqual([
      "poll_error",
      "watch_started",
      "merged",
    ]);
    expect(JSON.parse(lines[0]).error).toContain("timed out");
    expect(sleeps).toEqual([1_000]);
    expect(runnerOptions).toEqual([
      { timeout: 123 },
      { timeout: 123 },
      { timeout: 123 },
    ]);
  });

  test("watch loop refuses a second live lock without polling", async () => {
    const lockPath = "/state/acme-widget-7.lock";
    const fsApi = new MemoryFs({
      [lockPath]: JSON.stringify({
        pid: 4242,
        startedAt: "2026-07-21T00:00:00.000Z",
      }),
    });
    const runner = ghSequence([
      { raw: rawSnapshot({ state: "MERGED" }), threads: [] },
    ]);
    let ghCalls = 0;

    await expect(
      watchPr("https://github.com/acme/widget/pull/7", {
        ghRunner: async (...args) => {
          ghCalls += 1;
          return runner(...args);
        },
        fsApi,
        stateRoot: "/state",
        clock: () => 1_000,
        sleep: async () => {},
        stdout: () => {},
        intervalSeconds: 1,
        isPidAlive: (pid) => pid === 4242,
      }),
    ).rejects.toThrow("already watching acme-widget-7 (pid 4242)");

    expect(ghCalls).toBe(0);
    expect(JSON.parse(fsApi.files.get(lockPath)).pid).toBe(4242);
  });

  test("watch loop takes over a stale lock and records a fresh owner", async () => {
    const lockPath = "/state/acme-widget-7.lock";
    const fsApi = new MemoryFs({
      [lockPath]: JSON.stringify({
        pid: 4242,
        startedAt: "2026-07-21T00:00:00.000Z",
      }),
    });
    const lines = [];
    let checkedPid = null;

    const exitCode = await watchPr(
      "https://github.com/acme/widget/pull/7",
      {
        ghRunner: ghSequence([
          { raw: rawSnapshot({ state: "MERGED" }), threads: [] },
        ]),
        fsApi,
        stateRoot: "/state",
        clock: () => 1_000,
        sleep: async () => {},
        stdout: (line) => lines.push(line),
        intervalSeconds: 1,
        isPidAlive: (pid) => {
          checkedPid = pid;
          return false;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(checkedPid).toBe(4242);
    expect(lines.map((line) => JSON.parse(line).type)).toEqual([
      "watch_started",
      "merged",
    ]);
    const lockWrite = fsApi.operations.find(
      (operation) => operation[0] === "write" && operation[1] === lockPath,
    );
    expect(JSON.parse(lockWrite[2])).toEqual({
      pid: process.pid,
      startedAt: new Date(1_000).toISOString(),
    });
  });

  test("terminal watch exit removes its lock file", async () => {
    const lockPath = "/state/acme-widget-7.lock";
    const fsApi = new MemoryFs();

    await watchPr("https://github.com/acme/widget/pull/7", {
      ghRunner: ghSequence([
        { raw: rawSnapshot({ state: "CLOSED" }), threads: [] },
      ]),
      fsApi,
      stateRoot: "/state",
      clock: () => 1_000,
      sleep: async () => {},
      stdout: () => {},
      intervalSeconds: 1,
      isPidAlive: () => {
        throw new Error("liveness should not be checked without an old lock");
      },
    });

    expect(fsApi.files.has(lockPath)).toBe(false);
    expect(fsApi.operations).toContainEqual(["unlink", lockPath]);
  });

  test("exceptional watch exit also removes its lock file", async () => {
    const lockPath = "/state/acme-widget-7.lock";
    const fsApi = new MemoryFs();

    await expect(
      watchPr("https://github.com/acme/widget/pull/7", {
        ghRunner: ghSequence([{ raw: rawSnapshot(), threads: [] }]),
        fsApi,
        stateRoot: "/state",
        clock: () => 1_000,
        sleep: async () => {},
        stdout: () => {
          throw new Error("output failed");
        },
        intervalSeconds: 1,
        isPidAlive: () => {
          throw new Error("liveness should not be checked without an old lock");
        },
      }),
    ).rejects.toThrow("output failed");

    expect(fsApi.files.has(lockPath)).toBe(false);
    expect(fsApi.operations).toContainEqual(["unlink", lockPath]);
  });

  test("status lists persisted watches with age and open state", () => {
    const fsApi = new MemoryFs({
      "/state/acme-widget-7.state.json": JSON.stringify({
        state: "OPEN",
        lastPollAt: new Date(900_000).toISOString(),
      }),
      "/state/other-repo-8.state.json": JSON.stringify({
        state: "MERGED",
        lastPollAt: new Date(500_000).toISOString(),
      }),
    });
    const lines = [];

    const statuses = statusPr({
      fsApi,
      stateRoot: "/state",
      clock: () => 1_000_000,
      stdout: (line) => lines.push(line),
    });

    expect(statuses).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      slug: "acme-widget-7",
      age_seconds: 100,
      open: true,
    });
    expect(JSON.parse(lines[1]).open).toBe(false);
  });

  test("poll interval accepts only positive integers and defaults to 120", () => {
    const warnings = [];

    expect(parseInterval("15", (warning) => warnings.push(warning))).toBe(15);
    expect(parseInterval("0", (warning) => warnings.push(warning))).toBe(120);
    expect(parseInterval("1.5", (warning) => warnings.push(warning))).toBe(120);
    expect(parseInterval(undefined, (warning) => warnings.push(warning))).toBe(
      120,
    );
    expect(warnings).toHaveLength(2);
  });
});
