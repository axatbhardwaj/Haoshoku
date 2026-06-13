import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	configureWarp,
	patchWarpSettings,
	resolveWarpPaths,
} from "../src/helpers/configure_warp.js";

const NAME = "Caelestia Theme";
const P = "/home/u/.local/share/warp-terminal/themes/caelestia.yaml";
const themeLine = `theme = { custom = { name = "${NAME}", path = "${P}" } }`;

describe("resolveWarpPaths", () => {
	it("defaults to ~/.config and ~/.local/share", () => {
		const r = resolveWarpPaths({ home: "/h", env: {} });
		expect(r.settings).toBe("/h/.config/warp-terminal/settings.toml");
		expect(r.themePath).toBe(
			"/h/.local/share/warp-terminal/themes/caelestia.yaml",
		);
		expect(r.tabConfigDir).toBe("/h/.local/share/warp-terminal/tab_configs");
	});

	it("honors XDG_CONFIG_HOME / XDG_DATA_HOME", () => {
		const r = resolveWarpPaths({
			home: "/h",
			env: { XDG_CONFIG_HOME: "/x/cfg", XDG_DATA_HOME: "/x/data" },
		});
		expect(r.settings).toBe("/x/cfg/warp-terminal/settings.toml");
		expect(r.themePath).toBe("/x/data/warp-terminal/themes/caelestia.yaml");
	});
});

describe("patchWarpSettings", () => {
	it("replaces a built-in string theme + flips system_theme in an existing section", () => {
		const input = `[appearance.themes]\nsystem_theme = true\ntheme = "dark"\n\n[other]\nx = 1\n`;
		const out = patchWarpSettings(input, { name: NAME, path: P });
		expect(out).toContain("system_theme = false");
		expect(out).toContain(themeLine);
		expect(out).not.toContain('theme = "dark"');
		expect(out).toContain("[other]\nx = 1");
	});

	it("is idempotent (second run identical)", () => {
		const once = patchWarpSettings(
			`[appearance.themes]\nsystem_theme = true\ntheme = "dark"\n`,
			{ name: NAME, path: P },
		);
		expect(patchWarpSettings(once, { name: NAME, path: P })).toBe(once);
	});

	it("builds a clean section from empty input (fresh install)", () => {
		const out = patchWarpSettings("", { name: NAME, path: P });
		expect(out).toBe(
			`[appearance.themes]\nsystem_theme = false\n${themeLine}\n`,
		);
	});

	it("appends the section when absent but other config exists", () => {
		const out = patchWarpSettings(`[appearance]\nspacing = "normal"\n`, {
			name: NAME,
			path: P,
		});
		expect(out).toContain('[appearance]\nspacing = "normal"');
		expect(out).toContain("[appearance.themes]");
		expect(out).toContain(themeLine);
	});

	it("inserts missing keys without duplicating", () => {
		const out = patchWarpSettings(
			`[appearance.themes]\nsystem_theme = true\n`,
			{ name: NAME, path: P },
		);
		expect((out.match(/system_theme =/g) || []).length).toBe(1);
		expect(out).toContain(themeLine);
	});
});

describe("configureWarp (integration)", () => {
	let home;
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-warp-home-"));
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
	const settingsOf = () =>
		path.join(home, ".config", "warp-terminal", "settings.toml");

	it("creates a minimal settings.toml when absent", async () => {
		await configureWarp({ home, env: {} });
		const c = fs.readFileSync(settingsOf(), "utf8");
		expect(c).toContain("[appearance.themes]");
		expect(c).toContain("system_theme = false");
		expect(c).toContain('custom = { name = "Caelestia Theme"');
	});

	it("backs up once and is churn-free on re-run", async () => {
		fs.mkdirSync(path.dirname(settingsOf()), { recursive: true });
		fs.writeFileSync(
			settingsOf(),
			`[appearance.themes]\nsystem_theme = true\ntheme = "dark"\n`,
		);
		await configureWarp({ home, env: {} });
		const afterFirst = fs.readFileSync(settingsOf(), "utf8");
		expect(fs.existsSync(`${settingsOf()}.bak`)).toBe(true);
		expect(fs.readFileSync(`${settingsOf()}.bak`, "utf8")).toContain(
			'theme = "dark"',
		);

		await configureWarp({ home, env: {} }); // re-run must not churn
		expect(fs.readFileSync(settingsOf(), "utf8")).toBe(afterFirst);
		expect(fs.existsSync(`${settingsOf()}.tmp`)).toBe(false);
	});

	it("deploys the agents tab config into the XDG tab_configs dir", async () => {
		const projectRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-warp-root-"),
		);
		const srcDir = path.join(projectRoot, "configs", "warp", "tab_configs");
		fs.mkdirSync(srcDir, { recursive: true });
		fs.writeFileSync(path.join(srcDir, "agents.toml"), 'title = "agents"\n');

		await configureWarp({ home, env: {}, projectRoot });

		const dest = path.join(
			home,
			".local",
			"share",
			"warp-terminal",
			"tab_configs",
			"agents.toml",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toContain('title = "agents"');
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});
});
