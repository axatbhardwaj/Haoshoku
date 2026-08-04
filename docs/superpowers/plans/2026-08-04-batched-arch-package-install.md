# Batched Arch Package Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install normal Arch and AUR package sets in fast batches while filtering invalid/missing targets and falling back individually for only the packages still absent after a failed batch.

**Architecture:** Add a small pure package-list normalizer and one dependency-injectable batching engine to `src/os_scripts/cachyos.js`. The existing Arch orchestration reads the package file and delegates all classification, validation, batching, fallback, and result reporting to that engine; repository and AUR groups remain independent.

**Tech Stack:** Bun, JavaScript ES modules, `bun:test`, pacman, yay/paru.

## Global Constraints

- Preserve `sudo pacman -Syu --noconfirm` as the full Arch preflight.
- Use one repository batch and one AUR `--batchinstall` command on the successful path.
- On batch failure, retry only targets absent from a fresh `pacman -Qq` snapshot.
- Process repository and AUR failures independently.
- Never send malformed or missing targets to an install command.
- Preserve first-seen package-list order in every returned result category.
- Do not change `common/paru_applist.txt`, AUR helper preference, gaming installation, Omarchy configuration, Claude configuration, or skill synchronization.
- Do not add runtime dependencies or edit system/package-manager configuration.

---

### Task 1: Normalize package-list input safely

**Files:**
- Modify: `tests/cachyos.test.js`
- Modify: `src/os_scripts/cachyos.js`

**Interfaces:**
- Produces: `normalizeArchPackageNames(packages: string[]): { valid: string[], invalid: string[] }`.
- Package names are valid only when they match `/^(?![-.])[A-Za-z0-9@._+-]+$/`.
- Duplicate names are discarded after their first appearance; whitespace is trimmed before validation.

- [ ] **Step 1: Write failing normalization tests**

Import `normalizeArchPackageNames` and add:

```js
describe("Arch package-list normalization", () => {
	it("trims, deduplicates, and preserves first-seen order", () => {
		expect(
			normalizeArchPackageNames([
				" chromium ",
				"visual-studio-code-bin",
				"chromium",
				"bun-bin",
			]),
		).toEqual({
			valid: ["chromium", "visual-studio-code-bin", "bun-bin"],
			invalid: [],
		});
	});

	it("rejects empty and shell-active package names", () => {
		expect(
			normalizeArchPackageNames([
				"",
				"   ",
				"good_pkg+git@source",
				"bad package",
				"bad;touch-/tmp/pwned",
				"$(bad)",
			]),
		).toEqual({
			valid: ["good_pkg+git@source"],
			invalid: ["", "bad package", "bad;touch-/tmp/pwned", "$(bad)"],
		});
	});
});
```

Production mutations caught: removing trimming, changing stable deduplication, accepting spaces/semicolons/command substitution, or rejecting valid Arch punctuation.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun test tests/cachyos.test.js`

Expected: FAIL because `normalizeArchPackageNames` is not exported.

- [ ] **Step 3: Implement minimal normalization**

Add near the existing package-routing helpers:

```js
const ARCH_PACKAGE_NAME_PATTERN = /^(?![-.])[A-Za-z0-9@._+-]+$/;

