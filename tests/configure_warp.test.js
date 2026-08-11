import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	configureWarp,
	patchWarpSettings,
	resolveWarpPaths,
} from "../src/helpers/configure_warp.js";

const NAME = "Elysian";
const P = "/home/u/.local/share/warp-terminal/themes/elysian.yaml";
const themeLine = `theme = { custom = { name = "${NAME}", path = "${P}" } }`;
const expectedTheme = {
	name: "Elysian",
	accent: "#62e2a4",
	background: "#010401",
	foreground: "#fdfffd",
	cursor: "#fdfffd",
	details: "darker",
	terminal_colors: {
		normal: {
			black: "#010401",
			red: "#bf5a7c",
			green: "#70cf6c",
			yellow: "#dfec63",
			blue: "#62e2a4",
			magenta: "#e0eb7a",
			cyan: "#9ed8dd",
			white: "#bff2ab",
		},
		bright: {
			black: "#518a51",
			red: "#dcb0be",
			green: "#b4e8b2",
			yellow: "#f6fdb7",
			blue: "#b0f3d2",
			magenta: "#f8fdce",
			cyan: "#e3f5f6",
			white: "#fdfffd",
		},
	},
};

describe("shipped Warp tab configs", () => {
	it("use only colors accepted by Warp's tab-config schema", () => {
		const supportedColors = new Set([
			"black",
			"red",
			"green",
			"yellow",
			"blue",
			"magenta",
			"cyan",
			"white",
		]);
		const tabConfigDirectory = path.join(
			import.meta.dir,
			"..",
			"configs",
			"warp",
			"tab_configs",
		);
		const unsupportedColors = fs
			.readdirSync(tabConfigDirectory)
			.filter((filename) => filename.endsWith(".toml"))
			.flatMap((filename) => {
				const source = fs.readFileSync(
					path.join(tabConfigDirectory, filename),
					"utf8",
				);
				return [...source.matchAll(/^color\s*=\s*"([^"]+)"/gm)].map(
					([, color]) => ({ filename, color }),
				);
			})
			.filter(({ color }) => !supportedColors.has(color));

		expect(unsupportedColors).toEqual([]);
	});

	it("ships Haki as a Claude-over-Codex vertical split", () => {
		// Catches removal or reversal of either child, command replacement, loss of
		// the home directory, or focus moving away from the Claude pane.
		const source = fs.readFileSync(
			path.join(
				import.meta.dir,
				"..",
				"configs",
				"warp",
				"tab_configs",
				"haki.toml",
			),
			"utf8",
		);
		const panes = source
			.split(/^\[\[panes\]\]$/m)
			.slice(1)
			.map((pane) =>
				pane
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line && !line.startsWith("#")),
			);
		const paneById = new Map(
			panes.map((lines) => [lines.find((line) => /^id\s*=/.test(line)), lines]),
		);

		expect(source).toMatch(/^name\s*=\s*"Haki"$/m);
		expect(source).toMatch(/^title\s*=\s*"haki"$/m);
		expect(source).toMatch(/^color\s*=\s*"magenta"$/m);
		expect(paneById.get('id = "root"')).toEqual([
			'id = "root"',
			'type = "split"',
			'split = "vertical"',
			'children = ["claude", "codex"]',
		]);
		expect(paneById.get('id = "claude"')).toEqual([
			'id = "claude"',
			'type = "terminal"',
			'directory = "/home/xzat"',
			'commands = ["/home/xzat/.local/bin/haoshoku-claude-local"]',
			"is_focused = true",
		]);
		expect(paneById.get('id = "codex"')).toEqual([
			'id = "codex"',
			'type = "terminal"',
			'directory = "/home/xzat"',
			'commands = ["codex"]',
		]);
	});
});

describe("resolveWarpPaths", () => {
	it("defaults to ~/.config and ~/.local/share", () => {
		const r = resolveWarpPaths({ home: "/h", env: {} });
		expect(r.settings).toBe("/h/.config/warp-terminal/settings.toml");
		expect(r.xdgTerminalPreference).toBe("/h/.config/xdg-terminals.list");
		expect(r.themePath).toBe(
			"/h/.local/share/warp-terminal/themes/elysian.yaml",
		);
		expect(r.tabConfigDir).toBe("/h/.local/share/warp-terminal/tab_configs");
	});

	it("honors XDG_CONFIG_HOME / XDG_DATA_HOME", () => {
		const r = resolveWarpPaths({
			home: "/h",
			env: { XDG_CONFIG_HOME: "/x/cfg", XDG_DATA_HOME: "/x/data" },
		});
		expect(r.settings).toBe("/x/cfg/warp-terminal/settings.toml");
		expect(r.xdgTerminalPreference).toBe("/x/cfg/xdg-terminals.list");
		expect(r.themePath).toBe("/x/data/warp-terminal/themes/elysian.yaml");
	});
});

