# Arch Package Database Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Arch setup fully synchronize and upgrade pacman before package work, stop on package-manager failure, and preserve an existing Rust toolchain.

**Architecture:** Add two small exported, dependency-injectable setup units to `src/os_scripts/cachyos.js`: one owns the pacman full-upgrade and essential dependency gate, and one owns conditional Rust installation. `runCachyOSSetup` calls the package gate first and returns `false` immediately on failure; all existing routing remains downstream of that gate.

**Tech Stack:** Bun, JavaScript ES modules, `bun:test`, Arch pacman.

## Global Constraints

- Use `sudo pacman -Syu --noconfirm`; never use a standalone `pacman -Sy` or unconditional `pacman -Syyu`.
- Do not edit pacman configuration, mirrors, keyrings, `/var/lib/pacman`, or the user's environment.
- Do not change package-list contents, AUR helper preference, or successful package-routing behavior.
- Do not continue to Rust, AUR, application, Flatpak, or configuration work when the package preflight fails.
- Preserve an existing Rust toolchain when both `rustc` and `cargo` are available.

---

### Task 1: Gate Arch setup behind a full pacman upgrade

**Files:**
- Modify: `tests/cachyos.test.js`
- Modify: `src/os_scripts/cachyos.js`

**Interfaces:**
- Produces: `prepareArchPackageManager({ runCommandImpl? }): Promise<boolean>`; returns `true` only after both the full upgrade and essential dependency installation succeed.
- Changes: `runCachyOSSetup({ prepareArchPackageManagerImpl? } = {}): Promise<boolean>`; returns `false` without starting later phases when the preflight fails and `true` after the full setup completes.

- [ ] **Step 1: Write failing preflight tests**

Add imports for `prepareArchPackageManager` and `runCachyOSSetup`, then add tests that exercise observable command ordering and the setup gate:

```js
describe("Arch package-manager preflight", () => {
	it("fully upgrades before installing essential build dependencies", async () => {
		const commands = [];
		const result = await prepareArchPackageManager({
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"sudo pacman -Syu --noconfirm",
			"sudo pacman -S --needed --noconfirm base-devel git",
		]);
	});

	it("does not install dependencies when the full upgrade fails", async () => {
		const commands = [];
		const result = await prepareArchPackageManager({
			runCommandImpl: async (command) => {
				commands.push(command);
				return false;
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual(["sudo pacman -Syu --noconfirm"]);
	});

	it("reports failure when essential dependencies cannot be installed", async () => {
		let attempt = 0;
		const result = await prepareArchPackageManager({
			runCommandImpl: async () => {
				attempt += 1;
				return attempt === 1;
			},
		});

		expect(result).toBe(false);
	});

	it("stops the full setup when package-manager preparation fails", async () => {
		let preflightCalls = 0;
		const result = await runCachyOSSetup({
			prepareArchPackageManagerImpl: async () => {
				preflightCalls += 1;
				return false;
			},
		});

		expect(result).toBe(false);
		expect(preflightCalls).toBe(1);
	});
});
```

