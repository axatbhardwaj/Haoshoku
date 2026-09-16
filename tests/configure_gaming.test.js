import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	applyGamingAutostartToText,
	DEFAULT_GAMING_CONFIG,
	ensureGamingConfig,
	OMAKADE_AUTOSTART_LINE,
	readGamingConfig,
	setGamingConfig,
	STEAM_AUTOSTART_LINE,
	syncDeployedGamingAutostart,
} from "../src/helpers/configure_gaming.js";

const silent = {
	error() {},
	warning() {},
	info() {},
	success() {},
};

let home;
const configPath = () => path.join(home, ".config", "haoshoku", "gaming.json");
const overlayPath = () =>
	path.join(home, ".config", "hypr", "haoshoku", "workspaces.lua");

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-gaming-"));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const BASE_LUA = [
	"-- Haoshoku workspace behavior for Omarchy.",
	'o.exec_on_start("/usr/bin/kdeconnectd")',
	"-- Steam stays in the background on 2; Omakade is the library you open with SUPER+2.",
	'o.exec_on_start("haoshoku-special-workspace numbered-login 2 steam")',
	'o.window("^[Ss]team$", { workspace = "2 silent", tile = true })',
	'o.window("^io\\\\.github\\\\.tsouth89\\\\.Omakade$", { workspace = "2 silent" })',
	"",
].join("\n");

describe("gaming autostart config", () => {
	it("ensures Steam-on Omakade-off defaults with a private config file", () => {
		expect(ensureGamingConfig({ home, logger: silent })).toBe(true);

		expect(JSON.parse(fs.readFileSync(configPath(), "utf8"))).toEqual({
			steamAutostart: true,
			omakadeAutostart: false,
		});
		expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600);
		expect(DEFAULT_GAMING_CONFIG).toEqual({
			steamAutostart: true,
			omakadeAutostart: false,
		});
	});

	it("fills missing defaults without replacing explicit or custom fields", () => {
		fs.mkdirSync(path.dirname(configPath()), { recursive: true });
		fs.writeFileSync(
			configPath(),
			'{\n  "omakadeAutostart": true,\n  "owner": "axat"\n}\n',
		);

		expect(ensureGamingConfig({ home, logger: silent })).toBe(true);
		expect(JSON.parse(fs.readFileSync(configPath(), "utf8"))).toEqual({
			steamAutostart: true,
			omakadeAutostart: true,
			owner: "axat",
		});
	});

	it("enables Omakade while preserving the Steam choice", () => {
		expect(ensureGamingConfig({ home, logger: silent })).toBe(true);

		expect(
			setGamingConfig({ omakadeAutostart: true }, { home, logger: silent }),
		).toBe(true);
		expect(JSON.parse(fs.readFileSync(configPath(), "utf8"))).toEqual({
			steamAutostart: true,
			omakadeAutostart: true,
		});
	});

	it("disables Steam without changing the Omakade choice", () => {
		fs.mkdirSync(path.dirname(configPath()), { recursive: true });
		fs.writeFileSync(
			configPath(),
			'{\n  "steamAutostart": true,\n  "omakadeAutostart": true\n}\n',
		);

		expect(
			setGamingConfig({ steamAutostart: false }, { home, logger: silent }),
		).toBe(true);
		expect(JSON.parse(fs.readFileSync(configPath(), "utf8"))).toEqual({
			steamAutostart: false,
			omakadeAutostart: true,
		});
	});

	it("leaves malformed JSON untouched and reports failure", () => {
		fs.mkdirSync(path.dirname(configPath()), { recursive: true });
		fs.writeFileSync(configPath(), '{"steamAutostart":true');

		expect(ensureGamingConfig({ home, logger: silent })).toBe(false);
		expect(
			setGamingConfig({ steamAutostart: false }, { home, logger: silent }),
		).toBe(false);
		expect(readGamingConfig({ home, logger: silent })).toBeNull();
		expect(fs.readFileSync(configPath(), "utf8")).toBe(
			'{"steamAutostart":true',
		);
	});

	it("leaves invalid owned fields untouched and reports failure", () => {
		fs.mkdirSync(path.dirname(configPath()), { recursive: true });
		fs.writeFileSync(
			configPath(),
			'{"steamAutostart":"yes","omakadeAutostart":false}\n',
		);

		expect(ensureGamingConfig({ home, logger: silent })).toBe(false);
		expect(
			setGamingConfig({ omakadeAutostart: true }, { home, logger: silent }),
		).toBe(false);
		expect(fs.readFileSync(configPath(), "utf8")).toBe(
			'{"steamAutostart":"yes","omakadeAutostart":false}\n',
		);
	});
});

