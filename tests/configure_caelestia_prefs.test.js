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

function seedPcAndLaptop() {
	const sourceDir = path.join(tmpProjectRoot, "configs", "caelestia");
	fs.writeFileSync(
		path.join(sourceDir, "hypr-user-pc.conf"),
		"# pc variant — DP-1/DP-2/HDMI-A-1\nmonitor = DP-1, 2560x1440, 0x0, 1\n",
	);
	fs.writeFileSync(
		path.join(sourceDir, "hypr-user-laptop.conf"),
		"# laptop variant — eDP-1 HiDPI\nmonitor = eDP-1, 2880x1800@120, 0x0, 1.6\n",
	);
	fs.writeFileSync(
		path.join(sourceDir, "cli.json"),
		JSON.stringify({ toggles: { fixture: {} } }, null, 2),
	);
}

function writeDeviceType(deviceType) {
	fs.writeFileSync(
		path.join(tmpHome, ".haoshoku.json"),
		JSON.stringify({ deviceType }),
	);
}

describe("configure_caelestia_prefs module shape", () => {
	it("exports backupCaelestiaPrefs, syncCaelestiaPrefs, configureCaelestiaPrefs", () => {
		expect(typeof prefs.backupCaelestiaPrefs).toBe("function");
		expect(typeof prefs.syncCaelestiaPrefs).toBe("function");
		expect(typeof prefs.configureCaelestiaPrefs).toBe("function");
	});
});

describe("syncCaelestiaPrefs — deploys device-specific hypr-user variant", () => {
	it("deploys hypr-user-pc.conf when deviceType=pc", async () => {
		seedPcAndLaptop();
		writeDeviceType("pc");
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		const deployed = fs.readFileSync(
			path.join(tmpHome, ".config", "caelestia", "hypr-user.conf"),
			"utf8",
		);
		expect(deployed).toMatch(/pc variant/);
		expect(deployed).not.toMatch(/laptop variant/);
	});

	it("deploys hypr-user-laptop.conf when deviceType=laptop", async () => {
		seedPcAndLaptop();
		writeDeviceType("laptop");
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		const deployed = fs.readFileSync(
			path.join(tmpHome, ".config", "caelestia", "hypr-user.conf"),
			"utf8",
		);
		expect(deployed).toMatch(/laptop variant/);
		expect(deployed).not.toMatch(/pc variant/);
	});

	it("always deploys cli.json regardless of deviceType", async () => {
		seedPcAndLaptop();
		writeDeviceType("laptop");
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		const cli = JSON.parse(
			fs.readFileSync(
				path.join(tmpHome, ".config", "caelestia", "cli.json"),
				"utf8",
			),
		);
		expect(cli).toEqual({ toggles: { fixture: {} } });
	});

	it("falls back to PC variant when ~/.haoshoku.json is missing", async () => {
		seedPcAndLaptop();
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			fs.readFileSync(
				path.join(tmpHome, ".config", "caelestia", "hypr-user.conf"),
				"utf8",
			),
		).toMatch(/pc variant/);
	});

	it("falls back to PC variant when deviceType key is absent", async () => {
		seedPcAndLaptop();
		fs.writeFileSync(
			path.join(tmpHome, ".haoshoku.json"),
			JSON.stringify({ skillSources: ["foo"] }),
		);
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			fs.readFileSync(
				path.join(tmpHome, ".config", "caelestia", "hypr-user.conf"),
				"utf8",
			),
		).toMatch(/pc variant/);
	});

	it("falls back to PC variant when ~/.haoshoku.json is malformed JSON", async () => {
		seedPcAndLaptop();
		fs.writeFileSync(path.join(tmpHome, ".haoshoku.json"), "{ not valid json");
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			fs.readFileSync(
				path.join(tmpHome, ".config", "caelestia", "hypr-user.conf"),
				"utf8",
			),
		).toMatch(/pc variant/);
	});

	it("falls back to PC variant when deviceType is some unknown value (e.g. 'other')", async () => {
		seedPcAndLaptop();
		writeDeviceType("other");
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			fs.readFileSync(
				path.join(tmpHome, ".config", "caelestia", "hypr-user.conf"),
				"utf8",
			),
		).toMatch(/pc variant/);
	});

	it("skips hypr-user deploy gracefully if the chosen variant file is missing", async () => {
		// Only laptop variant in repo, but deviceType says pc → no pc variant to copy.
		const sourceDir = path.join(tmpProjectRoot, "configs", "caelestia");
		fs.writeFileSync(path.join(sourceDir, "hypr-user-laptop.conf"), "# laptop\n");
		fs.writeFileSync(path.join(sourceDir, "cli.json"), "{}");
		writeDeviceType("pc");

		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.existsSync(
				path.join(tmpHome, ".config", "caelestia", "hypr-user.conf"),
			),
		).toBe(false);
		// cli.json still deploys (portable)
		expect(
			fs.existsSync(path.join(tmpHome, ".config", "caelestia", "cli.json")),
		).toBe(true);
	});

	it("creates the ~/.config/caelestia/ directory if missing", async () => {
		seedPcAndLaptop();
		writeDeviceType("pc");
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

	it("is idempotent (running twice yields same destination state)", async () => {
		seedPcAndLaptop();
		writeDeviceType("pc");
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			fs.readFileSync(
				path.join(tmpHome, ".config", "caelestia", "hypr-user.conf"),
				"utf8",
			),
		).toMatch(/pc variant/);
	});
});

