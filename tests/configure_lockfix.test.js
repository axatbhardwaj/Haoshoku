import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as lockfix from "../src/helpers/configure_lockfix.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIGS_LOCKFIX_DIR = path.join(PROJECT_ROOT, "configs", "caelestia-lockfix");

let tmpHome;
let tmpProjectRoot;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-lockfix-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-lockfix-root-"),
	);
	// Seed the repo directory skeleton
	fs.mkdirSync(path.join(tmpProjectRoot, "configs", "caelestia-lockfix"), {
		recursive: true,
	});
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

const APPLY_SH_CONTENT = "#!/usr/bin/env bash\necho hello\n";
const LOCK_PATCH_CONTENT = "--- LockSurface.qml\n+++ LockSurface.qml\n@@ -1 +1 @@\n-old\n+new\n";
const CENTER_PATCH_CONTENT = "--- Center.qml\n+++ Center.qml\n@@ -1 +1 @@\n-old\n+new\n";

/** Seed the repo kit dir with all 3 runtime files. */
function seedRepoKit({ withClaudeMd = false } = {}) {
	const kitDir = path.join(tmpProjectRoot, "configs", "caelestia-lockfix");
	fs.writeFileSync(path.join(kitDir, "apply.sh"), APPLY_SH_CONTENT);
	fs.writeFileSync(
		path.join(kitDir, "LockSurface.qml.portrait-fix.patch"),
		LOCK_PATCH_CONTENT,
	);
	fs.writeFileSync(
		path.join(kitDir, "Center.qml.portrait-fix.patch"),
		CENTER_PATCH_CONTENT,
	);
	if (withClaudeMd) {
		fs.writeFileSync(
			path.join(kitDir, "CLAUDE.md"),
			"# configs/caelestia-lockfix/\n",
		);
	}
}

/** Seed the live kit dir with all 3 runtime files. */
function seedLiveKit() {
	const liveDir = path.join(
		tmpHome,
		".local",
		"share",
		"caelestia-lockfix",
	);
	fs.mkdirSync(liveDir, { recursive: true });
	fs.writeFileSync(path.join(liveDir, "apply.sh"), APPLY_SH_CONTENT);
	fs.writeFileSync(
		path.join(liveDir, "LockSurface.qml.portrait-fix.patch"),
		LOCK_PATCH_CONTENT,
	);
	fs.writeFileSync(
		path.join(liveDir, "Center.qml.portrait-fix.patch"),
		CENTER_PATCH_CONTENT,
	);
}

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe("configure_lockfix module shape", () => {
	it("exports syncLockfix, backupLockfix, configureLockfix", () => {
		expect(typeof lockfix.syncLockfix).toBe("function");
		expect(typeof lockfix.backupLockfix).toBe("function");
		expect(typeof lockfix.configureLockfix).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// syncLockfix — repo → live
// ---------------------------------------------------------------------------

describe("syncLockfix — deploys apply.sh and .patch files to live kit dir", () => {
	it("copies apply.sh to ~/.local/share/caelestia-lockfix/", async () => {
		seedRepoKit();
		await lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
			"apply.sh",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(APPLY_SH_CONTENT);
	});

	it("copies LockSurface.qml.portrait-fix.patch to live dir", async () => {
		seedRepoKit();
		await lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
			"LockSurface.qml.portrait-fix.patch",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(LOCK_PATCH_CONTENT);
	});

	it("copies Center.qml.portrait-fix.patch to live dir", async () => {
		seedRepoKit();
		await lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
			"Center.qml.portrait-fix.patch",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(CENTER_PATCH_CONTENT);
	});

	it("creates the live kit dir if it does not exist", async () => {
		seedRepoKit();
		const liveDir = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
		);
		expect(fs.existsSync(liveDir)).toBe(false);

		await lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(fs.existsSync(liveDir)).toBe(true);
	});

	it("does NOT copy CLAUDE.md to the live kit dir", async () => {
		seedRepoKit({ withClaudeMd: true });
		await lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
			"CLAUDE.md",
		);
		expect(fs.existsSync(dest)).toBe(false);
	});

	it("makes deployed apply.sh executable (mode 0o755)", async () => {
		seedRepoKit();
		await lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
			"apply.sh",
		);
		const mode = fs.statSync(dest).mode & 0o777;
		expect(mode).toBe(0o755);
	});

	it("skips gracefully when repo kit dir is missing", async () => {
		// No seedRepoKit — the configs/caelestia-lockfix/ dir itself is absent
		fs.rmSync(
			path.join(tmpProjectRoot, "configs", "caelestia-lockfix"),
			{ recursive: true, force: true },
		);

		await expect(
			lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot }),
		).resolves.toBeUndefined();

		// Nothing deployed
		expect(
			fs.existsSync(
				path.join(tmpHome, ".local", "share", "caelestia-lockfix"),
			),
		).toBe(false);
	});

	it("is idempotent (running twice yields same state)", async () => {
		seedRepoKit();
		await lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });
		await lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
			"apply.sh",
		);
		expect(fs.readFileSync(dest, "utf8")).toBe(APPLY_SH_CONTENT);
		expect((fs.statSync(dest).mode & 0o777)).toBe(0o755);
	});
});

