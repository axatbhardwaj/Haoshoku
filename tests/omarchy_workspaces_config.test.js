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

	it("uses dedicated special-workspace toggles", () => {
		const toggleBinds = [
			"bindd = SUPER, A, Show/focus/hide agents workspace, exec, haoshoku-special-workspace agents",
			"bindd = SUPER, I, Show/focus/hide Claude Desktop workspace, exec, haoshoku-special-workspace claude-desktop",
			"bindd = SUPER, M, Show/focus/hide music workspace, exec, haoshoku-special-workspace music",
			"bindd = SUPER, O, Show/focus/hide 1Password workspace, exec, haoshoku-special-workspace 1password",
			"bindd = SUPER, G, Show/focus/hide communication workspace, exec, haoshoku-special-workspace communication",
			"bindd = SUPER, B, Toggle Flux Chromium workspace, exec, haoshoku-special-workspace browser-toggle flux",
			"bindd = SUPER, D, Toggle DeFi Chromium workspace, exec, haoshoku-special-workspace browser-toggle defi",
			"bindd = SUPER, S, Toggle stash workspace, togglespecialworkspace, stash",
			"bindd = SUPER SHIFT, X, Show/focus/hide X workspace, exec, haoshoku-special-workspace x",
		];
		for (const bind of toggleBinds) expect(config).toContain(bind);
		expect(
			config.split("\n").filter(
				(line) =>
					line.startsWith("bindd = SUPER, ") &&
					!line.includes("haoshoku-special-workspace numbered ") &&
					// Seven helper-backed toggles plus the stash toggle.
					(line.includes("haoshoku-special-workspace") ||
						line.endsWith("togglespecialworkspace, stash")),
			),
		).toHaveLength(8);
		expect(config).toContain(
			"bindd = SUPER SHIFT, S, Stash focused window, movetoworkspacesilent, special:stash",
		);
		expect(config).not.toMatch(
			/^bindd = SUPER CTRL SHIFT(?: ALT)?, [A-Z], .*?(?:haoshoku-special-workspace|togglespecialworkspace, stash|movetoworkspacesilent, special:stash)$/m,
		);
	});

	it("binds browser shortcuts to explicit toggle commands", () => {
		expect(config).toContain(
			"bindd = SUPER, B, Toggle Flux Chromium workspace, exec, haoshoku-special-workspace browser-toggle flux",
		);
		expect(config).toContain(
			"bindd = SUPER, D, Toggle DeFi Chromium workspace, exec, haoshoku-special-workspace browser-toggle defi",
		);
	});

	it("routes Notion by its exact app-derived Chromium class", () => {
		expect(config).toContain(
			"windowrule = workspace 10 silent, match:class ^chrome-www\\.notion\\.so__-Default$",
		);
	});

	it("routes X by its exact app-derived Chromium class to its special workspace", () => {
		expect(config).toContain(
			"windowrule = workspace special:x, match:class ^chrome-x\\.com__-Default$",
		);
		expect(config).not.toContain(
			"windowrule = workspace 6 silent, match:class ^chrome-x\\.com__-Default$",
		);
	});

	it("does not let X's class regex match a decoy character", () => {
		const rule = config.match(
			/^windowrule = workspace special:x, match:class (.+)$/m,
		)?.[1];
		expect(rule).toBeDefined();
		expect("chrome-xXcom__-Default").not.toMatch(new RegExp(rule));
	});

	it("keeps workspace 6 pinned to the portrait monitor", () => {
		expect(config).toContain("workspace = 6, monitor:DP-2");
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
	});
});
