import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const config = fs.readFileSync(
	path.join(import.meta.dir, "..", "configs", "omarchy", "workspaces.conf"),
	"utf8",
);

describe("Omarchy workspace overlay", () => {
	it("pins the restored numbered workspaces to the intended monitors", () => {
		for (const [workspace, monitor] of [
			[1, "DP-1"],
			[2, "DP-1"],
			[3, "DP-1"],
			[4, "HDMI-A-1"],
			[5, "HDMI-A-1"],
			[6, "DP-2"],
			[7, "DP-2"],
			[10, "DP-2"],
		]) {
			expect(config).toContain(`workspace = ${workspace}, monitor:${monitor}`);
		}
	});

	it("is deployed only in the Omarchy branch and after monitor restoration", () => {
		const installer = fs.readFileSync(
			path.join(import.meta.dir, "..", "src", "os_scripts", "cachyos.js"),
			"utf8",
		);
		const monitorCall = "if (isOmarchy) await configureOmarchyMonitors();";
		const workspaceCall = "if (isOmarchy) await configureOmarchyWorkspaces();";
		expect(installer).toContain(monitorCall);
		expect(installer).toContain(workspaceCall);
		expect(installer.indexOf(workspaceCall)).toBeGreaterThan(
			installer.indexOf(monitorCall),
		);
	});

	it("uses only the approved special-workspace key namespace", () => {
		for (const key of ["A", "I", "M", "O", "G", "B", "D", "H"])
			expect(config).toContain(`SUPER CTRL SHIFT, ${key}`);
		expect(config).toContain("SUPER CTRL SHIFT ALT, H");
	});

	it("binds browser shortcuts to explicit toggle commands", () => {
		expect(config).toContain(
			"bindd = SUPER CTRL SHIFT, B, Toggle Flux Chromium workspace, exec, haoshoku-special-workspace browser-toggle flux",
		);
		expect(config).toContain(
			"bindd = SUPER CTRL SHIFT, D, Toggle DeFi Chromium workspace, exec, haoshoku-special-workspace browser-toggle defi",
		);
	});

	it("routes Notion by its exact app-derived Chromium class", () => {
		expect(config).toContain(
			"windowrule = workspace 10 silent, match:class ^chrome-www\\.notion\\.so__-Default$",
		);
	});

	it("routes WhatsApp by its exact app-derived Chromium class", () => {
		expect(config).toContain(
			"windowrule = workspace special:communication, match:class ^(signal|Signal|chrome-web\\.whatsapp\\.com__-Default)$",
		);
	});

	it("does not retain the retired Notion Chromium class", () => {
		expect(config).not.toContain("chromium-notion");
	});

	it("does not retain the retired WhatsApp Chromium class", () => {
		expect(config).not.toContain("chromium-whatsapp");
	});

	it("keeps retired desktops, browsers, and visual ownership out", () => {
		expect(config).not.toMatch(
			/caelestia|brave|kde|opacity|blur|decoration|wallpaper/i,
		);
		expect(config).not.toContain("unbind =");
	});
});
