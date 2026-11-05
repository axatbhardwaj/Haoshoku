import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const overlayDirectory = path.join(
	import.meta.dir,
	"..",
	"configs",
	"omarchy",
	"haoshoku",
);
const pc = fs.readFileSync(
	path.join(overlayDirectory, "workspaces-pc.lua"),
	"utf8",
);
const laptop = fs.readFileSync(
	path.join(overlayDirectory, "workspaces-laptop.lua"),
	"utf8",
);

describe("Omarchy Lua workspace behavior", () => {
	it("omits the retired Paseo desktop package from the Arch install list", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "../common/paru_applist.txt"),
				"utf8",
			)
			.split(/\s+/);
		expect(packages).not.toContain("paseo-bin");
	});

	it("routes fixed-workspace apps without fixing T3 Code to a workspace", () => {
		const expectedRules = [
			'o.window("^chatgpt$", { workspace = "special:assistants silent" })',
			'o.window("^com\\\\.anthropic\\\\.Claude$", { workspace = "special:assistants silent" })',
			'targets.window("brave-www.notion.so__-Default", 10)',
			'o.window("^brave-x\\\\.com__-Default$", { workspace = "special:x" })',
			'o.window("^chromium-flux$", { workspace = "special:browser-flux" })',
		];

		for (const overlay of [pc, laptop]) {
			for (const rule of expectedRules) expect(overlay).toContain(rule);
			expect(overlay).not.toContain('o.window("^com\\\\.t3tools\\\\.T3Code$"');
		}
	});

	it("keeps portal dialogs floating, pinned, and centered without pinning Nautilus", () => {
		const portalRules = [
			'o.window("^xdg-desktop-portal-gtk$", { float = true })',
			'o.window("^xdg-desktop-portal-gtk$", { pin = true })',
			'o.window("^xdg-desktop-portal-gtk$", { center = true })',
		];

		for (const overlay of [pc, laptop]) {
			for (const rule of portalRules) expect(overlay).toContain(rule);
			expect(overlay).not.toContain('o.window("^nautilus$", { pin = true })');
		}
	});

	// Mutation caught: leaving the retired DeFi profile wired keeps a second
	// browser instance alive; Brave Containers in Flux now own multi-account use.
	it("ships a single Flux browser with no DeFi profile wiring", () => {
		for (const overlay of [pc, laptop]) {
			expect(overlay).not.toContain("chromium-defi");
			expect(overlay).not.toContain("browser-toggle defi");
			expect(overlay).not.toContain('o.bind("SUPER + D"');
			expect(overlay).not.toContain(
				'o.window("^chromium-flux$", { border_color',
			);
		}
	});

	it("retains exact application bindings in both device profiles", () => {
		const commands = [
			'o.bind("SUPER + I", "Show/focus/hide AI assistants workspace", "haoshoku-special-workspace assistants")',
			'o.bind("SUPER + T", "T3 Code", o.launch_sole("^com\\\\.t3tools\\\\.T3Code$", "t3code"))',
			'o.bind("SUPER + B", "Toggle Brave Origin workspace", "haoshoku-special-workspace browser-toggle flux")',
			'o.bind("SUPER + SHIFT + G", "Toggle gaming workspace", "haoshoku-gaming-workspace toggle")',
			'o.bind("SUPER + S", "Show/focus/hide Steam workspace", "haoshoku-special-workspace steam")',
		];

		for (const overlay of [pc, laptop]) {
			for (const command of commands) expect(overlay).toContain(command);
			expect(overlay).toContain(
				'"SUPER + F2", "Gaming slot 2 and Omakade", "haoshoku-special-workspace numbered 2 omakade"',
			);
			expect(overlay).not.toContain('o.bind("SUPER + A"');
			expect(overlay).not.toContain(
				"haoshoku-special-workspace numbered 2 steam",
			);
		}
	});

	it("starts login services and routes the owned Ghostty workspace exactly", () => {
		for (const overlay of [pc, laptop]) {
			expect(overlay).toContain('o.exec_on_start("haoshoku-default-browser")');
			expect(overlay).not.toMatch(/paseo/i);
			expect(overlay).toContain('o.exec_on_start("/usr/bin/kdeconnectd")');
			expect(overlay).toContain(
				'o.exec_on_start("haoshoku-special-workspace numbered-login 7 ghostty")',
			);
			expect(overlay).toContain(
				'o.exec_on_start("[workspace special:steam silent] uwsm-app -- steam")',
			);
			// Omakade autostart is opt-in via --gaming-omakade-autostart; the
			// shipped overlay keeps Steam only; SUPER+F2 opens the library.
			expect(overlay).not.toContain("numbered-login 2 omakade");
			expect(overlay).toContain('targets.window("com.haoshoku.ws7", 7)');
			expect(overlay).toContain(
				'o.window("^[Ss]team$", { workspace = "special:steam silent", tile = true })',
			);
			expect(overlay).toContain(
				'targets.window("io.github.tsouth89.Omakade", 2)',
			);
			expect(overlay).toContain(
				'o.window("^com\\\\.haoshoku\\\\.haki$", { workspace = "special:haki" })',
			);
		}
	});

	it("keeps number navigation native and places preferred app actions on Fn", () => {
		for (const overlay of [pc, laptop]) {
			expect(overlay).not.toMatch(/(?:o.bind|hl.unbind)\("SUPER \+ code:/);
			expect(overlay).toContain(
				'"SUPER + F7", "Slot 7 Ghostty", "haoshoku-special-workspace numbered 7 ghostty"',
			);
			expect(overlay).toContain(
				'"SUPER + F5", "Slot 5 and chat", "haoshoku-special-workspace numbered 5 communication-numbered"',
			);
			expect(overlay).toContain(
				'o.exec_on_start("haoshoku-primary-app login")',
			);
			expect(overlay).toContain('require("hypr.haoshoku.primary_app")');
		}
	});
});
