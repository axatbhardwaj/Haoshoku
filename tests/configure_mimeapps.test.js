import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as mimeapps from "../src/helpers/configure_mimeapps.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIGS_MIMEAPPS_DIR = path.join(PROJECT_ROOT, "configs", "mimeapps");

let tmpHome;
let tmpProjectRoot;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-mimeapps-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-mimeapps-root-"),
	);
	// Seed the repo directory skeleton
	fs.mkdirSync(path.join(tmpProjectRoot, "configs", "mimeapps"), {
		recursive: true,
	});
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

const FIXTURE_CONTENT = "[Default Applications]\ntext/plain=zed.desktop\n";

/** Seed a mimeapps.list in the repo configs dir. */
function seedRepoMimeapps() {
	fs.writeFileSync(
		path.join(tmpProjectRoot, "configs", "mimeapps", "mimeapps.list"),
		FIXTURE_CONTENT,
	);
}

/** Seed a mimeapps.list in the live ~/.config dir. */
function seedLiveMimeapps() {
	fs.mkdirSync(path.join(tmpHome, ".config"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpHome, ".config", "mimeapps.list"),
		FIXTURE_CONTENT,
	);
}

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe("configure_mimeapps module shape", () => {
	it("exports syncMimeappsConfig, backupMimeappsConfig, configureMimeapps", () => {
		expect(typeof mimeapps.syncMimeappsConfig).toBe("function");
		expect(typeof mimeapps.backupMimeappsConfig).toBe("function");
		expect(typeof mimeapps.configureMimeapps).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// syncMimeappsConfig — repo → live
// ---------------------------------------------------------------------------

describe("syncMimeappsConfig — deploys mimeapps.list to ~/.config/", () => {
	it("copies configs/mimeapps/mimeapps.list to ~/.config/mimeapps.list", async () => {
		seedRepoMimeapps();
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const dest = path.join(tmpHome, ".config", "mimeapps.list");
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(FIXTURE_CONTENT);
	});

	it("creates ~/.config/ if it does not exist", async () => {
		seedRepoMimeapps();
		expect(fs.existsSync(path.join(tmpHome, ".config"))).toBe(false);

		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(fs.existsSync(path.join(tmpHome, ".config"))).toBe(true);
	});

	it("skips gracefully when repo source file is missing", async () => {
		// No seedRepoMimeapps — configs/mimeapps/ dir exists but file is absent
		await expect(
			mimeapps.syncMimeappsConfig({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
			}),
		).resolves.toBeUndefined();

		// Nothing deployed to live
		expect(
			fs.existsSync(path.join(tmpHome, ".config", "mimeapps.list")),
		).toBe(false);
	});

	it("is idempotent (running twice yields the same file)", async () => {
		seedRepoMimeapps();
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.readFileSync(
				path.join(tmpHome, ".config", "mimeapps.list"),
				"utf8",
			),
		).toBe(FIXTURE_CONTENT);
	});
});

// ---------------------------------------------------------------------------
// backupMimeappsConfig — live → repo
// ---------------------------------------------------------------------------

describe("backupMimeappsConfig — snapshots ~/.config/mimeapps.list into repo", () => {
	it("copies ~/.config/mimeapps.list to configs/mimeapps/mimeapps.list", async () => {
		seedLiveMimeapps();
		await mimeapps.backupMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const dest = path.join(
			tmpProjectRoot,
			"configs",
			"mimeapps",
			"mimeapps.list",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(FIXTURE_CONTENT);
	});

	it("creates configs/mimeapps/ dir if it does not exist", async () => {
		seedLiveMimeapps();
		// Remove the pre-seeded dir
		fs.rmSync(path.join(tmpProjectRoot, "configs", "mimeapps"), {
			recursive: true,
			force: true,
		});
		expect(
			fs.existsSync(path.join(tmpProjectRoot, "configs", "mimeapps")),
		).toBe(false);

		await mimeapps.backupMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.existsSync(path.join(tmpProjectRoot, "configs", "mimeapps")),
		).toBe(true);
	});

	it("skips gracefully when live file is missing", async () => {
		// No seedLiveMimeapps — ~/.config/mimeapps.list absent
		await expect(
			mimeapps.backupMimeappsConfig({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
			}),
		).resolves.toBeUndefined();

		// Nothing written to repo
		expect(
			fs.existsSync(
				path.join(tmpProjectRoot, "configs", "mimeapps", "mimeapps.list"),
			),
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("sync / backup round-trip", () => {
	it("backup then sync restores identical content", async () => {
		const originalContent =
			"[Default Applications]\nvideo/mp4=vlc.desktop\n";

		// Seed live with original content
		fs.mkdirSync(path.join(tmpHome, ".config"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpHome, ".config", "mimeapps.list"),
			originalContent,
		);

		// Backup to repo
		await mimeapps.backupMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		// Overwrite live with something else
		fs.writeFileSync(
			path.join(tmpHome, ".config", "mimeapps.list"),
			"[Default Applications]\ntext/plain=other.desktop\n",
		);

		// Sync back from repo
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.readFileSync(
				path.join(tmpHome, ".config", "mimeapps.list"),
				"utf8",
			),
		).toBe(originalContent);
	});
});

// ---------------------------------------------------------------------------
// configureMimeapps — alias for syncMimeappsConfig
// ---------------------------------------------------------------------------

describe("configureMimeapps — alias for syncMimeappsConfig", () => {
	it("deploys mimeapps.list (same as syncMimeappsConfig)", async () => {
		seedRepoMimeapps();
		await mimeapps.configureMimeapps({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.existsSync(path.join(tmpHome, ".config", "mimeapps.list")),
		).toBe(true);
		expect(
			fs.readFileSync(
				path.join(tmpHome, ".config", "mimeapps.list"),
				"utf8",
			),
		).toBe(FIXTURE_CONTENT);
	});
});

// ---------------------------------------------------------------------------
// Seeded configs/mimeapps/ (in-tree static file — real path, no injection)
// ---------------------------------------------------------------------------

describe("seeded configs/mimeapps/ (in-tree static config)", () => {
	it("ships mimeapps.list under configs/mimeapps/", () => {
		expect(
			fs.existsSync(
				path.join(CONFIGS_MIMEAPPS_DIR, "mimeapps.list"),
			),
		).toBe(true);
	});

	it("seeded mimeapps.list is non-empty", () => {
		const content = fs.readFileSync(
			path.join(CONFIGS_MIMEAPPS_DIR, "mimeapps.list"),
			"utf8",
		);
		expect(content.length).toBeGreaterThan(0);
	});
});
