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
		fs.writeFileSync(
			path.join(sourceDir, "hypr-user-laptop.conf"),
			"# laptop\n",
		);
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

	it("backs up a user-owned live hypr-user.conf to .bak before overwriting", async () => {
		seedPcAndLaptop();
		writeDeviceType("pc");
		// User had their own monitor config living at the deploy target.
		const liveDir = path.join(tmpHome, ".config", "caelestia");
		fs.mkdirSync(liveDir, { recursive: true });
		const userMonitorConf =
			"# user's own monitor config\nmonitor = HDMI-A-2, 1920x1080, 0x0, 1\n";
		fs.writeFileSync(path.join(liveDir, "hypr-user.conf"), userMonitorConf);

		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		// User's original lands in .bak, not vanished; repo variant is now live.
		expect(
			fs.readFileSync(path.join(liveDir, "hypr-user.conf.bak"), "utf8"),
		).toBe(userMonitorConf);
		expect(
			fs.readFileSync(path.join(liveDir, "hypr-user.conf"), "utf8"),
		).toMatch(/pc variant/);
	});

	it("backs up a user-owned live cli.json to .bak before overwriting", async () => {
		seedPcAndLaptop();
		writeDeviceType("pc");
		const liveDir = path.join(tmpHome, ".config", "caelestia");
		fs.mkdirSync(liveDir, { recursive: true });
		const userCli = JSON.stringify({ toggles: { userOwned: {} } }, null, 2);
		fs.writeFileSync(path.join(liveDir, "cli.json"), userCli);

		await prefs.syncCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(fs.readFileSync(path.join(liveDir, "cli.json.bak"), "utf8")).toBe(
			userCli,
		);
		expect(
			JSON.parse(fs.readFileSync(path.join(liveDir, "cli.json"), "utf8")),
		).toEqual({ toggles: { fixture: {} } });
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
				path.join(tmpProjectRoot, "configs", "caelestia", "hypr-user-pc.conf"),
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
				path.join(tmpProjectRoot, "configs", "caelestia", "hypr-user-pc.conf"),
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
				path.join(tmpProjectRoot, "configs", "caelestia", "hypr-user-pc.conf"),
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

	it("does NOT clobber a non-empty repo variant with an empty live placeholder", async () => {
		writeDeviceType("pc");
		// Repo already holds a curated PC variant (the source of truth).
		const repoDir = path.join(tmpProjectRoot, "configs", "caelestia");
		const curated = "# curated pc variant\nmonitor = DP-1, 2560x1440, 0x0, 1\n";
		fs.writeFileSync(path.join(repoDir, "hypr-user-pc.conf"), curated);

		// Live file is the empty placeholder installCaelestia pre-creates.
		const liveDir = path.join(tmpHome, ".config", "caelestia");
		fs.mkdirSync(liveDir, { recursive: true });
		fs.writeFileSync(path.join(liveDir, "hypr-user.conf"), "");

		const messages = [];
		const originalLog = console.log;
		console.log = (...args) => messages.push(args.join(" "));
		try {
			await prefs.backupCaelestiaPrefs({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
			});
		} finally {
			console.log = originalLog;
		}

		// Curated repo variant must survive untouched.
		expect(
			fs.readFileSync(path.join(repoDir, "hypr-user-pc.conf"), "utf8"),
		).toBe(curated);
		expect(messages.join("\n")).toMatch(/hypr-user/i);
	});

	it("also skips when the live placeholder is whitespace-only", async () => {
		writeDeviceType("laptop");
		const repoDir = path.join(tmpProjectRoot, "configs", "caelestia");
		const curated = "# curated laptop variant\nmonitor = eDP-1\n";
		fs.writeFileSync(path.join(repoDir, "hypr-user-laptop.conf"), curated);

		const liveDir = path.join(tmpHome, ".config", "caelestia");
		fs.mkdirSync(liveDir, { recursive: true });
		fs.writeFileSync(path.join(liveDir, "hypr-user.conf"), "  \n\t\n");

		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.readFileSync(path.join(repoDir, "hypr-user-laptop.conf"), "utf8"),
		).toBe(curated);
	});

	it("still backs up an empty live file when the repo target is also empty/absent", async () => {
		writeDeviceType("pc");
		// No curated repo variant exists yet — an empty live file is fine to land.
		const liveDir = path.join(tmpHome, ".config", "caelestia");
		fs.mkdirSync(liveDir, { recursive: true });
		fs.writeFileSync(path.join(liveDir, "hypr-user.conf"), "");

		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const repoVariant = path.join(
			tmpProjectRoot,
			"configs",
			"caelestia",
			"hypr-user-pc.conf",
		);
		expect(fs.existsSync(repoVariant)).toBe(true);
		expect(fs.readFileSync(repoVariant, "utf8")).toBe("");
	});

	it("backs up a non-empty live file normally even when repo target is non-empty", async () => {
		writeDeviceType("pc");
		const repoDir = path.join(tmpProjectRoot, "configs", "caelestia");
		fs.writeFileSync(
			path.join(repoDir, "hypr-user-pc.conf"),
			"# old curated\n",
		);

		const liveDir = path.join(tmpHome, ".config", "caelestia");
		fs.mkdirSync(liveDir, { recursive: true });
		const newLive = "# user edited monitor config\nmonitor = DP-3\n";
		fs.writeFileSync(path.join(liveDir, "hypr-user.conf"), newLive);

		await prefs.backupCaelestiaPrefs({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.readFileSync(path.join(repoDir, "hypr-user-pc.conf"), "utf8"),
		).toBe(newLive);
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
				"music",
			]),
		);
		expect(toggles).not.toContain("vivaldi");
	});

	it("ships configs/warp/tab_configs/agents.toml as a Claude-only tab", () => {
		const t = fs.readFileSync(
			path.join(PROJECT_ROOT, "configs", "warp", "tab_configs", "agents.toml"),
			"utf8",
		);
		// Assert against directives only. The file documents the split it used
		// to be, so matching raw text would fail on the comment's own history.
		const directives = t
			.split("\n")
			.filter((line) => !line.trim().startsWith("#"))
			.join("\n");

		expect(directives).toContain("claude -r io");
		// Super+A opens Claude alone. Codex is started by hand when wanted, so
		// there is no second pane and therefore no root split to declare.
		expect(directives).not.toContain("codex");
		expect(directives).not.toContain("split =");
		expect(
			fs.existsSync(path.join(PROJECT_ROOT, "configs", "kitty", "kitty.conf")),
		).toBe(true);
	});

	it("maps special-workspace toggles to the expected apps", () => {
		const cliJson = JSON.parse(
			fs.readFileSync(path.join(CONFIGS_CAELESTIA_DIR, "cli.json"), "utf8"),
		);
		const toggles = cliJson.toggles;

		expect(toggles.communication.signal).toMatchObject({
			enable: true,
			match: [{ class: "signal" }],
			command: ["signal-desktop"],
			move: true,
		});
		expect(toggles.communication["whatsapp-web"]).toMatchObject({
			enable: true,
			match: [{ class: "brave-web.whatsapp.com__-Default" }],
			command: ["/home/xzat/.local/bin/whatsapp-web"],
			move: true,
		});
		expect(toggles.communication).not.toHaveProperty("zapzap");
		expect(toggles["1password"]["1password"]).toMatchObject({
			enable: true,
			match: [{ class: "1password" }],
			command: ["1password"],
			move: true,
		});
		expect(toggles.music.spotify).toMatchObject({
			enable: true,
			match: [
				{ class: "spotify" },
				{ class: "Spotify" },
				{ initialTitle: "Spotify" },
				{ initialTitle: "Spotify Free" },
			],
			command: ["spotify"],
			move: true,
		});
		expect(toggles["brave-personal"]["brave-personal"]).toMatchObject({
			enable: true,
			match: [{ class: "brave-browser", title: "Flux" }],
			command: ["brave", "--profile-directory=Default"],
			move: true,
		});
		expect(toggles["brave-work"]["brave-work"]).toMatchObject({
			enable: true,
			match: [{ class: "brave-browser", title: "Defi" }],
			command: ["brave", "--profile-directory=Profile 1"],
			move: true,
		});
		expect(toggles).not.toHaveProperty("primevideo");
		expect(toggles).not.toHaveProperty("zee5");
		expect(toggles).not.toHaveProperty("crunchyroll");
		expect(toggles).not.toHaveProperty("jiohotstar");
		expect(toggles).not.toHaveProperty("agents");
		expect(toggles).not.toHaveProperty("claude");
		expect(toggles).not.toHaveProperty("vivaldi");
	});

	it("launches sysmon btop through the XDG terminal with its toggle metadata", () => {
		const cliJson = JSON.parse(
			fs.readFileSync(path.join(CONFIGS_CAELESTIA_DIR, "cli.json"), "utf8"),
		);
		const btop = cliJson.toggles.sysmon.btop;

		expect(btop).toMatchObject({
			enable: true,
			match: [
				{
					class: "dev.warp.Warp",
					title: "btop",
					workspace: { name: "special:sysmon" },
				},
			],
		});
		expect(btop.command).toEqual([
			"xdg-terminal-exec",
			"--",
			"env",
			"LC_ALL=C.UTF-8",
			"fish",
			"-C",
			"exec btop",
		]);
	});

	it("ships hypr-user-pc.conf with the PC's monitor-pinned workspaces", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-pc.conf"),
			"utf8",
		);
		expect(conf).toMatch(/workspace\s*=\s*10\s*,\s*monitor:DP-2/);
		expect(conf).toMatch(/workspace\s*=\s*7\s*,\s*monitor:DP-2/);
		expect(conf).toMatch(/workspace\s*=\s*6\s*,\s*monitor:DP-2/);
		expect(conf).toMatch(/workspace\s*=\s*5\s*,\s*monitor:HDMI-A-1/);
		expect(conf).toMatch(/workspace\s*=\s*4\s*,\s*monitor:HDMI-A-1/);
		expect(conf).toMatch(/workspace\s*=\s*1\s*,\s*monitor:DP-1/);
	});

	it("resets crash-stale DP-1 VRR on PC Hyprland startup", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-pc.conf"),
			"utf8",
		);

		expect(conf).toContain(
			"exec-once = /home/xzat/.local/bin/game-performance --reset",
		);
	});

	it("routes Super+A through the tagged Warp agents recipe and Super+D to HDMI-A-1 on PC", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-pc.conf"),
			"utf8",
		);
		expect(conf).toContain(
			"bind = Super, A, exec, hyprctl dispatch focusmonitor DP-2 && /home/xzat/.local/bin/haoshoku-special-workspace agents",
		);
		const unbindIndex = conf.indexOf("unbind = Super, A");
		const bindIndex = conf.indexOf("bind = Super, A, exec");
		expect(unbindIndex).toBeGreaterThanOrEqual(0);
		expect(bindIndex).toBeGreaterThan(unbindIndex);
		expect(conf).not.toContain("agents-toggle");
		expect(conf).not.toContain("kitty-agents");
		expect(conf).toContain(
			"bind = $kbCommunication, exec, hyprctl dispatch focusmonitor HDMI-A-1 && caelestia toggle communication",
		);
		expect(conf).not.toContain("caelestia toggle claude");
	});

	it("routes Super+I to native claude-desktop alone on DP-2 for PC", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-pc.conf"),
			"utf8",
		);

		expect(conf).toContain(
			String.raw`windowrule = workspace special:claude-desktop, match:class com\.anthropic\.Claude`,
		);
		expect(conf).toContain(
			"bind = Super, I, exec, hyprctl dispatch focusmonitor DP-2 && /home/xzat/.local/bin/claude-desktop-toggle",
		);
		// The ChatGPT PWA no longer shares the workspace, so nothing should
		// route its class here — under either Brave app-id spelling.
		expect(conf).not.toContain("cadlkienfkclaiaibeoongdcgmdikeeg");
		// Claude's old Brave PWA stays gone; workspace was renamed off ai-webapps.
		expect(conf).not.toContain(
			"brave-fmpnliohjhemenmnlpbfagaolkdacoja-Default",
		);
		expect(conf).not.toContain("special:ai-webapps");
		expect(conf).not.toContain("bind = Super, I, exec, caelestia toggle");
	});

	it("does not bind deprecated streaming launchers on PC", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-pc.conf"),
			"utf8",
		);

		for (const service of ["primevideo", "zee5", "crunchyroll", "jiohotstar"]) {
			expect(conf).not.toContain(`special:${service}`);
			expect(conf).not.toContain(`caelestia toggle ${service}`);
		}
		expect(conf).not.toContain("brave\\.exe");
		expect(conf).not.toContain("www\\.primevideo\\.com");
		expect(conf).not.toContain("www\\.zee5\\.com");
		expect(conf).not.toContain("www\\.crunchyroll\\.com");
		expect(conf).not.toContain("www\\.jiohotstar\\.com");
	});

	it("routes Super+6 and Super+7 to the vertical monitor on PC", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-pc.conf"),
			"utf8",
		);

		expect(conf).toContain("workspace = 6, monitor:DP-2, persistent:true");
		expect(conf).toContain("workspace = 7, monitor:DP-2, persistent:true");
		expect(conf).toContain("unbind = $kbGoToWs, 6");
		expect(conf).toContain(
			"bind = $kbGoToWs, 6, exec, hyprctl dispatch focusmonitor DP-2 && hyprctl dispatch workspace 6",
		);
		expect(conf).toContain("unbind = $kbGoToWs, 7");
		expect(conf).toContain(
			"bind = $kbGoToWs, 7, exec, hyprctl dispatch focusmonitor DP-2 && /home/xzat/.local/bin/haoshoku-special-workspace numbered 7 warp",
		);
		expect(conf).toContain(
			"exec-once = /home/xzat/.local/bin/haoshoku-special-workspace numbered-login 7 warp",
		);
		expect(conf).not.toContain("haoshoku-ws7");
		expect(conf).not.toContain("kitty-workspace-7");
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
		expect(conf).not.toMatch(/\bvrr\b/);
		expect(conf).not.toContain("game-performance --reset");
		// Workspaces should be persistent but NOT monitor-pinned
		expect(conf).toMatch(/workspace\s*=\s*10/);
		expect(conf).not.toMatch(/workspace\s*=\s*\d+\s*,\s*monitor:/);
		expect(conf).not.toMatch(/workspace\s*=\s*10\s*,\s*monitor:/);
	});

	it("routes Super+A through the tagged Warp agents recipe without monitor forcing on laptop", () => {
		const conf = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-laptop.conf"),
			"utf8",
		);
		expect(conf).toContain(
			"bind = Super, A, exec, /home/xzat/.local/bin/haoshoku-special-workspace agents",
		);
		const unbindIndex = conf.indexOf("unbind = Super, A");
		const bindIndex = conf.indexOf("bind = Super, A, exec");
		expect(unbindIndex).toBeGreaterThanOrEqual(0);
		expect(bindIndex).toBeGreaterThan(unbindIndex);
		expect(conf).not.toContain("agents-toggle");
		expect(conf).not.toContain("kitty-agents");
		// Laptop has eDP-1, not DP-2/HDMI-A-1 — no focusmonitor forcing on Super+A
		expect(conf).not.toMatch(/focusmonitor\s+DP-2/);
		expect(conf).not.toContain("caelestia toggle claude");
	});

	it("routes Notion through the Brave web app on workspace 10", () => {
		const pc = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-pc.conf"),
			"utf8",
		);
		const laptop = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-laptop.conf"),
			"utf8",
		);

		expect(pc).toContain(
			"workspace = 10, monitor:DP-2, default:true, persistent:true",
		);
		expect(laptop).toContain("workspace = 10, default:true, persistent:true");

		for (const conf of [pc, laptop]) {
			expect(conf).toContain(
				"windowrule = workspace 10 silent, match:class brave-dcokohelbbehjlcjjfmhfbpdgfjcoopf-Default",
			);
			expect(conf).toContain("bind = $kbGoToWs, 0, exec, sh -lc");
			expect(conf).toContain("hyprctl dispatch workspace 10");
			expect(conf).toContain(
				'select(.class == "brave-dcokohelbbehjlcjjfmhfbpdgfjcoopf-Default") | .address',
			);
			expect(conf).toContain(
				'hyprctl dispatch movetoworkspacesilent "10,address:$addr"',
			);
			expect(conf).toContain(
				'hyprctl dispatch exec "[workspace 10 silent] app2unit -- gtk-launch brave-dcokohelbbehjlcjjfmhfbpdgfjcoopf-Default"',
			);
			expect(conf).toContain(
				"bind = $kbMoveWinToWs, 0, exec, hyprctl dispatch movetoworkspace 10",
			);
			expect(conf).not.toContain("workspace = name:0");
			expect(conf).not.toContain('any(.[]; .class == "cohesion")');
			expect(conf).not.toContain("app2unit -- cohesion");
		}
	});

	it("keeps the retired Cohesion Flatpak out of app routing", () => {
		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);

			expect(conf).not.toContain(
				"windowrule = workspace 10 silent, match:class io.github.brunofin.Cohesion",
			);
			expect(conf).not.toContain(
				"app2unit -- flatpak run io.github.brunofin.Cohesion",
			);
		}
	});

	it("keeps laptop app workspaces and keybindings aligned with the PC variant", () => {
		const laptop = fs.readFileSync(
			path.join(CONFIGS_CAELESTIA_DIR, "hypr-user-laptop.conf"),
			"utf8",
		);
		const sharedMarkers = [
			"bind = $kbEditor, exec, app2unit -- $editor",
			"bind = $kbTerminal, exec, app2unit -- xdg-terminal-exec",
			"bind = $kbBrowser, exec, caelestia toggle brave-work",
			"workspace = 10, default:true, persistent:true",
			"workspace = 1, default:true, persistent:true",
			"workspace = 2, persistent:true",
			"workspace = 3, persistent:true",
			"workspace = 4, persistent:true",
			"workspace = 5, default:true, persistent:true",
			"workspace = 6, persistent:true",
			"workspace = 7, persistent:true",
			"windowrule = workspace 2 silent, match:class ^[Ss]team$",
			"windowrule = workspace 4 silent, match:class discord",
			"windowrule = workspace 5 silent, match:class (teams-for-linux|TelegramDesktop|org\\.telegram\\.desktop)",
			'hyprctl dispatch exec "[workspace 2 silent] app2unit -- steam"',
			'hyprctl dispatch exec "[workspace 4 silent] app2unit -- discord"',
			"bind = $kbGoToWs, 6, exec, hyprctl dispatch workspace 6",
			"bind = $kbGoToWs, 7, exec, /home/xzat/.local/bin/haoshoku-special-workspace numbered 7 warp",
			"hyprshot -m output -m active",
		];

		for (const marker of sharedMarkers) {
			expect(laptop).toContain(marker);
		}
	});

	it("re-adds the Super tap-to-launch fix in both variants (interrupt before launcher)", () => {
		// Hyprland >=0.55.3 (PR #14743) executes ALL binds matching a key event in
		// definition order. Stock Caelestia defines launcher (Super_L) before the
		// catchall interrupt, so a bare Super tap fires launcher then interrupt and
		// self-cancels on release. The fix re-adds both REVERSED — interrupt first,
		// launcher last — inside the global submap. Guard both variants against a
		// future --caelestia-prefs sync silently dropping or reordering it.
		const interruptBind =
			"bindin = Super, catchall, global, caelestia:launcherInterrupt";
		const launcherBind = "bindi = Super, Super_L, global, caelestia:launcher";

		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);

			expect(conf).toContain("unbind = Super, catchall");
			expect(conf).toContain("unbind = Super, Super_L");
			expect(conf).toContain(interruptBind);
			expect(conf).toContain(launcherBind);
			// Order is the actual fix: interrupt must be defined before launcher.
			expect(conf.indexOf(interruptBind)).toBeLessThan(
				conf.indexOf(launcherBind),
			);
		}
	});

	it("routes the browser shortcuts through named Brave special workspaces", () => {
		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);

			expect(conf).toContain("unbind = $kbBrowser");
			expect(conf).toContain(
				"bind = $kbBrowser, exec, caelestia toggle brave-work",
			);
			expect(conf).toContain(
				"bind = Super, B, exec, caelestia toggle brave-personal",
			);
			expect(conf).toContain(
				"windowrule = workspace special:brave-personal, match:class brave-browser, match:title Flux",
			);
			expect(conf).toContain(
				"windowrule = workspace special:brave-work, match:class brave-browser, match:title Defi",
			);
			expect(conf).not.toContain("caelestia toggle vivaldi");
			expect(conf).not.toContain("special:vivaldi");
		}
	});

	it("app-routed workspace binds use the launch-if-missing pattern", () => {
		// Which apps/workspaces are routed is personal and drifts via
		// --caelestia-prefs-backup. Assert the *shape* of every launch-if-missing
		// $kbGoToWs bind, not the specific apps it launches.
		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);

			const launchBinds = conf
				.split("\n")
				.filter(
					(line) =>
						/^bind = \$kbGoToWs, \S+, exec,/.test(line) &&
						line.includes("hyprctl clients -j"),
				);

			expect(launchBinds.length).toBeGreaterThan(0);
			for (const bindLine of launchBinds) {
				expect(bindLine).toContain("hyprctl dispatch workspace");
				expect(bindLine).toContain("jq -e");
				expect(bindLine).toMatch(/\[workspace [^\]]*silent\]/);
				expect(bindLine).toMatch(/app2unit|hyprctl dispatch exec/);
			}
		}
	});

	it("routes special-workspace apps in both hypr-user variants", () => {
		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);

			expect(conf).toContain(
				"windowrule = workspace special:communication, match:class signal",
			);
			expect(conf).toContain(
				"windowrule = workspace special:communication, match:class brave-web\\.whatsapp\\.com__-Default",
			);
			expect(conf).not.toContain("match:class zapzap");
			expect(conf).not.toContain(
				"brave-hnpfjngllnobngcgfapefoaidbinmjnm-Default",
			);
			expect(conf).not.toContain("--app-id=hnpfjngllnobngcgfapefoaidbinmjnm");
			expect(conf).toContain(
				"windowrule = workspace special:1password, match:class 1password",
			);
			expect(conf).toContain(
				"windowrule = workspace special:music, match:class spotify|Spotify",
			);
			expect(conf).toContain("bind = $kbMusic, exec, caelestia toggle music");
			expect(conf).toContain(
				"windowrule = workspace special:brave-personal, match:class brave-browser, match:title Flux",
			);
			expect(conf).toContain(
				"windowrule = workspace special:brave-work, match:class brave-browser, match:title Defi",
			);
			expect(conf).toContain(
				"bind = Super, B, exec, caelestia toggle brave-personal",
			);
		}
	});

	it("keeps named Brave special windows translucent even when fullscreen", () => {
		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);

			expect(conf).toContain(
				"windowrule = opacity $windowOpacity override $windowOpacity override $windowOpacity override, match:class brave-browser, match:title Flux",
			);
			expect(conf).toContain(
				"windowrule = opacity $windowOpacity override $windowOpacity override $windowOpacity override, match:class brave-browser, match:title Defi",
			);
		}
	});

	it("rebinds Super+T (default terminal) to the XDG terminal in both hypr-user variants", () => {
		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);

			expect(conf).toContain("unbind = $kbTerminal");
			expect(conf).toContain(
				"bind = $kbTerminal, exec, app2unit -- xdg-terminal-exec",
			);
		}
	});

	it("rebinds Super+E (default file manager) to Dolphin in both hypr-user variants", () => {
		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);

			expect(conf).toContain("$fileExplorer = dolphin");
			expect(conf).toContain("unbind = $kbFileExplorer");
			expect(conf).toContain(
				"bind = $kbFileExplorer, exec, app2unit -- $fileExplorer",
			);
		}
	});

	it("binds Super+A to the shared Warp agents recipe in both hypr-user variants", () => {
		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);
			expect(conf).toMatch(
			/bind = Super, A, exec,.*haoshoku-special-workspace agents/,
			);
			const unbindIndex = conf.indexOf("unbind = Super, A");
			const bindIndex = conf.indexOf("bind = Super, A, exec");
			expect(unbindIndex).toBeGreaterThanOrEqual(0);
			expect(bindIndex).toBeGreaterThan(unbindIndex);
			expect(conf).not.toContain("caelestia toggle agents");
			expect(conf).not.toContain("agents-toggle");
		}
	});

	it("overrides Super+Shift+M to toggle microphone mute in both hypr-user variants", () => {
		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);
			const unbindIndex = conf.indexOf("unbind = Super+Shift, M");
			const bindIndex = conf.indexOf(
				"bindl = Super+Shift, M, exec, /home/xzat/.local/bin/mic-toggle",
			);

			expect(unbindIndex).toBeGreaterThanOrEqual(0);
			expect(bindIndex).toBeGreaterThan(unbindIndex);
		}
	});

	it("binds Super+Shift+Delete to the unlocked Caelestia restart helper in both variants", () => {
		const bind =
			"bind = Super+Shift, Delete, exec, /home/xzat/.local/bin/caelestia-restart";

		for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
			const conf = fs.readFileSync(
				path.join(CONFIGS_CAELESTIA_DIR, file),
				"utf8",
			);

			expect(conf).toContain(bind);
			expect(conf).not.toMatch(/bindl\s*=\s*Super\+Shift,\s*Delete/);
			expect(conf).not.toContain("unbind = Super+Shift, Delete");
			expect(conf.split("Super+Shift, Delete").length - 1).toBe(1);
		}
	});
});
