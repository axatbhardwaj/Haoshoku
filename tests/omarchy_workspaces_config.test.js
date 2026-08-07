import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const config = fs.readFileSync(
	path.join(import.meta.dir, "..", "configs", "omarchy", "workspaces.conf"),
	"utf8",
);
const bindingsConfig = fs.readFileSync(
	path.join(import.meta.dir, "..", "configs", "omarchy", "bindings.conf"),
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
			"bindd = SUPER, A, Show/focus/hide Haki session, exec, haoshoku-special-workspace haki",
			"bindd = SUPER, I, Show/focus/hide AI assistants workspace, exec, haoshoku-special-workspace assistants",
			"bindd = SUPER, M, Show/focus/hide music workspace, exec, haoshoku-special-workspace music",
			"bindd = SUPER, O, Show/focus/hide 1Password workspace, exec, haoshoku-special-workspace 1password",
			"bindd = SUPER, G, Show/focus/hide communication workspace, exec, haoshoku-special-workspace communication",
			"bindd = SUPER, B, Toggle Flux Chromium workspace, exec, haoshoku-special-workspace browser-toggle flux",
			"bindd = SUPER, D, Toggle DeFi Chromium workspace, exec, haoshoku-special-workspace browser-toggle defi",
			"bindd = SUPER, Y, Show/focus/hide YouTube workspace, exec, haoshoku-special-workspace youtube",
			"bindd = SUPER, R, Show/focus/hide Crunchyroll workspace, exec, haoshoku-special-workspace crunchyroll",
			"bindd = SUPER, F, Show/focus/hide Re:ANIME workspace, exec, haoshoku-special-workspace reanime",
			"bindd = SUPER, S, Toggle stash workspace, togglespecialworkspace, stash",
			"bindd = SUPER SHIFT, X, Show/focus/hide X workspace, exec, haoshoku-special-workspace x",
		];
		for (const bind of toggleBinds) expect(config).toContain(bind);
		expect(
			config.split("\n").filter(
				(line) =>
					line.startsWith("bindd = SUPER, ") &&
					!line.includes("haoshoku-special-workspace numbered ") &&
					// Ten helper-backed toggles plus the stash toggle.
					(line.includes("haoshoku-special-workspace") ||
						line.endsWith("togglespecialworkspace, stash")),
			),
		).toHaveLength(11);
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

	it("routes both AI assistants by exact class without silent placement", () => {
		const expectedRules = [
			String.raw`windowrule = workspace special:assistants, match:class ^com\.anthropic\.Claude$`,
			String.raw`windowrule = workspace special:assistants, match:class ^chrome-chatgpt\.com__-Default$`,
		];
		const assistantRules = config
			.split(/\r?\n/)
			.filter((line) =>
				line.startsWith("windowrule = workspace special:assistants,"),
			);

		expect(assistantRules).toEqual(expectedRules);
		for (const rule of assistantRules) expect(rule).not.toContain(" silent");
		expect("chrome-chatgptXcom__-Default").not.toMatch(
			/^chrome-chatgpt\.com__-Default$/,
		);
	});

	for (const { workspace, classPattern, decoyClass } of [
		{
			workspace: "youtube",
			classPattern: "^chrome-youtube\\.com__-Default$",
			decoyClass: "chrome-youtubeXcom__-Default",
		},
		{
			workspace: "crunchyroll",
			classPattern: "^chrome-www\\.crunchyroll\\.com__-Default$",
			decoyClass: "chrome-wwwXcrunchyrollXcom__-Default",
		},
		{
			workspace: "reanime",
			classPattern: "^chrome-reanime\\.to__home-Default$",
			decoyClass: "chrome-reanimeXto__home-Default",
		},
	]) {
		it(`routes ${workspace} by its escaped app-derived Chromium class without silent placement`, () => {
			const rule = config
				.split(/\r?\n/)
				.find((line) => line.includes(`match:class ${classPattern}`));
			expect(rule).toBe(
				`windowrule = workspace special:${workspace}, match:class ${classPattern}`,
			);
			expect(rule).not.toContain("silent");
			expect(decoyClass).not.toMatch(new RegExp(classPattern));
		});
	}

	// Portal file dialogs open tiled on the workspace underneath, so a revealed
	// special workspace draws over them. `pin` is what rescues them: a pinned
	// floating window renders above whichever workspace is showing.
	it("floats, pins and centers portal file dialogs so special workspaces cannot bury them", () => {
		const portalClass = String.raw`^xdg-desktop-portal-gtk$`;
		const lines = config.split(/\r?\n/);
		for (const rule of ["float", "pin", "center"]) {
			expect(lines).toContain(
				`windowrule = ${rule} on, match:class ${portalClass}`,
			);
		}
		// Scoped to the portal only — Nautilus on SUPER+E must not be pinned.
		const pinned = lines.filter((line) => line.startsWith("windowrule = pin "));
		expect(pinned).toEqual([`windowrule = pin on, match:class ${portalClass}`]);
		expect("nautilus").not.toMatch(new RegExp(portalClass));
	});

	it("owns SUPER+Y, SUPER+R, and SUPER+F exactly once across both overlays", () => {
		const overlayLines = `${bindingsConfig}\n${config}`.split(/\r?\n/);
		for (const [key, expected] of [
			[
				"Y",
				"bindd = SUPER, Y, Show/focus/hide YouTube workspace, exec, haoshoku-special-workspace youtube",
			],
			[
				"R",
				"bindd = SUPER, R, Show/focus/hide Crunchyroll workspace, exec, haoshoku-special-workspace crunchyroll",
			],
			[
				"F",
				"bindd = SUPER, F, Show/focus/hide Re:ANIME workspace, exec, haoshoku-special-workspace reanime",
			],
		]) {
			expect(
				overlayLines.filter((line) =>
					line.startsWith(`bindd = SUPER, ${key},`),
				),
			).toEqual([expected]);
		}
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
