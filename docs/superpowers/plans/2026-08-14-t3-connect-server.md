# T3 Connect Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Haoshoku's Debian T3/Tailscale setup with an idempotent, headless T3 Connect workflow and publish the resulting patch release.

**Architecture:** Keep the existing Node.js gate and upstream T3 user-service lifecycle. Add a small JSON status adapter plus a dependency-injectable Connect orchestrator that authorizes only when needed, restarts the service, polls persisted readiness, and never invokes Tailscale. Preserve the shared `configureT3CodeServer()` entry point used by the standalone flag and full Debian setup.

**Tech Stack:** JavaScript ES modules, Bun runtime/test runner, Commander CLI, Biome, upstream `t3` CLI, systemd user services.

## Global Constraints

- T3 remains bound to `127.0.0.1:3773`; do not alter Nginx, DNS, UFW, or another firewall.
- Execute no Tailscale command from either Debian T3 setup entry point.
- Use `npx --yes t3@latest connect link --headless` for attached authorization; never capture authorization codes.
- Treat intentional root execution as a root-owned systemd user service; do not introduce a dedicated account.
- Let T3 own cloudflared installation and lifecycle.
- Do not automatically remove a legacy Tailscale Serve handler.
- Preserve the dirty primary checkout; all work stays in `/home/xzat/dev/Haoshoku-t3-connect`.
- Use TDD for every production behavior change.

---

### Task 1: Define and parse T3 Connect status

**Files:**
- Modify: `tests/configure_t3_code_server.test.js`
- Modify: `src/helpers/configure_t3_code_server.js`

**Interfaces:**
- Produces: `parseT3ConnectStatus(output: string): T3ConnectStatus | null`
- Produces: `isT3ConnectReady(status: T3ConnectStatus | null): boolean`
- Produces: `canResumeT3Connect(status: T3ConnectStatus | null): boolean`
- `T3ConnectStatus` contains only `desired`, `authenticated`, `linked`, `relayUrl`, and `relayClientAvailable`; it excludes identifiers and activity data.

- [ ] **Step 1: Replace the old Tailscale parser tests with failing Connect parser tests**

```js
import {
	canResumeT3Connect,
	isT3ConnectReady,
	parseT3ConnectStatus,
} from "../src/helpers/configure_t3_code_server.js";

const readyJson = JSON.stringify({
	desired: true,
	authenticated: true,
	linked: true,
	cloudUserId: "must-not-be-retained",
	relayUrl: "https://relay.t3.codes",
	publishAgentActivity: false,
	relayClient: { status: "available", source: "managed" },
});

it("parses only readiness fields from T3 Connect JSON", () => {
	expect(parseT3ConnectStatus(readyJson)).toEqual({
		desired: true,
		authenticated: true,
		linked: true,
		relayUrl: "https://relay.t3.codes",
		relayClientAvailable: true,
	});
});

it("distinguishes ready and resumable pending states", () => {
	const ready = parseT3ConnectStatus(readyJson);
	const pending = parseT3ConnectStatus(JSON.stringify({
		desired: true,
		authenticated: true,
		linked: false,
		relayUrl: null,
		relayClient: { status: "available" },
	}));
	expect(isT3ConnectReady(ready)).toBe(true);
	expect(isT3ConnectReady(pending)).toBe(false);
	expect(canResumeT3Connect(pending)).toBe(true);
});

it("rejects malformed and structurally invalid status", () => {
	for (const output of ["", "not-json", "[]", "{}", '{"desired":"yes"}']) {
		expect(parseT3ConnectStatus(output)).toBeNull();
	}
});
```

- [ ] **Step 2: Run the focused parser tests and verify RED**

Run: `bun test tests/configure_t3_code_server.test.js`

Expected: FAIL because the three Connect helpers are not exported.

- [ ] **Step 3: Implement the minimum parser and predicates**

```js
export function parseT3ConnectStatus(output) {
	try {
		const value = JSON.parse(output);
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		if (
			typeof value.desired !== "boolean" ||
			typeof value.authenticated !== "boolean" ||
			typeof value.linked !== "boolean"
		) return null;
		return {
			desired: value.desired,
			authenticated: value.authenticated,
			linked: value.linked,
			relayUrl: typeof value.relayUrl === "string" ? value.relayUrl : null,
			relayClientAvailable: value.relayClient?.status === "available",
		};
	} catch {
		return null;
	}
}

export function isT3ConnectReady(status) {
	return Boolean(status?.desired && status.authenticated && status.linked &&
		status.relayUrl?.trim() && status.relayClientAvailable);
}

export function canResumeT3Connect(status) {
	return Boolean(status?.desired && status.authenticated && status.relayClientAvailable);
}
```

