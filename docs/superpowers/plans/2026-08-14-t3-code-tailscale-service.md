# T3 Code Tailscale Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Debian T3 Code server setup create a durable, private Tailscale Serve endpoint while keeping T3 bound to loopback.

**Architecture:** Extend the existing dependency-injectable T3 helper with a focused Tailscale lifecycle helper. The helper installs and verifies the vendor `tailscaled.service`, authenticates only when needed, and grants a validated non-root service owner operator access; the outer flow then delegates pairing and Serve configuration to upstream T3 commands without capturing credentials.

**Tech Stack:** Bun, JavaScript ES modules, Bun test, systemd, Tailscale CLI, T3 Code CLI, Biome

## Global Constraints

- T3 Code must remain bound to `127.0.0.1:3773`.
- Never open port 3773, change firewall rules, configure Funnel, or add a public fallback.
- Use the vendor `tailscaled.service` and T3 Code's upstream user service; do not create or replace systemd units.
- Accept Tailnet connectivity only when `tailscale status --json` reports `BackendState: "Running"`.
- Support root without `sudo` and ordinary sudo-capable users with a strictly validated Unix username.
- Never capture, parse, repeat, or log T3 pairing tokens.
- Preserve the existing Node engine requirement: `^22.16`, `^23.11`, or `>=24.10`.
- Both `haoshoku --server-t3-code` and normal Debian setup must use `configureT3CodeServer()`.

---

### Task 1: Specify the Tailscale service lifecycle

**Files:**
- Modify: `tests/configure_t3_code_server.test.js`
- Modify: `src/helpers/configure_t3_code_server.js`

**Interfaces:**
- Consumes: `commandExists(command: string): Promise<boolean>` and `runCommand(command: string): Promise<boolean>` from `src/common/utils.js`.
- Produces: `parseTailscaleBackendState(output: string): string | null`, `isSafeUnixUsername(username: unknown): boolean`, and `ensureTailscaleService(options?): Promise<boolean>`.
- `ensureTailscaleService()` options are `commandExistsImpl`, `getBackendStateImpl`, `getUserContextImpl`, `runCommandImpl`, and `logger`.

- [x] **Step 1: Write failing parser, validation, root, installation, authentication, and non-root tests**

Add imports for the three produced functions, then add tests equivalent to:

```js
expect(parseTailscaleBackendState('{"BackendState":"Running"}')).toBe("Running");
expect(parseTailscaleBackendState("not-json")).toBeNull();
expect(isSafeUnixUsername("deploy-user")).toBe(true);
expect(isSafeUnixUsername("deploy; reboot")).toBe(false);

const rootCommands = [];
expect(await ensureTailscaleService({
  commandExistsImpl: async () => true,
  getBackendStateImpl: () => "Running",
  getUserContextImpl: () => ({ isRoot: true, username: null }),
  runCommandImpl: async (command) => { rootCommands.push(command); return true; },
  logger: silentLogger,
})).toBe(true);
expect(rootCommands).toEqual([
  "systemctl enable --now tailscaled",
  "systemctl is-enabled tailscaled",
  "systemctl is-active tailscaled",
]);
```

Add separate cases proving that a missing CLI runs the official installer before systemd, a disconnected root runs `tailscale up` once and is re-probed, a non-root user uses `sudo systemctl`, `sudo tailscale up`, and `sudo tailscale set --operator=deploy-user`, and root skips the operator command. Add table-driven failure cases for installer, enable/start, `is-enabled`, `is-active`, post-login connectivity, unsafe username, and operator command failures; assert that later stages are absent from each command list.

- [x] **Step 2: Run the focused test and confirm RED**

Run: `bun test tests/configure_t3_code_server.test.js`

Expected: FAIL because the new exports do not exist.

- [x] **Step 3: Implement parsing, user resolution, and the minimal Tailscale lifecycle**

Add constants for the official installer and Tailscale commands. Parse JSON defensively:

```js
export function parseTailscaleBackendState(output) {
  try {
    const state = JSON.parse(output)?.BackendState;
    return typeof state === "string" ? state : null;
  } catch {
    return null;
  }
}

export function isSafeUnixUsername(username) {
  return typeof username === "string" && /^[a-z_][a-z0-9_-]*\$?$/i.test(username);
}
```

Resolve root with `process.getuid?.() === 0`; for non-root, execute `id -un` through `Bun.spawnSync(["id", "-un"])`, decode stdout, and validate it before interpolation. Obtain backend state through `Bun.spawnSync(["tailscale", "status", "--json"])` and return `null` on nonzero exit.

Implement `ensureTailscaleService()` in this exact stage order: detect/install/recheck CLI, root-aware enable/start, verify enabled, verify active, probe state, root-aware `tailscale up` only when not running, re-probe, then set a validated non-root operator. Return `false` and log the concrete failing retry command at every boundary.

- [x] **Step 4: Run the focused tests and confirm GREEN**

Run: `bun test tests/configure_t3_code_server.test.js`

Expected: all Tailscale lifecycle and existing Node/T3 tests pass.

- [x] **Step 5: Commit the lifecycle deliverable**

```bash
git add tests/configure_t3_code_server.test.js src/helpers/configure_t3_code_server.js
git commit -m "feat: configure durable Tailscale service"
```

### Task 2: Pair T3 privately and verify Tailscale Serve

**Files:**
- Modify: `tests/configure_t3_code_server.test.js`
- Modify: `src/helpers/configure_t3_code_server.js`

