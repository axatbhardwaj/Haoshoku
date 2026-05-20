import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as prefs from "../src/helpers/configure_caelestia_prefs.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIGS_CAELESTIA_DIR = path.join(PROJECT_ROOT, "configs", "caelestia");

let tmpHome;
let tmpProjectRoot;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-caelestia-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-caelestia-root-"),
	);
	fs.mkdirSync(path.join(tmpProjectRoot, "configs", "caelestia"), {
		recursive: true,
	});
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

describe("configure_caelestia_prefs module shape", () => {
	it("exports backupCaelestiaPrefs, syncCaelestiaPrefs, configureCaelestiaPrefs", () => {
		expect(typeof prefs.backupCaelestiaPrefs).toBe("function");
		expect(typeof prefs.syncCaelestiaPrefs).toBe("function");
		expect(typeof prefs.configureCaelestiaPrefs).toBe("function");
	});
});

describe("syncCaelestiaPrefs — configs/caelestia/ → ~/.config/caelestia/", () => {
	it("copies hypr-user.conf and cli.json into ~/.config/caelestia/", async () => {
		const sourceDir = path.join(tmpProjectRoot, "configs", "caelestia");
		fs.writeFileSync(
			path.join(sourceDir, "hypr-user.conf"),
			"# fixture hypr-user.conf\nmonitor = ,preferred,auto,1\n",
		);
		fs.writeFileSync(
			path.join(sourceDir, "cli.json"),
			JSON.stringify({ toggles: { fixture: {} } }, null, 2),
		);

		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const destDir = path.join(tmpHome, ".config", "caelestia");
		expect(
			fs.readFileSync(path.join(destDir, "hypr-user.conf"), "utf8"),
		).toContain("monitor = ,preferred,auto,1");
		expect(
			JSON.parse(fs.readFileSync(path.join(destDir, "cli.json"), "utf8")),
		).toEqual({ toggles: { fixture: {} } });
	});

	it("creates the ~/.config/caelestia/ directory if missing", async () => {
		const sourceDir = path.join(tmpProjectRoot, "configs", "caelestia");
		fs.writeFileSync(path.join(sourceDir, "hypr-user.conf"), "# fixture\n");

		expect(fs.existsSync(path.join(tmpHome, ".config", "caelestia"))).toBe(
			false,
		);
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(fs.existsSync(path.join(tmpHome, ".config", "caelestia"))).toBe(
			true,
		);
	});

	it("skips missing source files without throwing (partial sync is fine)", async () => {
		const sourceDir = path.join(tmpProjectRoot, "configs", "caelestia");
		fs.writeFileSync(path.join(sourceDir, "cli.json"), "{}");

		await expect(
			prefs.syncCaelestiaPrefs({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
			}),
		).resolves.toBeUndefined();

		const destDir = path.join(tmpHome, ".config", "caelestia");
		expect(fs.existsSync(path.join(destDir, "cli.json"))).toBe(true);
		expect(fs.existsSync(path.join(destDir, "hypr-user.conf"))).toBe(false);
	});

	it("is idempotent (running twice yields same destination state)", async () => {
		const sourceDir = path.join(tmpProjectRoot, "configs", "caelestia");
		fs.writeFileSync(path.join(sourceDir, "hypr-user.conf"), "# v1\n");
		fs.writeFileSync(path.join(sourceDir, "cli.json"), "{}");

		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const destDir = path.join(tmpHome, ".config", "caelestia");
		expect(fs.readFileSync(path.join(destDir, "hypr-user.conf"), "utf8")).toBe(
			"# v1\n",
		);
	});
});

describe("backupCaelestiaPrefs — ~/.config/caelestia/ → configs/caelestia/", () => {
	it("copies hypr-user.conf and cli.json into configs/caelestia/", async () => {
		const liveDir = path.join(tmpHome, ".config", "caelestia");
		fs.mkdirSync(liveDir, { recursive: true });
		fs.writeFileSync(
			path.join(liveDir, "hypr-user.conf"),
			"# live hypr-user.conf\n",
		);
		fs.writeFileSync(
			path.join(liveDir, "cli.json"),
			JSON.stringify({ toggles: { live: {} } }),
		);

		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const backupDir = path.join(tmpProjectRoot, "configs", "caelestia");
		expect(
			fs.readFileSync(path.join(backupDir, "hypr-user.conf"), "utf8"),
		).toContain("# live hypr-user.conf");
		expect(
			JSON.parse(fs.readFileSync(path.join(backupDir, "cli.json"), "utf8")),
		).toEqual({ toggles: { live: {} } });
	});

	it("creates configs/caelestia/ if it doesn't exist yet", async () => {
		fs.rmSync(path.join(tmpProjectRoot, "configs", "caelestia"), {
			recursive: true,
			force: true,
		});
		const liveDir = path.join(tmpHome, ".config", "caelestia");
		fs.mkdirSync(liveDir, { recursive: true });
		fs.writeFileSync(path.join(liveDir, "cli.json"), "{}");

		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.existsSync(path.join(tmpProjectRoot, "configs", "caelestia")),
		).toBe(true);
	});

	it("skips when ~/.config/caelestia/ doesn't exist (nothing to back up)", async () => {
		await expect(
			prefs.backupCaelestiaPrefs({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
			}),
		).resolves.toBeUndefined();
	});
});

describe("seeded configs/caelestia/ (in-tree static configs)", () => {
	it("ships a parseable cli.json with the expected toggle entries", () => {
		const cliJson = JSON.parse(
			fs.readFileSync(path.join(CONFIGS_CAELESTIA_DIR, "cli.json"), "utf8"),
		);
		const toggles = Object.keys(cliJson.toggles || {});
		expect(toggles).toEqual(
			expect.arrayContaining([
				"communication",
				"1password",
				"brave-personal",
				"brave-work",
				"claude",
			]),
		);
	});

	it("ships an hypr-user.conf containing the persistent workspace pins", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user.conf"),
			"utf8",
		);
		expect(conf).toMatch(/workspace\s*=\s*name:0\s*,\s*monitor:DP-2/);
		expect(conf).toMatch(/workspace\s*=\s*5\s*,\s*monitor:HDMI-A-1/);
		expect(conf).toMatch(/workspace\s*=\s*4\s*,\s*monitor:HDMI-A-1/);
		expect(conf).toMatch(/workspace\s*=\s*1\s*,\s*monitor:DP-1/);
	});
});
