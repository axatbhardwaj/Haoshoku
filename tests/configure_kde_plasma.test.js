import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncKdePlasma } from "../src/helpers/configure_kde_plasma.js";

describe("syncKdePlasma", () => {
	let home;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-plasma-"));
		fs.mkdirSync(path.join(home, ".config"), { recursive: true });
	});

	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("preserves unrelated shortcuts while installing KDE-owned mappings", async () => {
		const shortcuts = path.join(home, ".config", "kglobalshortcutsrc");
		fs.writeFileSync(shortcuts, "[custom]\nKeep=Meta+K,Meta+K,Keep me\n");

		await syncKdePlasma({ home, reload: false });

		const result = fs.readFileSync(shortcuts, "utf8");
		expect(result).toContain("Keep=Meta+K,Meta+K,Keep me");
		expect(result).toContain("Edit Tiles=none,none,Toggle Tiles Editor");
		expect(fs.existsSync(`${shortcuts}.haoshoku-first-capture`)).toBe(true);
	});

	it("installs portable app launchers and no Hyprland-only commands", async () => {
		const applications = path.join(home, ".local", "share", "applications");
		fs.mkdirSync(applications, { recursive: true });
		fs.writeFileSync(
			path.join(applications, "haoshoku-browser.desktop"),
			"retired launcher",
		);
		await syncKdePlasma({ home, reload: false });

		const files = fs
			.readdirSync(applications)
			.filter((f) => f.startsWith("haoshoku-"));
		const content = files
			.map((file) => fs.readFileSync(path.join(applications, file), "utf8"))
			.join("\n");
		expect(content).toContain("X-KDE-Shortcuts=Meta+T");
		expect(content).toContain("Exec=kitty");
		expect(content).toContain("Exec=dolphin");
		expect(content).toContain("Exec=zeditor");
		expect(content).toContain("Exec=brave --profile-directory=Default");
		expect(content).toContain("X-KDE-Shortcuts=Meta+B");
		expect(content).toContain('Exec=brave --profile-directory="Profile 1"');
		expect(content).toContain("X-KDE-Shortcuts=Meta+W");
		expect(files).not.toContain("haoshoku-browser.desktop");
		expect(content).not.toMatch(
			/hyprctl|caelestia|game-performance --reset|lockfix/,
		);
	});

	it("unbinds Plasma shortcuts that conflict with familiar app launchers", async () => {
		await syncKdePlasma({ home, reload: false });
		const shortcuts = fs.readFileSync(
			path.join(home, ".config", "kglobalshortcutsrc"),
			"utf8",
		);
		expect(shortcuts).toContain("Edit Tiles=none,none,Toggle Tiles Editor");
		expect(shortcuts).toContain("Overview=none,none,Toggle Overview");
		expect(shortcuts).toContain(
			"KrohnkiteIncrease=none,none,Krohnkite: Increase",
		);
		expect(shortcuts).toContain(
			"KrohnkiteMonocleLayout=none,none,Krohnkite: Monocle Layout",
		);
		expect(shortcuts).toContain(
			"next activity=none,none,Walk through activities",
		);
		expect(shortcuts).toContain(
			"powerProfile=Battery,Battery,Switch Power Profile",
		);
	});

	it("restores the familiar Meta+M Spotify launcher", async () => {
		await syncKdePlasma({ home, reload: false });
		const launcher = fs.readFileSync(
			path.join(
				home,
				".local",
				"share",
				"applications",
				"haoshoku-music.desktop",
			),
			"utf8",
		);
		expect(launcher).toContain("Exec=spotify");
		expect(launcher).toContain("X-KDE-Shortcuts=Meta+M");
	});

	it("never creates or modifies kwinrc", async () => {
		const kwinrc = path.join(home, ".config", "kwinrc");
		fs.writeFileSync(kwinrc, "[Windows]\nFocusPolicy=ClickToFocus\n");

		await syncKdePlasma({ home, reload: false });

		expect(fs.readFileSync(kwinrc, "utf8")).toBe(
			"[Windows]\nFocusPolicy=ClickToFocus\n",
		);
		expect(fs.existsSync(`${kwinrc}.haoshoku-first-capture`)).toBe(false);
	});

	it("never creates or modifies kwinrulesrc", async () => {
		const rulesFile = path.join(home, ".config", "kwinrulesrc");
		const original =
			"[General]\ncount=1\nrules=my-existing-rule\n\n[my-existing-rule]\nDescription=Keep me\n";
		fs.writeFileSync(rulesFile, original);

		await syncKdePlasma({ home, reload: false });

		expect(fs.readFileSync(rulesFile, "utf8")).toBe(original);
		expect(fs.existsSync(`${rulesFile}.haoshoku-first-capture`)).toBe(false);
	});

	it("leaves kwinrc and kwinrulesrc absent when they did not exist", async () => {
		await syncKdePlasma({ home, reload: false });

		expect(fs.existsSync(path.join(home, ".config", "kwinrc"))).toBe(false);
		expect(fs.existsSync(path.join(home, ".config", "kwinrulesrc"))).toBe(false);
	});

	it("never touches virtual desktops in the running KWin session", async () => {
		const commands = [];
		await syncKdePlasma({
			home,
			run: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(commands.join("\n")).not.toContain("VirtualDesktopManager");
		expect(commands).toContain("kbuildsycoca6");
		expect(commands).toContain("qdbus6 org.kde.KWin /KWin reconfigure");
	});

	it("writes no desktop switching or window-move shortcuts", async () => {
		await syncKdePlasma({ home, reload: false });
		const shortcuts = fs.readFileSync(
			path.join(home, ".config", "kglobalshortcutsrc"),
			"utf8",
		);

		expect(shortcuts).not.toContain("Switch to Desktop");
		expect(shortcuts).not.toContain("Window to Desktop");
		expect(shortcuts).not.toContain("activate task manager entry");
	});

	it("is idempotent", async () => {
		await syncKdePlasma({ home, reload: false });
		const first = fs.readFileSync(
			path.join(home, ".config", "kglobalshortcutsrc"),
			"utf8",
		);
		await syncKdePlasma({ home, reload: false });
		const second = fs.readFileSync(
			path.join(home, ".config", "kglobalshortcutsrc"),
			"utf8",
		);
		expect(second).toBe(first);
	});
});
