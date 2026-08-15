import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const config = fs.readFileSync(
	path.join(import.meta.dir, "..", "configs", "omarchy", "workspaces-pc.conf"),
	"utf8",
);
const laptopConfig = fs.readFileSync(
	path.join(
		import.meta.dir,
		"..",
		"configs",
		"omarchy",
		"workspaces-laptop.conf",
	),
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
			[8, "DP-1"],
			[9, "HDMI-A-1"],
			[10, "DP-2"],
		]) {
			expect(config).toContain(`workspace = ${workspace}, monitor:${monitor}`);
		}
	});

	it("uses dedicated special-workspace toggles and leaves Meta+I unbound", () => {
		const toggleBinds = [
			"bindd = SUPER, A, Show/focus/hide Haki session, exec, haoshoku-special-workspace haki",
			"bindd = SUPER, M, Show/focus/hide music workspace, exec, haoshoku-special-workspace music",
			"bindd = SUPER, O, Show/focus/hide 1Password workspace, exec, haoshoku-special-workspace 1password",
			"bindd = SUPER, G, Show/focus/hide communication workspace, exec, haoshoku-special-workspace communication",
			"bindd = SUPER, B, Toggle Flux Brave Origin workspace, exec, haoshoku-special-workspace browser-toggle flux",
			"bindd = SUPER, D, Toggle DeFi Brave Origin workspace, exec, haoshoku-special-workspace browser-toggle defi",
			"bindd = SUPER, Y, Show/focus/hide YouTube workspace, exec, haoshoku-special-workspace youtube",
			"bindd = SUPER, J, Show/focus/hide JioHotstar workspace, exec, haoshoku-special-workspace jiohotstar",
			"bindd = SUPER, R, Show/focus/hide Crunchyroll workspace, exec, haoshoku-special-workspace crunchyroll",
			"bindd = SUPER, F, Show/focus/hide Re:ANIME workspace, exec, haoshoku-special-workspace reanime",
			"bindd = SUPER, S, Toggle stash workspace, togglespecialworkspace, stash",
			"bindd = SUPER SHIFT, X, Show/focus/hide X workspace, exec, haoshoku-special-workspace x",
		];
		for (const bind of toggleBinds) expect(config).toContain(bind);
		for (const overlay of [config, laptopConfig]) {
			expect(overlay).not.toMatch(/^bind\w* = SUPER, I,/m);
		}
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
			"bindd = SUPER, B, Toggle Flux Brave Origin workspace, exec, haoshoku-special-workspace browser-toggle flux",
		);
		expect(config).toContain(
			"bindd = SUPER, D, Toggle DeFi Brave Origin workspace, exec, haoshoku-special-workspace browser-toggle defi",
		);
	});

	it("keeps the DEFI profile violet in both border states while Flux inherits the theme", () => {
		const profileBorderRules = config
			.split(/\r?\n/)
			.filter((line) => line.includes("match:class ^chromium-"));

		expect(profileBorderRules).toContain(
			"windowrule = border_color rgb(9762e2) rgb(9762e2), match:class ^chromium-defi$",
		);
		expect(profileBorderRules).not.toContain(
			"windowrule = border_color rgb(9762e2) rgb(9762e2), match:class ^chromium-flux$",
		);
		expect(profileBorderRules).not.toContain(
			"windowrule = border_color rgb(62e2a4) rgb(62e2a4), match:class ^chromium-flux$",
		);
	});

	it("restricts every border-color rule to a Haoshoku-owned browser profile class", () => {
		const borderRules = config
			.split(/\r?\n/)
			.filter((line) => line.startsWith("windowrule = border_color "));

		expect(borderRules.length).toBeGreaterThan(0);
		for (const rule of borderRules) {
			const classPattern = rule.match(/, match:class (\S+)$/)?.[1];
			expect(["^chromium-flux$", "^chromium-defi$"]).toContain(classPattern);
		}
	});

	it("routes Notion by its exact app-derived Brave class", () => {
		expect(config).toContain(
			"windowrule = workspace 10 silent, match:class ^brave-www\\.notion\\.so__-Default$",
		);
	});

	it("routes workspace 7 through a dedicated Kitty class", () => {
		expect(config).toContain(
			"bindd = SUPER, code:16, Workspace 7 and Kitty, exec, haoshoku-special-workspace numbered 7 kitty",
		);
		expect(config).toContain(
			"exec-once = haoshoku-special-workspace numbered-login 7 kitty",
		);
		for (const overlay of [config, laptopConfig]) {
			expect(overlay).toContain(
				"windowrule = workspace 7 silent, match:class ^haoshoku-ws7$",
			);
			expect(overlay).toContain(
				"windowrule = workspace special:haki, match:class ^haoshoku-haki$",
			);
			expect(overlay).toContain(
				"windowrule = workspace special:agents, match:class ^haoshoku-agents$",
			);
			expect(overlay).not.toMatch(/match:class \^dev\\\.warp\\\.Warp\$/);
		}
	});

	it("routes X by its exact app-derived Brave class to its special workspace", () => {
		expect(config).toContain(
			"windowrule = workspace special:x, match:class ^brave-x\\.com__-Default$",
		);
		expect(config).not.toContain(
			"windowrule = workspace 6 silent, match:class ^brave-x\\.com__-Default$",
		);
	});

	it("routes Claude to workspace 1 and ChatGPT to workspace 2 silently", () => {
		const expectedRules = [
			String.raw`windowrule = workspace 1 silent, match:class ^com\.anthropic\.Claude$`,
			"windowrule = workspace 2 silent, match:class ^chatgpt$",
		];
		for (const overlay of [config, laptopConfig]) {
			expect(overlay).toContain(
				"exec-once = haoshoku-special-workspace assistants",
			);
			const assistantRules = overlay
				.split(/\r?\n/)
				.filter(
					(line) =>
						line.includes("match:class ^com\\.anthropic\\.Claude$") ||
						line.includes("match:class ^chatgpt$"),
				);

			expect(assistantRules).toEqual(expectedRules);
			for (const rule of assistantRules) {
				expect(rule).not.toMatch(/(?:float|pin|size|fullscreen|monitor)/);
			}
			expect(overlay).not.toContain("special:assistants");
		}
		expect("chatgpt-desktop").not.toMatch(/^chatgpt$/);
	});

	it("leaves the stock Meta+1 workspace switch enabled in both device overlays", () => {
		for (const overlay of [config, laptopConfig]) {
			expect(overlay).not.toContain("unbind = SUPER, code:10");
		}
	});

	for (const { workspace, classPattern, decoyClass } of [
		{
			workspace: "youtube",
			classPattern: "^brave-youtube\\.com__-Default$",
			decoyClass: "brave-youtubeXcom__-Default",
		},
		{
			workspace: "jiohotstar",
			classPattern: "^brave-www\\.jiohotstar\\.com__-Default$",
			decoyClass: "brave-wwwXjiohotstarXcom__-Default",
		},
		{
			workspace: "crunchyroll",
			classPattern: "^brave-www\\.crunchyroll\\.com__-Default$",
			decoyClass: "brave-wwwXcrunchyrollXcom__-Default",
		},
		{
			workspace: "reanime",
			classPattern: "^brave-reanime\\.to__home-Default$",
			decoyClass: "brave-reanimeXto__home-Default",
		},
	]) {
		it(`routes ${workspace} by its escaped app-derived Brave class without silent placement`, () => {
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

	it("keeps the JioHotstar class rule and SUPER+J toggle identical on laptop", () => {
		expect(laptopConfig).toContain(
			"windowrule = workspace special:jiohotstar, match:class ^brave-www\\.jiohotstar\\.com__-Default$",
		);
		expect(laptopConfig).toContain(
			"bindd = SUPER, J, Show/focus/hide JioHotstar workspace, exec, haoshoku-special-workspace jiohotstar",
		);
	});

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

	it("owns the streaming workspace keys exactly once across both overlays", () => {
		const overlayLines = `${bindingsConfig}\n${config}`.split(/\r?\n/);
		for (const [key, expected] of [
			[
				"Y",
				"bindd = SUPER, Y, Show/focus/hide YouTube workspace, exec, haoshoku-special-workspace youtube",
			],
			[
				"J",
				"bindd = SUPER, J, Show/focus/hide JioHotstar workspace, exec, haoshoku-special-workspace jiohotstar",
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
		expect("brave-xXcom__-Default").not.toMatch(new RegExp(rule));
	});

	it("keeps workspace 6 pinned to the portrait monitor", () => {
		expect(config).toContain("workspace = 6, monitor:DP-2");
	});

	it("routes WhatsApp by its exact app-derived Brave class", () => {
		expect(config).toContain(
			"windowrule = workspace special:communication, match:class ^(signal|Signal|brave-web\\.whatsapp\\.com__-Default)$",
		);
	});

	it("does not retain the retired Notion Chromium class", () => {
		expect(config).not.toContain("chromium-notion");
	});

	it("does not retain the retired WhatsApp Chromium class", () => {
		expect(config).not.toContain("chromium-whatsapp");
	});

	it("keeps retired desktops, browsers, and visual ownership out", () => {
		const visualPolicy = config
			.split(/\r?\n/)
			.map((line) =>
				line.startsWith("bindd = ")
					? line.replace(
							/^(bindd = [^,]+, [^,]+), [^,]+,/,
							"$1, <description>,",
						)
					: line,
			)
			.join("\n")
			.replace(/brave-[^\s$]*__[^\s$]*-Default/g, "");
		expect(visualPolicy).not.toMatch(
			/caelestia|brave|kde|opacity|blur|decoration|wallpaper/i,
		);
	});
});