Production mutations caught: replacing `-Syu` with `-Sy`, reversing command order, continuing after an upgrade failure, accepting a failed essential dependency install, or ignoring the gate in the full setup.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test tests/cachyos.test.js`

Expected: FAIL because `prepareArchPackageManager` is not exported and `runCachyOSSetup` does not accept or enforce the injected preflight.

- [ ] **Step 3: Implement the minimal package-manager gate**

Replace `installBaseDependencies` with an exported function that owns only pacman preparation:

```js
export async function prepareArchPackageManager({
	runCommandImpl = runCommand,
} = {}) {
	log.info("Refreshing package databases and performing a full system upgrade...");
	if (!(await runCommandImpl("sudo pacman -Syu --noconfirm"))) {
		log.error(
			"Pacman refresh and full upgrade failed. Aborting Arch setup before package installation.",
		);
		return false;
	}

	log.info("Installing base-devel and git (required for makepkg / AUR builds)...");
	if (
		!(await runCommandImpl(
			"sudo pacman -S --needed --noconfirm base-devel git",
		))
	) {
		log.error(
			"base-devel/git installation failed. Aborting Arch setup before AUR package installation.",
		);
		return false;
	}
	return true;
}
```

Change the beginning and end of the full setup without altering the order of downstream phases:

```js
export async function runCachyOSSetup({
	prepareArchPackageManagerImpl = prepareArchPackageManager,
} = {}) {
	if (!(await prepareArchPackageManagerImpl())) return false;
	log.info("Installing Rust via rustup...");
	await withSpinner("Installing Rust", () =>
		runCommand(`curl ${RUSTUP_URL} -sSf | sh -s -- -y`),
	);
	const aurHelper = await ensureAurHelper();
	await installDevTools();

	const isOmarchy = await commandExists("omarchy");
	await installSystemPackages(aurHelper, isOmarchy);
	await installFlatpakApps();
	await configureUserApps();
	if (isOmarchy) await configureOmarchyMonitors();
	if (isOmarchy) await configureOmarchyWorkspaces();
	if (isOmarchy) await configureOmazed();

	log.success("Arch setup finished. Please restart your terminal or log out.");
	return true;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `bun test tests/cachyos.test.js`

Expected: PASS, including all existing routing and gaming tests.

- [ ] **Step 5: Commit the package gate**

```bash
git add src/os_scripts/cachyos.js tests/cachyos.test.js
git commit -m "fix: gate Arch setup on full pacman upgrade"
```

---

### Task 2: Preserve an existing Rust toolchain

**Files:**
- Modify: `tests/cachyos.test.js`
- Modify: `src/os_scripts/cachyos.js`

**Interfaces:**
- Produces: `ensureRustToolchain({ commandExistsImpl?, runCommandImpl?, withSpinnerImpl? }): Promise<boolean>`; returns `true` when Rust already exists or rustup succeeds, otherwise `false`.
- Consumes: the successful package-manager gate from Task 1; `runCachyOSSetup` invokes Rust preparation only after that gate.

- [ ] **Step 1: Write failing Rust preservation tests**

Import `ensureRustToolchain` and add:

```js
describe("Rust toolchain preparation", () => {
	it("preserves Rust when rustc and cargo are already available", async () => {
		const commands = [];
		const result = await ensureRustToolchain({
			commandExistsImpl: async (command) =>
				command === "rustc" || command === "cargo",
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			withSpinnerImpl: async (_label, operation) => operation(),
		});

		expect(result).toBe(true);
		expect(commands).toEqual([]);
	});

	it("installs Rust when either required command is missing", async () => {
		const commands = [];
		const result = await ensureRustToolchain({
			commandExistsImpl: async (command) => command === "rustc",
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			withSpinnerImpl: async (_label, operation) => operation(),
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"curl https://sh.rustup.rs -sSf | sh -s -- -y",
		]);
	});
});
```

Production mutations caught: checking only one Rust command, reinstalling over an existing complete toolchain, or failing to invoke rustup for an incomplete toolchain.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun test tests/cachyos.test.js`

Expected: FAIL because `ensureRustToolchain` is not exported.

- [ ] **Step 3: Implement conditional Rust setup**

Add the focused function after the package-manager gate:

```js
export async function ensureRustToolchain({
	commandExistsImpl = commandExists,
	runCommandImpl = runCommand,
	withSpinnerImpl = withSpinner,
} = {}) {
	if (
		(await commandExistsImpl("rustc")) &&
		(await commandExistsImpl("cargo"))
	) {
		log.info("Rust is already installed.");
		return true;
	}

	log.info("Installing Rust via rustup...");
	return Boolean(
		await withSpinnerImpl("Installing Rust", () =>
			runCommandImpl(`curl ${RUSTUP_URL} -sSf | sh -s -- -y`),
		),
	);
}
```

Replace the inline rustup block immediately after the successful preflight in
`runCachyOSSetup` with `await ensureRustToolchain();`, before AUR helper
resolution. Preserve current behavior by allowing a Rust installation failure
to remain non-fatal; the package-manager gate is the only new hard stop.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `bun test tests/cachyos.test.js`

Expected: PASS.

- [ ] **Step 5: Commit Rust preservation**

```bash
git add src/os_scripts/cachyos.js tests/cachyos.test.js
git commit -m "fix: preserve existing Rust toolchain"
```

---

### Task 3: Document and verify the corrected Arch workflow

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the user-visible package preflight and abort behavior implemented in Task 1.
- Produces: documentation stating that the Arch setup performs a full pacman upgrade before installing packages.

- [ ] **Step 1: Update the Arch behavior documentation**

Add this as the first bullet under `## Arch and Omarchy behavior`:

```markdown
- refreshes pacman repositories and performs a full system upgrade before any
  package installation, aborting setup if that preflight fails;
```

No automated test is required for human prose; source-text assertions would not test runtime behavior.

- [ ] **Step 2: Run focused and complete verification**

Run:

```bash
bun test tests/cachyos.test.js
bun test
bun run lint
git diff --check
```

Expected: every command exits `0`, all tests pass, lint reports no errors, and `git diff --check` produces no output.

- [ ] **Step 3: Inspect scope**

Run:

```bash
git status --short
git diff -- README.md src/os_scripts/cachyos.js tests/cachyos.test.js
```

Expected: only the three planned files contain uncommitted implementation changes; no pacman, mirror, environment, or package-list files changed.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain Arch package preflight"
```