describe("patchWarpSettings", () => {
	it("replaces a built-in string theme + flips system_theme in an existing section", () => {
		const input = `[appearance.themes]\nsystem_theme = true\ntheme = "dark"\n\n[other]\nx = 1\n`;
		const out = patchWarpSettings(input, { name: NAME, path: P, opacity: 77 });
		expect(out).toContain("system_theme = false");
		expect(out).toContain(themeLine);
		expect(out).not.toContain('theme = "dark"');
		expect(out).toContain("[other]\nx = 1");
	});

	it("is idempotent (second run identical)", () => {
		const once = patchWarpSettings(
			`[appearance.themes]\nsystem_theme = true\ntheme = "dark"\n`,
			{ name: NAME, path: P, opacity: 77 },
		);
		expect(patchWarpSettings(once, { name: NAME, path: P, opacity: 77 })).toBe(
			once,
		);
	});

	it("builds a clean section from empty input (fresh install)", () => {
		const out = patchWarpSettings("", {
			name: NAME,
			path: P,
			opacity: 77,
		});
		expect(out).toBe(
			`[appearance.themes]\nsystem_theme = false\n${themeLine}\n\n[appearance.window]\noverride_opacity = 77\n`,
		);
	});

	it("appends the section when absent but other config exists", () => {
		const out = patchWarpSettings(`[appearance]\nspacing = "normal"\n`, {
			name: NAME,
			path: P,
			opacity: 77,
		});
		expect(out).toContain('[appearance]\nspacing = "normal"');
		expect(out).toContain("[appearance.themes]");
		expect(out).toContain(themeLine);
	});

	it("inserts missing keys without duplicating", () => {
		const out = patchWarpSettings(
			`[appearance.themes]\nsystem_theme = true\n`,
			{ name: NAME, path: P, opacity: 77 },
		);
		expect((out.match(/system_theme =/g) || []).length).toBe(1);
		expect(out).toContain(themeLine);
	});

	it("replaces opacity without changing sibling window settings", () => {
		const input = `[appearance.window]\nopen_windows_at_custom_size = false\noverride_opacity = 72\n\n[appearance.themes]\ntheme = "dark"\nsystem_theme = true\n`;
		const out = patchWarpSettings(input, {
			name: NAME,
			path: P,
			opacity: 77,
		});

		expect(out).toContain("override_opacity = 77");
		expect(out).toContain("open_windows_at_custom_size = false");
		expect((out.match(/override_opacity\s*=/g) || []).length).toBe(1);
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
	const preferenceOf = () => path.join(home, ".config", "xdg-terminals.list");

	it("creates a minimal settings.toml when absent", async () => {
		await configureWarp({ home, env: {} });
		const c = fs.readFileSync(settingsOf(), "utf8");
		expect(c).toContain("[appearance.themes]");
		expect(c).toContain("system_theme = false");
		expect(c).toContain('custom = { name = "Elysian"');
		expect(c).toContain("override_opacity = 77");
	});

	it("deploys the exact Elysian palette from the project", async () => {
		const projectRoot = path.resolve(import.meta.dir, "..");
		await configureWarp({ home, env: {}, projectRoot });

		const installed = path.join(
			home,
			".local",
			"share",
			"warp-terminal",
			"themes",
			"elysian.yaml",
		);
		expect(fs.existsSync(installed)).toBe(true);
		expect(Bun.YAML.parse(fs.readFileSync(installed, "utf8"))).toEqual(
			expectedTheme,
		);
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

	it("writes an empty first-capture marker when the preference is absent", async () => {
		await configureWarp({ home, env: {} });

		const capture = `${preferenceOf()}.haoshoku-first-capture`;
		expect(fs.existsSync(capture)).toBe(true);
		expect(fs.readFileSync(capture, "utf8")).toBe("");

		fs.writeFileSync(preferenceOf(), "kitty.desktop\n");
		await configureWarp({ home, env: {} });

		expect(fs.readFileSync(capture, "utf8")).toBe("");
	});

	it("writes an empty first-capture marker when the preference is empty", async () => {
		fs.mkdirSync(path.dirname(preferenceOf()), { recursive: true });
		fs.writeFileSync(preferenceOf(), "");
		await configureWarp({ home, env: {} });

		const capture = `${preferenceOf()}.haoshoku-first-capture`;
		expect(fs.existsSync(capture)).toBe(true);
		expect(fs.readFileSync(capture, "utf8")).toBe("");

		fs.writeFileSync(preferenceOf(), "foot.desktop\n");
		await configureWarp({ home, env: {} });

		expect(fs.readFileSync(capture, "utf8")).toBe("");
	});

	it("deploys every shipped tab config into the XDG tab_configs dir", async () => {
		const projectRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-warp-root-"),
		);
		const srcDir = path.join(projectRoot, "configs", "warp", "tab_configs");
		fs.mkdirSync(srcDir, { recursive: true });
		fs.writeFileSync(path.join(srcDir, "agents.toml"), 'title = "agents"\n');
		fs.writeFileSync(path.join(srcDir, "logs.toml"), 'title = "logs"\n');

		await configureWarp({ home, env: {}, projectRoot });

		const tabConfigDir = path.join(
			home,
			".local",
			"share",
			"warp-terminal",
			"tab_configs",
		);
		expect(
			fs.readFileSync(path.join(tabConfigDir, "agents.toml"), "utf8"),
		).toBe('title = "agents"\n');
		expect(fs.readFileSync(path.join(tabConfigDir, "logs.toml"), "utf8")).toBe(
			'title = "logs"\n',
		);
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});

	it("captures the first terminal preference and keeps Warp assets byte-identical on rerun", async () => {
		fs.mkdirSync(path.dirname(preferenceOf()), { recursive: true });
		fs.writeFileSync(preferenceOf(), "foot.desktop\nkitty.desktop\n");
		fs.mkdirSync(path.dirname(settingsOf()), { recursive: true });
		fs.writeFileSync(settingsOf(), "[appearance]\nfont_size = 14\n");

		const projectRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-warp-root-"),
		);
		const srcDir = path.join(projectRoot, "configs", "warp", "tab_configs");
		const themeDir = path.join(projectRoot, "configs", "warp", "themes");
		fs.mkdirSync(srcDir, { recursive: true });
		fs.mkdirSync(themeDir, { recursive: true });
		fs.writeFileSync(path.join(srcDir, "agents.toml"), 'title = "agents"\n');
		fs.writeFileSync(path.join(srcDir, "logs.toml"), 'title = "logs"\n');
		fs.writeFileSync(path.join(themeDir, "elysian.yaml"), "name: Elysian\n");

		await configureWarp({ home, env: {}, projectRoot });

		expect(fs.readFileSync(preferenceOf(), "utf8")).toBe(
			"# Terminal emulator preference order for xdg-terminal-exec\n# The first found and valid terminal will be used\ndev.warp.Warp.desktop\n",
		);
		const capture = `${preferenceOf()}.haoshoku-first-capture`;
		expect(fs.readFileSync(capture, "utf8")).toBe(
			"foot.desktop\nkitty.desktop\n",
		);

		const assetPaths = [
			preferenceOf(),
			capture,
			settingsOf(),
			path.join(
				home,
				".local",
				"share",
				"warp-terminal",
				"themes",
				"elysian.yaml",
			),
			path.join(
				home,
				".local",
				"share",
				"warp-terminal",
				"tab_configs",
				"agents.toml",
			),
			path.join(
				home,
				".local",
				"share",
				"warp-terminal",
				"tab_configs",
				"logs.toml",
			),
		];
		const afterFirst = assetPaths.map((file) => fs.readFileSync(file));

		await configureWarp({ home, env: {}, projectRoot });

		expect(assetPaths.map((file) => fs.readFileSync(file))).toEqual(afterFirst);
		expect(fs.existsSync(`${preferenceOf()}.bak`)).toBe(false);
		expect(fs.existsSync(`${preferenceOf()}.tmp`)).toBe(false);
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});
});