describe("backupCaelestiaPrefs — ~/.config/caelestia/ → configs/caelestia/<variant>", () => {
	function seedLiveConfig() {
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
	}

	it("backs up live hypr-user.conf to hypr-user-pc.conf when deviceType=pc", async () => {
		seedLiveConfig();
		writeDeviceType("pc");
		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			fs.readFileSync(
				path.join(
					tmpProjectRoot,
					"configs",
					"caelestia",
					"hypr-user-pc.conf",
				),
				"utf8",
			),
		).toContain("# live hypr-user.conf");
		expect(
			fs.existsSync(
				path.join(
					tmpProjectRoot,
					"configs",
					"caelestia",
					"hypr-user-laptop.conf",
				),
			),
		).toBe(false);
	});

	it("backs up live hypr-user.conf to hypr-user-laptop.conf when deviceType=laptop", async () => {
		seedLiveConfig();
		writeDeviceType("laptop");
		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			fs.readFileSync(
				path.join(
					tmpProjectRoot,
					"configs",
					"caelestia",
					"hypr-user-laptop.conf",
				),
				"utf8",
			),
		).toContain("# live hypr-user.conf");
		expect(
			fs.existsSync(
				path.join(
					tmpProjectRoot,
					"configs",
					"caelestia",
					"hypr-user-pc.conf",
				),
			),
		).toBe(false);
	});

	it("falls back to PC variant when deviceType is unset", async () => {
		seedLiveConfig();
		// no ~/.haoshoku.json
		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			fs.existsSync(
				path.join(
					tmpProjectRoot,
					"configs",
					"caelestia",
					"hypr-user-pc.conf",
				),
			),
		).toBe(true);
	});

	it("always backs up cli.json identically (no variant)", async () => {
		seedLiveConfig();
		writeDeviceType("laptop");
		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(tmpProjectRoot, "configs", "caelestia", "cli.json"),
					"utf8",
				),
			),
		).toEqual({ toggles: { live: {} } });
	});

	it("creates configs/caelestia/ if it doesn't exist yet", async () => {
		fs.rmSync(path.join(tmpProjectRoot, "configs", "caelestia"), {
			recursive: true,
			force: true,
		});
		seedLiveConfig();
		writeDeviceType("pc");
		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		expect(
			fs.existsSync(path.join(tmpProjectRoot, "configs", "caelestia")),
		).toBe(true);
	});

	it("skips when ~/.config/caelestia/ doesn't exist (nothing to back up)", async () => {
		writeDeviceType("pc");
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

	it("ships hypr-user-pc.conf with the PC's monitor-pinned workspaces", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-pc.conf"),
			"utf8",
		);
		expect(conf).toMatch(/workspace\s*=\s*name:0\s*,\s*monitor:DP-2/);
		expect(conf).toMatch(/workspace\s*=\s*5\s*,\s*monitor:HDMI-A-1/);
		expect(conf).toMatch(/workspace\s*=\s*4\s*,\s*monitor:HDMI-A-1/);
		expect(conf).toMatch(/workspace\s*=\s*1\s*,\s*monitor:DP-1/);
	});

	it("ships hypr-user-laptop.conf with eDP-1 + no monitor: pins + no NVIDIA exec-once", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-laptop.conf"),
			"utf8",
		);
		// Internal panel matched by connector name
		expect(conf).toMatch(/monitor\s*=\s*eDP-1/);
		expect(conf).toMatch(/2880x1800/);
		// Catch-all for occasional externals
		expect(conf).toMatch(/monitor\s*=\s*,\s*preferred/);
		// NO NVIDIA exec-once on Intel iGPU laptop
		expect(conf).not.toMatch(/nvidia-settings/);
		// Workspaces should be persistent but NOT monitor-pinned
		expect(conf).toMatch(/workspace\s*=\s*name:0/);
		expect(conf).not.toMatch(/workspace\s*=\s*\d+\s*,\s*monitor:/);
		expect(conf).not.toMatch(/workspace\s*=\s*name:0\s*,\s*monitor:/);
	});
});