export function normalizeArchPackageNames(packages) {
	const valid = [];
	const invalid = [];
	const seen = new Set();

	for (const raw of packages) {
		const pkg = raw.trim();
		if (seen.has(pkg)) continue;
		seen.add(pkg);
		if (pkg && ARCH_PACKAGE_NAME_PATTERN.test(pkg)) valid.push(pkg);
		else invalid.push(pkg);
	}
	return { valid, invalid };
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `bun test tests/cachyos.test.js`

Expected: PASS.

- [ ] **Step 5: Commit normalization**

```bash
git add src/os_scripts/cachyos.js tests/cachyos.test.js
git commit -m "feat: normalize Arch package targets"
```

---

### Task 2: Batch repository and AUR installs with fallback

**Files:**
- Modify: `tests/cachyos.test.js`
- Modify: `src/os_scripts/cachyos.js`

**Interfaces:**
- Consumes: `normalizeArchPackageNames(packages)` from Task 1.
- Produces:

```text
installArchPackageBatch(packages, {
  aurHelper,
  packageInRepositoryImpl,
  packageInAurImpl,
  getInstalledPackagesImpl,
  runCommandImpl
}) -> Promise<{
  installed: string[],
  failed: string[],
  missing: string[],
  invalid: string[],
  skipped: string[]
}>
```

- Default `packageInAurImpl(pkg, aurHelper)` executes `[aurHelper, "-Si", "--aur", pkg]` without a shell and returns whether it exits `0`.
- Export `getInstalledPackages` for injection/testing without changing its fallback semantics.

- [ ] **Step 1: Write failing successful-path tests**

Import `installArchPackageBatch`, then add tests with literal expected commands:

```js
describe("batched Arch package installation", () => {
	it("skips installed targets and uses one batch per available source", async () => {
		const commands = [];
		const result = await installArchPackageBatch(
			["already", "repo-one", "aur-one", "repo-two", "aur-two"],
			{
				aurHelper: "yay",
				getInstalledPackagesImpl: async () => new Set(["already"]),
				packageInRepositoryImpl: async (pkg) => pkg.startsWith("repo-"),
				packageInAurImpl: async () => true,
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
			},
		);

		expect(commands).toEqual([
			"sudo pacman -S --needed --noconfirm repo-one repo-two",
			"yay -S --needed --noconfirm --batchinstall aur-one aur-two",
		]);
		expect(result).toEqual({
			installed: ["repo-one", "aur-one", "repo-two", "aur-two"],
			failed: [],
			missing: [],
			invalid: [],
			skipped: ["already"],
		});
	});

	it("filters missing AUR and malformed targets before install commands", async () => {
		const metadataQueries = [];
		const commands = [];
		const result = await installArchPackageBatch(
			["repo-one", "aur-good", "aur-missing", "bad;name"],
			{
				aurHelper: "paru",
				getInstalledPackagesImpl: async () => new Set(),
				packageInRepositoryImpl: async (pkg) => pkg === "repo-one",
				packageInAurImpl: async (pkg) => {
					metadataQueries.push(pkg);
					return pkg === "aur-good";
				},
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
			},
		);

		expect(metadataQueries).toEqual(["aur-good", "aur-missing"]);
		expect(commands).toEqual([
			"sudo pacman -S --needed --noconfirm repo-one",
			"paru -S --needed --noconfirm --batchinstall aur-good",
		]);
		expect(result.missing).toEqual(["aur-missing"]);
		expect(result.invalid).toEqual(["bad;name"]);
	});
});
```

Production mutations caught: per-package normal-path installs, missing `--batchinstall`, invalid/missing target leakage, loss of original order, or failure to skip installed targets.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun test tests/cachyos.test.js`

Expected: FAIL because `installArchPackageBatch` is not exported.

- [ ] **Step 3: Implement metadata boundaries and successful batches**

Export `getInstalledPackages`. Add:

```js
async function packageInAur(pkg, aurHelper) {
	if (!aurHelper) return false;
	const proc = Bun.spawn([aurHelper, "-Si", "--aur", pkg], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await proc.exited) === 0;
}
```

Implement `installArchPackageBatch` with injected defaults. Normalize once,
snapshot installed packages once, classify only initially absent valid targets,
validate AUR candidates, and execute non-empty repository/AUR batch commands.
Use a `Map` keyed by normalized valid package name for terminal statuses so the
returned arrays can be derived in original order:

```js
export async function installArchPackageBatch(packages, options = {}) {
	const {
		aurHelper,
		packageInRepositoryImpl = packageInRepository,
		packageInAurImpl = packageInAur,
		getInstalledPackagesImpl = getInstalledPackages,
		runCommandImpl = runCommand,
	} = options;
	const { valid, invalid } = normalizeArchPackageNames(packages);
	const status = new Map();
	const initiallyInstalled = await getInstalledPackagesImpl();
	const repositoryPackages = [];
	const aurPackages = [];

	for (const pkg of valid) {
		if (initiallyInstalled.has(pkg)) {
			status.set(pkg, "skipped");
		} else if (await packageInRepositoryImpl(pkg)) {
			repositoryPackages.push(pkg);
		} else if (!aurHelper) {
			status.set(pkg, "missing");
		} else if (await packageInAurImpl(pkg, aurHelper)) {
			aurPackages.push(pkg);
		} else {
			status.set(pkg, "missing");
		}
	}

	if (repositoryPackages.length > 0) {
		const ok = await runCommandImpl(
			`sudo pacman -S --needed --noconfirm ${repositoryPackages.join(" ")}`,
		);
		if (ok) {
			for (const pkg of repositoryPackages) status.set(pkg, "installed");
		}
	}
	if (aurPackages.length > 0) {
		const ok = await runCommandImpl(
			`${aurHelper} -S --needed --noconfirm --batchinstall ${aurPackages.join(" ")}`,
		);
		if (ok) {
			for (const pkg of aurPackages) status.set(pkg, "installed");
		}
	}

const result = {
	installed: valid.filter((pkg) => status.get(pkg) === "installed"),
	failed: valid.filter((pkg) => status.get(pkg) === "failed"),
	missing: valid.filter((pkg) => status.get(pkg) === "missing"),
	invalid,
	skipped: valid.filter((pkg) => status.get(pkg) === "skipped"),
};
	return result;
}
```

At this RED/GREEN stage, failed batches may leave group members without a
terminal status. Steps 5–11 add the required fallback before this task is
committed.

- [ ] **Step 4: Run successful-path tests and verify GREEN**

Run: `bun test tests/cachyos.test.js`

Expected: PASS for normalization and successful batching tests.

- [ ] **Step 5: Write failing repository fallback test**

Add a sequence-based installed-state fake. The initial snapshot is empty; the
snapshot after batch failure reports `repo-one` installed, so only `repo-two`
is retried:

```js
it("retries only still-absent repository targets after batch failure", async () => {
	const snapshots = [new Set(), new Set(["repo-one"])];
	const commands = [];
	const result = await installArchPackageBatch(["repo-one", "repo-two"], {
		aurHelper: "yay",
		getInstalledPackagesImpl: async () => snapshots.shift() ?? new Set(),
		packageInRepositoryImpl: async () => true,
	packageInAurImpl: async () => false,
	runCommandImpl: async (command) => {
		commands.push(command);
		return command === "sudo pacman -S --needed --noconfirm repo-two";
	},
});

	expect(commands).toEqual([
		"sudo pacman -S --needed --noconfirm repo-one repo-two",
		"sudo pacman -S --needed --noconfirm repo-two",
	]);
	expect(result.installed).toEqual(["repo-one", "repo-two"]);
	expect(result.failed).toEqual([]);
});
```

- [ ] **Step 6: Run the fallback test and verify RED**

Run: `bun test tests/cachyos.test.js`

Expected: FAIL because a failed repository batch does not yet re-snapshot and retry.

- [ ] **Step 7: Implement shared batch fallback**

Add an internal helper that receives a package group, batch command, individual
command builder, status map, installed-snapshot function, and command runner.
If the batch succeeds, mark the whole group installed. If it fails, fetch a
fresh installed set, mark present group members installed, and invoke one
individual command for each absent member, marking command success as installed
and command failure as failed:

```js
async function installBatchWithFallback({
	packages,
	batchCommand,
	individualCommand,
	status,
	getInstalledPackagesImpl,
	runCommandImpl,
}) {
	if (packages.length === 0) return;
	if (await runCommandImpl(batchCommand)) {
		for (const pkg of packages) status.set(pkg, "installed");
		return;
	}

	const installedAfterBatch = await getInstalledPackagesImpl();
	for (const pkg of packages) {
		if (installedAfterBatch.has(pkg)) {
			status.set(pkg, "installed");
		} else if (await runCommandImpl(individualCommand(pkg))) {
			status.set(pkg, "installed");
		} else {
			status.set(pkg, "failed");
		}
	}
}
```

Replace both inline successful-batch blocks with independent calls to this
helper. Repository uses the pacman batch and per-package pacman builder; AUR
uses the helper `--batchinstall` batch and the same helper flags without
`--batchinstall` for individual commands.

- [ ] **Step 8: Run the repository fallback test and verify GREEN**

Run: `bun test tests/cachyos.test.js`

Expected: PASS.

- [ ] **Step 9: Write failing AUR fallback and independence tests**

Add tests proving:

```js
// AUR batch fails; aur-one appears in the fresh snapshot; only aur-two retries.
expect(commands).toEqual([
	"yay -S --needed --noconfirm --batchinstall aur-one aur-two",
	"yay -S --needed --noconfirm aur-two",
]);

// Repository batch and fallback may fail while the independent AUR batch still runs.
expect(commands).toContain(
	"paru -S --needed --noconfirm --batchinstall aur-one",
);

// With aurHelper null, repository batch still runs and the AUR candidate is missing.
expect(result).toMatchObject({ missing: ["aur-one"] });
```

For the AUR fallback test, use snapshots `[new Set(), new Set(["aur-one"])]`.
For independence, make repository commands return `false` and the AUR batch
return `true`; assert the ordered categories exactly. Also test empty input
produces no metadata or install calls.

- [ ] **Step 10: Run new tests and verify RED**

Run: `bun test tests/cachyos.test.js`

Expected: at least the AUR fallback/independence assertions fail until both groups use the shared fallback independently.

- [ ] **Step 11: Complete fallback and terminal categorization**

Apply the shared fallback to AUR with an individual command that omits
`--batchinstall`. Ensure a target receives exactly one terminal status and all
arrays are derived from normalized input order. Do not run AUR metadata checks
when `aurHelper` is null; mark candidates missing directly.

- [ ] **Step 12: Run focused tests and verify GREEN**

Run: `bun test tests/cachyos.test.js`

Expected: all focused tests pass with no real package-manager commands run.

- [ ] **Step 13: Commit batching engine**

```bash
git add src/os_scripts/cachyos.js tests/cachyos.test.js
git commit -m "feat: batch Arch package installation"
```

---

### Task 3: Integrate batching and document behavior

**Files:**
- Modify: `tests/cachyos.test.js`
- Modify: `src/os_scripts/cachyos.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `installArchPackageBatch(packages, dependencies)` from Task 2.
- Changes: `installSystemPackages` reads the existing package file, calls the batching engine after sudo validation, and logs separate failed/missing/invalid summaries before continuing to fonts and gaming.

- [ ] **Step 1: Export and test orchestration without system commands**

Export `installSystemPackages` and accept an options object while retaining
production defaults:

```text
installSystemPackages(aurHelper, isOmarchy, {
  refreshSudoImpl,
  installArchPackageBatchImpl,
  readFileImpl,
  runCommandImpl,
  promptUserImpl
})
```

Write a test that injects successful sudo, a literal package file, and a fake
batching result. Assert that the parsed package array is passed once to the
batching engine and that the existing Nerd Font command still runs afterward.
Write a second test proving failed sudo does not invoke the batching engine.

- [ ] **Step 2: Run orchestration tests and verify RED**

Run: `bun test tests/cachyos.test.js`

Expected: FAIL because `installSystemPackages` is private and not injectable.

- [ ] **Step 3: Implement orchestration integration**

Replace the per-package classification/install loop with one
`installArchPackageBatch` call. Keep file comment filtering in orchestration;
normalization handles trimming, duplicates, and malformed values. Log lists for
non-empty `failed`, `missing`, and `invalid` arrays. Preserve the Nerd Font
command and gaming prompt order exactly.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `bun test tests/cachyos.test.js`

Expected: PASS.

- [ ] **Step 5: Update README**

Add an Arch behavior bullet stating that Haoshoku batches repository and AUR
packages, filters missing targets, and retries only still-uninstalled packages
individually when a batch fails.

- [ ] **Step 6: Run full verification**

Run:

```bash
bun test tests/cachyos.test.js
bun test
bun run lint
git diff --check
git status --short
```

Expected: focused and full tests exit `0`; lint has no errors (the existing HTML warnings may remain); diff check has no output; only planned files are modified.

- [ ] **Step 7: Commit integration and documentation**

```bash
git add src/os_scripts/cachyos.js tests/cachyos.test.js README.md
git commit -m "docs: explain batched Arch package fallback"
```
