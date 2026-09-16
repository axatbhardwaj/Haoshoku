import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "..", "haoshoku.js");
const roots = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function fixture() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-gaming-cli-"));
	roots.push(home);
	return {
		configPath: path.join(home, ".config", "haoshoku", "gaming.json"),
		overlayPath: path.join(
			home,
			".config",
			"hypr",
			"haoshoku",
			"workspaces.lua",
		),
		home,
	};
}

function run(home, ...args) {
	return Bun.spawnSync([process.execPath, CLI, ...args], {
		env: { ...process.env, HOME: home },
		stderr: "pipe",
		stdout: "pipe",
	});
}

describe("gaming autostart CLI", () => {
	it("creates the Steam-on Omakade-off defaults", () => {
		const { configPath, home } = fixture();

		const result = run(home, "--gaming");

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			steamAutostart: true,
			omakadeAutostart: false,
		});
	});

	it("enables Omakade autostart while keeping Steam on", () => {
		const { configPath, home } = fixture();

		const result = run(home, "--gaming-omakade-autostart", "enabled");

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			steamAutostart: true,
			omakadeAutostart: true,
		});
	});

	it("disables Steam autostart without touching Omakade", () => {
		const { configPath, home } = fixture();

		const result = run(home, "--gaming-steam-autostart", "disabled");

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			steamAutostart: false,
			omakadeAutostart: false,
		});
	});

	it("patches a deployed overlay when Omakade is enabled", () => {
		const { overlayPath, home } = fixture();
		fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
		fs.writeFileSync(
			overlayPath,
			[
				'o.exec_on_start("/usr/bin/kdeconnectd")',
				"-- Steam stays in the background on 2; Omakade is the library you open with SUPER+2.",
				'o.exec_on_start("haoshoku-special-workspace numbered-login 2 steam")',
				"",
			].join("\n"),
		);

		const result = run(home, "--gaming-omakade-autostart", "enabled");

		expect(result.exitCode).toBe(0);
		expect(fs.readFileSync(overlayPath, "utf8")).toContain(
			'o.exec_on_start("haoshoku-special-workspace numbered-login 2 omakade")',
		);
	});

	it("rejects invalid CLI values without creating config", () => {
		const { configPath, home } = fixture();

		const result = run(home, "--gaming-omakade-autostart", "sometimes");

		expect(result.exitCode).toBe(1);
		expect(fs.existsSync(configPath)).toBe(false);
	});

	it("leaves malformed JSON untouched and exits nonzero", () => {
		const { configPath, home } = fixture();
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(configPath, '{"steamAutostart":true');
		const before = fs.readFileSync(configPath);

		const result = run(home, "--gaming-steam-autostart", "disabled");

		expect(result.exitCode).toBe(1);
		expect(fs.readFileSync(configPath)).toEqual(before);
	});
});