- [ ] **Step 4: Run the focused suite and verify GREEN**

Run: `bun test tests/configure_t3_code_server.test.js`

Expected: parser tests pass; legacy Tailscale lifecycle tests still pass until Task 2 removes them.

- [ ] **Step 5: Commit the parser slice**

```bash
git add src/helpers/configure_t3_code_server.js tests/configure_t3_code_server.test.js
git commit -m "feat: parse T3 Connect readiness"
```

---

### Task 2: Replace Tailscale orchestration with T3 Connect

**Files:**
- Modify: `tests/configure_t3_code_server.test.js`
- Modify: `src/helpers/configure_t3_code_server.js`

**Interfaces:**
- Consumes: `parseT3ConnectStatus`, `isT3ConnectReady`, and `canResumeT3Connect` from Task 1.
- Produces: `readT3ConnectStatus(): T3ConnectStatus | null` using `Bun.spawnSync` and `connect status --json`.
- Produces: `ensureT3Connect(options): Promise<boolean>` with injected `getConnectStatusImpl`, `runCommandImpl`, `sleepImpl`, `maxAttempts`, and `logger`.
- Preserves: `configureT3CodeServer(options): Promise<boolean>` as the public entry point, forwarding `getConnectStatusImpl`, `sleepImpl`, and `maxConnectAttempts` into `ensureT3Connect`.

- [ ] **Step 1: Delete Tailscale-only test imports and lifecycle cases**

Remove tests for `ensureTailscaleService`, `parseTailscaleBackendState`, and `isSafeUnixUsername`. Keep Node runtime coverage unchanged.

- [ ] **Step 2: Write failing idempotency and pending-resume tests**

```js
const readyStatus = {
	desired: true,
	authenticated: true,
	linked: true,
	relayUrl: "https://relay.t3.codes",
	relayClientAvailable: true,
};

const pendingStatus = {
	...readyStatus,
	linked: false,
	relayUrl: null,
};

it("keeps an already-ready Connect environment without relinking or restarting", async () => {
	const commands = [];
	const result = await configureT3CodeServer({
		ensureNodeImpl: async () => true,
		getConnectStatusImpl: async () => readyStatus,
		runCommandImpl: async (command) => (commands.push(command), true),
		logger: silentLogger,
	});
	expect(result).toBe(true);
	expect(commands).toEqual([
		"npx --yes t3@latest service install",
		"npx --yes t3@latest service status",
	]);
});

it("restarts a previously authorized pending environment without relinking", async () => {
	const commands = [];
	const statuses = [pendingStatus, readyStatus];
	const result = await configureT3CodeServer({
		ensureNodeImpl: async () => true,
		getConnectStatusImpl: async () => statuses.shift() ?? readyStatus,
		runCommandImpl: async (command) => (commands.push(command), true),
		sleepImpl: async () => {},
		logger: silentLogger,
	});
	expect(result).toBe(true);
	expect(commands).not.toContain("npx --yes t3@latest connect link --headless");
	expect(commands).toContain("systemctl --user restart t3code.service");
});
```

- [ ] **Step 3: Write failing fresh-link and polling tests**

```js
it("links headlessly, restarts, polls, and verifies the service", async () => {
	const commands = [];
	const statuses = [null, pendingStatus, readyStatus];
	const result = await configureT3CodeServer({
		ensureNodeImpl: async () => true,
		getConnectStatusImpl: async () => statuses.shift() ?? readyStatus,
		runCommandImpl: async (command) => (commands.push(command), true),
		sleepImpl: async () => {},
		logger: silentLogger,
	});
	expect(result).toBe(true);
	expect(commands).toEqual([
		"npx --yes t3@latest service install",
		"npx --yes t3@latest service status",
		"npx --yes t3@latest connect link --headless",
		"npx --yes t3@latest service update",
		"systemctl --user restart t3code.service",
		"npx --yes t3@latest service status",
	]);
});
```

- [ ] **Step 4: Write failing boundary tests**