// ---------------------------------------------------------------------------
// backupLockfix — live → repo
// ---------------------------------------------------------------------------

describe("backupLockfix — snapshots live kit into repo dir", () => {
	it("copies apply.sh from live to repo kit dir", async () => {
		seedLiveKit();
		await lockfix.backupLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpProjectRoot,
			"configs",
			"caelestia-lockfix",
			"apply.sh",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(APPLY_SH_CONTENT);
	});

	it("copies LockSurface patch from live to repo kit dir", async () => {
		seedLiveKit();
		await lockfix.backupLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpProjectRoot,
			"configs",
			"caelestia-lockfix",
			"LockSurface.qml.portrait-fix.patch",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(LOCK_PATCH_CONTENT);
	});

	it("copies Center patch from live to repo kit dir", async () => {
		seedLiveKit();
		await lockfix.backupLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpProjectRoot,
			"configs",
			"caelestia-lockfix",
			"Center.qml.portrait-fix.patch",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(CENTER_PATCH_CONTENT);
	});

	it("creates repo kit dir if it does not exist before backup", async () => {
		seedLiveKit();
		fs.rmSync(
			path.join(tmpProjectRoot, "configs", "caelestia-lockfix"),
			{ recursive: true, force: true },
		);
		expect(
			fs.existsSync(
				path.join(tmpProjectRoot, "configs", "caelestia-lockfix"),
			),
		).toBe(false);

		await lockfix.backupLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.existsSync(
				path.join(tmpProjectRoot, "configs", "caelestia-lockfix"),
			),
		).toBe(true);
	});

	it("skips gracefully when live kit dir is missing", async () => {
		// No seedLiveKit — nothing at ~/.local/share/caelestia-lockfix/
		await expect(
			lockfix.backupLockfix({ home: tmpHome, projectRoot: tmpProjectRoot }),
		).resolves.toBeUndefined();

		// Nothing written to repo
		expect(
			fs.existsSync(
				path.join(
					tmpProjectRoot,
					"configs",
					"caelestia-lockfix",
					"apply.sh",
				),
			),
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("sync / backup round-trip", () => {
	it("backup then sync restores identical content", async () => {
		const originalContent = "#!/usr/bin/env bash\necho original\n";

		// Seed live with original content
		const liveDir = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
		);
		fs.mkdirSync(liveDir, { recursive: true });
		fs.writeFileSync(path.join(liveDir, "apply.sh"), originalContent);
		fs.writeFileSync(
			path.join(liveDir, "LockSurface.qml.portrait-fix.patch"),
			LOCK_PATCH_CONTENT,
		);
		fs.writeFileSync(
			path.join(liveDir, "Center.qml.portrait-fix.patch"),
			CENTER_PATCH_CONTENT,
		);

		// Backup to repo
		await lockfix.backupLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		// Overwrite live apply.sh with something else
		fs.writeFileSync(path.join(liveDir, "apply.sh"), "#!/usr/bin/env bash\necho modified\n");

		// Sync back from repo
		await lockfix.syncLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.readFileSync(path.join(liveDir, "apply.sh"), "utf8"),
		).toBe(originalContent);
	});
});

// ---------------------------------------------------------------------------
// configureLockfix — alias for syncLockfix
// ---------------------------------------------------------------------------

describe("configureLockfix — alias for syncLockfix", () => {
	it("deploys apply.sh and patches (same as syncLockfix)", async () => {
		seedRepoKit();
		await lockfix.configureLockfix({ home: tmpHome, projectRoot: tmpProjectRoot });

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
			"apply.sh",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(APPLY_SH_CONTENT);
	});
});

// ---------------------------------------------------------------------------
// Seeded configs/caelestia-lockfix/ (in-tree static files — real path)
// ---------------------------------------------------------------------------

describe("seeded configs/caelestia-lockfix/ (in-tree static files)", () => {
	it("ships apply.sh under configs/caelestia-lockfix/", () => {
		expect(
			fs.existsSync(path.join(CONFIGS_LOCKFIX_DIR, "apply.sh")),
		).toBe(true);
	});

	it("ships LockSurface.qml.portrait-fix.patch under configs/caelestia-lockfix/", () => {
		expect(
			fs.existsSync(
				path.join(CONFIGS_LOCKFIX_DIR, "LockSurface.qml.portrait-fix.patch"),
			),
		).toBe(true);
	});

	it("ships Center.qml.portrait-fix.patch under configs/caelestia-lockfix/", () => {
		expect(
			fs.existsSync(
				path.join(CONFIGS_LOCKFIX_DIR, "Center.qml.portrait-fix.patch"),
			),
		).toBe(true);
	});
});
