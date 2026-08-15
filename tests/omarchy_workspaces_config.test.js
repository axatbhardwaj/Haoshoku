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
const pc = fs.readFileSync(path.join(overlayDirectory, "workspaces-pc.lua"), "utf8");
const laptop = fs.readFileSync(
	path.join(overlayDirectory, "workspaces-laptop.lua"),
	"utf8",
);

describe("Omarchy Lua workspace behavior", () => {
	it("routes assistants and browser profiles by their exact owned classes", () => {
		const expectedRules = [
			'o.window("^chatgpt$", { workspace = "special:assistants silent" })',
			'o.window("^t3code$", { workspace = "special:t3code silent" })',
			'o.window("^brave-www\\\\.notion\\\\.so__-Default$", { workspace = "10 silent" })',
			'o.window("^brave-x\\\\.com__-Default$", { workspace = "special:x" })',
			'o.window("^chromium-flux$", { workspace = "special:browser-flux" })',
			'o.window("^chromium-defi$", { workspace = "special:browser-defi" })',
		];

		for (const overlay of [pc, laptop])
			for (const rule of expectedRules) expect(overlay).toContain(rule);
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

	it("limits border-color ownership to the DeFi profile", () => {
		for (const overlay of [pc, laptop]) {
			expect(overlay).toContain(
				'o.window("^chromium-defi$", { border_color = "rgb(9762e2) rgb(9762e2)" })',
			);
			expect(overlay).not.toContain('o.window("^chromium-flux$", { border_color');
		}
	});

	it("retains exact special-workspace toggle commands in both device profiles", () => {
		const commands = [
			'o.bind("SUPER + A", "Show/focus/hide Haki session", "haoshoku-special-workspace haki")',
			'o.bind("SUPER + I", "Show/focus/hide ChatGPT workspace", "haoshoku-special-workspace assistants")',
			'o.bind("SUPER + T", "Show/focus/hide T3 Code workspace", "haoshoku-special-workspace t3code")',
			'o.bind("SUPER + B", "Toggle Flux Brave Origin workspace", "haoshoku-special-workspace browser-toggle flux")',
			'o.bind("SUPER + D", "Toggle DeFi Brave Origin workspace", "haoshoku-special-workspace browser-toggle defi")',
			'o.bind("SUPER + SHIFT + G", "Toggle gaming workspace", "haoshoku-gaming-workspace toggle")',
		];

		for (const overlay of [pc, laptop])
			for (const command of commands) expect(overlay).toContain(command);
	});

	it("starts and routes the owned Kitty workspace exactly", () => {
		for (const overlay of [pc, laptop]) {
			expect(overlay).toContain(
				'o.exec_on_start("haoshoku-special-workspace numbered-login 7 kitty")',
			);
			expect(overlay).toContain(
				'o.window("^haoshoku-ws7$", { workspace = "7 silent" })',
			);
			expect(overlay).toContain(
				'o.window("^haoshoku-haki$", { workspace = "special:haki" })',
			);
		}
	});
});