```js
it("stops at each Connect command failure boundary", async () => {
	for (const failingCommand of [
		"npx --yes t3@latest connect link --headless",
		"npx --yes t3@latest service update",
		"systemctl --user restart t3code.service",
	]) {
		const commands = [];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			getConnectStatusImpl: async () => null,
			runCommandImpl: async (command) => {
				commands.push(command);
				return command !== failingCommand;
			},
			sleepImpl: async () => {},
			logger: silentLogger,
		});
		expect(result).toBe(false);
		expect(commands.at(-1)).toBe(failingCommand);
		expect(commands.some((command) => command.includes("tailscale"))).toBe(false);
	}
});

it("times out when the environment never becomes ready", async () => {
	const errors = [];
	const result = await configureT3CodeServer({
		ensureNodeImpl: async () => true,
		getConnectStatusImpl: async () => pendingStatus,
		runCommandImpl: async () => true,
		sleepImpl: async () => {},
		maxConnectAttempts: 2,
		logger: { ...silentLogger, error: (message) => errors.push(message) },
	});
	expect(result).toBe(false);
	expect(errors.at(-1)).toContain("npx --yes t3@latest connect status");
});

it("fails when the provisioned service cannot be verified", async () => {
	const commands = [];
	const statuses = [pendingStatus, readyStatus];
	const result = await configureT3CodeServer({
		ensureNodeImpl: async () => true,
		getConnectStatusImpl: async () => statuses.shift() ?? readyStatus,
		runCommandImpl: async (command) => {
			commands.push(command);
			return commands.filter((item) => item.endsWith("service status")).length < 2;
		},
		sleepImpl: async () => {},
		logger: silentLogger,
	});
	expect(result).toBe(false);
	expect(commands.at(-1)).toBe("npx --yes t3@latest service status");
});
```

- [ ] **Step 5: Run the focused tests and verify RED**

Run: `bun test tests/configure_t3_code_server.test.js`

Expected: FAIL because Connect orchestration is absent and current commands still contain Tailscale.

- [ ] **Step 6: Implement the captured status adapter**

```js
const T3_CONNECT_STATUS_ARGS = [
	"npx", "--yes", "t3@latest", "connect", "status", "--json",
];

function readT3ConnectStatus() {
	const result = Bun.spawnSync(T3_CONNECT_STATUS_ARGS, {
		stderr: "ignore",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) return null;
	return parseT3ConnectStatus(new TextDecoder().decode(result.stdout).trim());
}
```

- [ ] **Step 7: Implement the minimum Connect orchestrator**

Use constants for these exact commands:

```js
const T3_CONNECT_LINK_COMMAND = "npx --yes t3@latest connect link --headless";
const T3_SERVICE_UPDATE_COMMAND = "npx --yes t3@latest service update";
const T3_SERVICE_RESTART_COMMAND = "systemctl --user restart t3code.service";
const T3_CONNECT_STATUS_COMMAND = "npx --yes t3@latest connect status";
```

The function must return immediately for ready state, skip linking for resumable pending state, otherwise link, update, restart, poll at two-second intervals for at most 30 attempts, and run final service status only after readiness.

- [ ] **Step 8: Remove every Tailscale helper, constant, import, and message**

`src/helpers/configure_t3_code_server.js` must no longer import `commandExists` or contain `tailscale`, `Tailnet`, pairing, key-expiry, username, or operator logic.

- [ ] **Step 9: Run focused tests and verify GREEN**

Run: `bun test tests/configure_t3_code_server.test.js tests/cli_server_t3_code_flag.test.js tests/debian_server.test.js`

Expected: all tests pass and no test command invokes the host's T3 or systemd services.

- [ ] **Step 10: Commit the orchestration slice**

```bash
git add src/helpers/configure_t3_code_server.js tests/configure_t3_code_server.test.js
git commit -m "feat: configure T3 Connect on Debian servers"
```

---

### Task 3: Update user-facing contracts and progress tracking

**Files:**
- Modify: `tests/haoshoku_help.test.js`
- Modify: `haoshoku.js`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `src/helpers/CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-08-14-t3-code-implementation.html`

**Interfaces:**
- Consumes: the T3 Connect lifecycle from Task 2.
- Produces: CLI help and documentation that describe T3 Connect as the only default Debian remote-access method.

- [ ] **Step 1: Add a failing CLI/help regression assertion**

```js
it("documents T3 Connect as the Debian server access path", () => {
	const help = output(["--help"]);
	expect(help).toContain("T3 Connect");
	expect(help).not.toContain("Tailscale");
});
```

- [ ] **Step 2: Run the help test and verify RED**

Run: `bun test tests/haoshoku_help.test.js`

Expected: FAIL because the current option only says “headless server service”.

- [ ] **Step 3: Update the CLI description**

Change the `--server-t3-code` description to:

```text
Configure the T3 Code headless service and T3 Connect on Debian
```

- [ ] **Step 4: Rewrite Debian documentation and add the unreleased changelog entry**

README must document the headless authorization, service restart, managed relay, phone sign-in, loopback-only boundary, idempotent reruns, root ownership semantics, and conditional legacy Serve cleanup. Add an `Unreleased` changelog entry describing replacement of mandatory Tailscale with T3 Connect; the release script will convert it to the patch version.