describe("applyGamingAutostartToText", () => {
	it("keeps Steam and drops a legacy Omakade line under defaults", () => {
		const legacy = BASE_LUA.replace(
			STEAM_AUTOSTART_LINE,
			`${STEAM_AUTOSTART_LINE}\n${OMAKADE_AUTOSTART_LINE}`,
		);
		const result = applyGamingAutostartToText(legacy, {
			steamAutostart: true,
			omakadeAutostart: false,
		});

		expect(result.changed).toBe(true);
		expect(result.text).toBe(BASE_LUA);
	});

	it("is a no-op when the overlay already matches the policy", () => {
		expect(applyGamingAutostartToText(BASE_LUA, DEFAULT_GAMING_CONFIG)).toEqual(
			{ changed: false, text: BASE_LUA },
		);
	});

	it("inserts Omakade after Steam when both are enabled", () => {
		const result = applyGamingAutostartToText(BASE_LUA, {
			steamAutostart: true,
			omakadeAutostart: true,
		});

		expect(result.changed).toBe(true);
		const lines = result.text.split("\n");
		expect(lines.indexOf(OMAKADE_AUTOSTART_LINE)).toBe(
			lines.indexOf(STEAM_AUTOSTART_LINE) + 1,
		);
		expect(result.text).toContain(
			'o.window("^io\\\\.github\\\\.tsouth89\\\\.Omakade$"',
		);
		// Re-applying is stable.
		expect(
			applyGamingAutostartToText(result.text, {
				steamAutostart: true,
				omakadeAutostart: true,
			}).changed,
		).toBe(false);
	});

	it("removes Steam while keeping Omakade when only Omakade is enabled", () => {
		const result = applyGamingAutostartToText(BASE_LUA, {
			steamAutostart: false,
			omakadeAutostart: true,
		});

		expect(result.changed).toBe(true);
		expect(result.text).not.toContain(STEAM_AUTOSTART_LINE);
		expect(result.text).toContain(OMAKADE_AUTOSTART_LINE);
	});

	it("anchors after kdeconnectd when the Steam comment is absent", () => {
		const withoutComment = BASE_LUA.split("\n")
			.filter((line) => !line.startsWith("-- Steam stays"))
			.join("\n");
		const result = applyGamingAutostartToText(withoutComment, {
			steamAutostart: true,
			omakadeAutostart: true,
		});

		const lines = result.text.split("\n");
		expect(lines.indexOf(STEAM_AUTOSTART_LINE)).toBe(
			lines.indexOf('o.exec_on_start("/usr/bin/kdeconnectd")') + 1,
		);
	});
});

describe("syncDeployedGamingAutostart", () => {
	it("skips when no overlay is deployed", () => {
		expect(ensureGamingConfig({ home, logger: silent })).toBe(true);
		expect(syncDeployedGamingAutostart({ home, logger: silent })).toEqual({
			changed: false,
			skipped: true,
		});
	});

	it("patches a deployed overlay to match an explicit Omakade choice", () => {
		expect(ensureGamingConfig({ home, logger: silent })).toBe(true);
		expect(
			setGamingConfig({ omakadeAutostart: true }, { home, logger: silent }),
		).toBe(true);
		fs.mkdirSync(path.dirname(overlayPath()), { recursive: true });
		fs.writeFileSync(overlayPath(), BASE_LUA);

		const result = syncDeployedGamingAutostart({
			home,
			logger: silent,
			now: () => 42,
		});
		expect(result).toEqual({ changed: true, skipped: false });
		const patched = fs.readFileSync(overlayPath(), "utf8");
		expect(patched).toContain(STEAM_AUTOSTART_LINE);
		expect(patched).toContain(OMAKADE_AUTOSTART_LINE);
		expect(fs.existsSync(`${overlayPath()}.bak.42`)).toBe(true);
	});
});