**Interfaces:**
- Consumes: `ensureTailscaleService(options?): Promise<boolean>` from Task 1.
- Produces: `configureT3CodeServer({ ensureNodeImpl, ensureTailscaleImpl, runCommandImpl, logger }): Promise<boolean>` with ordered T3 install, T3 status, Tailscale preparation, pairing, and Serve verification.

- [x] **Step 1: Replace manual-pairing assertions with private-pairing tests**

Inject `ensureTailscaleImpl: async () => true` into outer-flow tests. Change the success command expectation to:

```js
expect(commands).toEqual([
  "npx --yes t3@latest service install",
  "npx --yes t3@latest service status",
  "npx --yes t3@latest pair --tailscale",
  "tailscale serve status",
]);
expect(messages.some((message) => message.includes("npx t3@latest pair"))).toBe(false);
expect(messages.some((message) => message.includes("key expiry"))).toBe(true);
```

Add tests proving Tailscale preparation failure prevents pairing, pairing failure prevents Serve verification and logs its exact retry command, and Serve failure returns false and logs `tailscale serve status`.

- [x] **Step 2: Run the focused test and confirm RED**

Run: `bun test tests/configure_t3_code_server.test.js`

Expected: FAIL because `configureT3CodeServer()` still prints manual pairing guidance and does not call the new stages.

- [x] **Step 3: Implement ordered private pairing and verification**

Add `ensureTailscaleImpl = ensureTailscaleService` to the injected dependencies. After T3 status succeeds, call it with `{ runCommandImpl, logger }`; stop on false. Then execute `npx --yes t3@latest pair --tailscale` and `tailscale serve status` in order, returning false and logging the exact retry command when either fails. On success, state that T3 and Tailscale are running persistently and remind unattended VPS operators to disable key expiry for this device or use an appropriately tagged server auth key.

- [x] **Step 4: Run the focused tests and confirm GREEN**

Run: `bun test tests/configure_t3_code_server.test.js`

Expected: all focused tests pass and no old manual pairing assertion remains.

- [x] **Step 5: Commit the integration deliverable**

```bash
git add tests/configure_t3_code_server.test.js src/helpers/configure_t3_code_server.js
git commit -m "feat: pair T3 through Tailscale Serve"
```

### Task 3: Document and track the durable private server setup

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `src/helpers/CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-08-14-t3-code-implementation.html`

**Interfaces:**
- Consumes: the behavior implemented by Tasks 1 and 2.
- Produces: operator instructions and a completed develop-feature progress artifact.

- [x] **Step 1: Update user and maintainer documentation**

Document that both Debian entry points install/enable `tailscaled`, authenticate interactively when required, preserve the loopback-only T3 listener, run upstream private pairing, verify Serve, and do not open a firewall port. Include the unattended VPS key-expiry/tagged-auth-key reminder. Add an `Unreleased` changelog entry and update the helper index description.

- [x] **Step 2: Update the HTML implementation tracker**

Replace the obsolete “No automatic pairing, Tailscale setup” constraint with the approved private-only constraints. Add rows for lifecycle tests, implementation, private pairing, documentation, and release verification; set completed work to `complete` and release work to `active` until publication is verified.

- [x] **Step 3: Verify documentation consistency**

Run: `rg -n "Pair a client later|No automatic pairing|server-t3-code|tailscaled|key expiry|3773" README.md CHANGELOG.md src/helpers/CLAUDE.md docs/superpowers/plans/2026-08-14-t3-code-implementation.html`

Expected: no obsolete manual-pairing/no-Tailscale claims; both entry points, persistence, key expiry, and private-only behavior are present.

- [x] **Step 4: Commit the documentation deliverable**

```bash
git add README.md CHANGELOG.md src/helpers/CLAUDE.md docs/superpowers/plans/2026-08-14-t3-code-implementation.html
git commit -m "docs: explain private T3 server access"
```

### Task 4: Verify and publish the patch release

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-t3-code-implementation.html`
- Release tooling modifies version, changelog, lockfile, tag, and release metadata according to the repository's existing release script.

**Interfaces:**
- Consumes: all prior committed deliverables and the repository release script.
- Produces: a clean verified branch, patch tag, GitHub release, successful release workflow, and matching npm `latest` version.

- [x] **Step 1: Run fresh verification**

Run:

```bash
bun test tests/configure_t3_code_server.test.js
bun test
bunx biome check src/helpers/configure_t3_code_server.js tests/configure_t3_code_server.test.js
git diff --check
npm pack --dry-run
```

Expected: focused and full tests pass, scoped Biome and diff checks are clean, and the npm package dry run succeeds. If repository-wide lint is also run, record any pre-existing unrelated baseline findings separately.

- [x] **Step 2: Mark verification complete and commit the tracker**

Record the exact test counts and package evidence in the HTML tracker, set implementation verification to `complete`, and keep publication `active`.

```bash
git add docs/superpowers/plans/2026-08-14-t3-code-implementation.html
git commit -m "docs: record T3 Tailscale verification"
```

- [ ] **Step 3: Publish a patch release**

Run: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=push.default GIT_CONFIG_VALUE_0=upstream bun run release --bump=patch --yes`

Expected: the release script creates the next patch commit and tag, pushes stable, creates the GitHub release, and starts the npm publication workflow.

- [ ] **Step 4: Verify remote publication**

Use `git ls-remote`, `gh release view`, `gh run list/view`, and `npm view haoshoku version` to confirm the stable SHA, patch tag/release, successful workflow, and matching npm `latest` version.

- [ ] **Step 5: Record final publication evidence**

Update the HTML tracker publication row with the released version, tag, workflow status, npm version, and stable SHA. Commit and push only if this evidence is intentionally retained after the release commit; otherwise report it in the handoff without mutating the published tag.