- [ ] **Step 5: Update helper ownership documentation and the HTML artifact**

Replace Tailscale wording in `src/helpers/CLAUDE.md`. Add a “T3 Connect replacement” table to the HTML tracker with current per-task status and evidence, link the new design and Markdown plan, and retain earlier Tailscale sections as historical release evidence.

- [ ] **Step 6: Run documentation-focused tests and verify GREEN**

Run: `bun test tests/haoshoku_help.test.js tests/cli_server_t3_code_flag.test.js tests/default_run_reachability.test.js`

Expected: all pass.

- [ ] **Step 7: Commit the user-facing slice**

```bash
git add haoshoku.js README.md CHANGELOG.md src/helpers/CLAUDE.md tests/haoshoku_help.test.js docs/superpowers/plans/2026-08-14-t3-code-implementation.html
git commit -m "docs: make T3 Connect the Debian default"
```

---

### Task 4: Verify and review the release candidate

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-t3-code-implementation.html`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a clean, evidence-backed candidate ready for stable integration.

- [ ] **Step 1: Run focused T3 and CLI tests**

Run: `bun test tests/configure_t3_code_server.test.js tests/cli_server_t3_code_flag.test.js tests/debian_server.test.js tests/haoshoku_help.test.js tests/default_run_reachability.test.js`

Expected: zero failures.

- [ ] **Step 2: Run scoped Biome checks**

Run: `bunx biome check src/helpers/configure_t3_code_server.js tests/configure_t3_code_server.test.js haoshoku.js tests/haoshoku_help.test.js`

Expected: zero errors and warnings in changed JavaScript.

- [ ] **Step 3: Run repository integrity checks**

Run: `git diff --check origin/stable...HEAD`

Run: `rg -n "tailscale|Tailnet|pair --tailscale" src/helpers/configure_t3_code_server.js`

Run: `rg -n "ensureTailscaleService|parseTailscaleBackendState|isSafeUnixUsername" tests/configure_t3_code_server.test.js`

Expected: diff check exits zero; both static searches return no matches. Negative
test assertions may still contain the lowercase word `tailscale` to prove no
such command was executed.

- [ ] **Step 4: Run the full test suite**

Run: `bun test`

Expected: zero failures; record pass and skip counts.

- [ ] **Step 5: Verify package contents**

Run: `npm pack --dry-run`

Expected: exit zero and all changed runtime/documentation files included as intended.

- [ ] **Step 6: Review the exact candidate diff inline**

Inspect `git diff origin/stable...HEAD`, check every acceptance criterion, and resolve material findings. Subagent review is unavailable unless the user explicitly authorizes delegation, so do not claim an external reviewer.

- [ ] **Step 7: Update and commit verification evidence**

Update the HTML tracker with exact focused/full test counts, Biome, diff, package, and review status.

```bash
git add docs/superpowers/plans/2026-08-14-t3-code-implementation.html
git commit -m "docs: record T3 Connect verification"
```

---

### Task 5: Integrate and publish the patch release

**Files:**
- Release script updates versioned files automatically.

**Interfaces:**
- Consumes: verified feature branch from Task 4.
- Produces: updated `stable`, annotated version tag, GitHub release, successful Actions workflow, and npm `latest` package.

- [ ] **Step 1: Fetch and verify the remote stable tip**

Run: `git fetch origin stable --tags`

Expected: `origin/stable` remains the branch base or any new commits are reviewed and integrated before release.

- [ ] **Step 2: Fast-forward remote stable from the clean feature worktree**

Run:

```bash
git merge-base --is-ancestor origin/stable HEAD
git push origin HEAD:stable
```

Expected: the ancestry check and push both exit zero. The dirty primary checkout remains untouched; do not force-push or rewrite history.

- [ ] **Step 3: Run the release command**

Run:

```bash
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=push.default \
GIT_CONFIG_VALUE_0=upstream \
bun run release --bump=patch --yes
```

Expected: version advances from `8.5.3` to `8.5.4`, changelog is finalized, release commit and tag are created, and publication workflow is triggered.

- [ ] **Step 4: Verify GitHub publication**

Confirm remote `stable`, tag `v8.5.4`, GitHub release `v8.5.4`, and the associated Actions run all point to the intended release commit and complete successfully.

- [ ] **Step 5: Verify npm publication**

Run: `npm view haoshoku version`

Expected: `8.5.4`.

- [ ] **Step 6: Complete the goal only after every publication check passes**

Record exact SHAs, test counts, release URL, workflow result, and npm version. If any remote step fails, keep the goal active and diagnose the exact boundary.
