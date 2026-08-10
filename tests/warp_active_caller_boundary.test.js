import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");
const activeRouteFiles = [
	"configs/caelestia/cli.json",
	"configs/omarchy/workspaces-pc.conf",
	"configs/omarchy/workspaces-laptop.conf",
	"configs/omarchy/bindings.conf",
	"configs/caelestia/hypr-user-pc.conf",
	"configs/caelestia/hypr-user-laptop.conf",
	"src/helpers/configure_hyprland.js",
	"src/helpers/configure_omarchy_workspaces.js",
	"src/helpers/configure_kde_plasma.js",
	"src/helpers/configure_kde_activities.js",
	"configs/kwin/scripts/haoshoku-activities-placement/contents/code/main.js",
	"configs/kde_shortcuts.kksrc",
	"configs/scripts/haoshoku-special-workspace",
];
const retiredTerminalLauncher = /\b(?:kitty|foot|ghostty|alacritty|agents-toggle)\b/i;

function activeRuntimeText(relativePath) {
	return fs
		.readFileSync(path.join(root, relativePath), "utf8")
		.split(/\r?\n/)
		.filter((line) => !/^\s*[#;]/.test(line))
		.join("\n")
		.replace("[services][kitty.desktop]\n_launch=none", "");
}

describe("active terminal caller boundary", () => {
	it("keeps all active terminal command routes on Warp while retaining Kitty fallback", () => {
		for (const relativePath of activeRouteFiles.filter(
			(path) => path !== "configs/caelestia/cli.json",
		)) {
			const content = activeRuntimeText(relativePath);
			expect(content, relativePath).not.toMatch(retiredTerminalLauncher);
		}

		const cliJson = JSON.parse(
			fs.readFileSync(path.join(root, "configs", "caelestia", "cli.json"), "utf8"),
		);
		for (const group of Object.values(cliJson.toggles)) {
			for (const toggle of Object.values(group)) {
				if (Array.isArray(toggle.command)) {
					expect(toggle.command.join("\u0000")).not.toMatch(
						retiredTerminalLauncher,
					);
				}
			}
		}
		expect(cliJson.toggles.sysmon.btop.command).toEqual([
			"xdg-terminal-exec",
			"--",
			"env",
			"LC_ALL=C.UTF-8",
			"fish",
			"-C",
			"exec btop",
		]);

		const packages = fs.readFileSync(
			path.join(root, "common", "paru_applist.txt"),
			"utf8",
		);
		expect(packages).toContain("kitty");
		expect(packages).toContain("warp-terminal-bin");
		expect(
			fs.existsSync(path.join(root, "configs", "kitty", "kitty.conf")),
		).toBe(true);
	});

	it("assigns KDE Meta+Return to Warp and uses a terminal-neutral Fastfetch logo", () => {
		const kdeShortcuts = fs.readFileSync(
			path.join(root, "configs", "kde_shortcuts.kksrc"),
			"utf8",
		);
		expect(kdeShortcuts).toContain("[services][kitty.desktop]\n_launch=none");
		expect(kdeShortcuts).toContain(
			"[services][dev.warp.Warp.desktop]\n_launch=Meta+Return",
		);

		const fastfetch = Bun.JSONC.parse(
			fs.readFileSync(path.join(root, "configs", "fastfetch", "config.jsonc"), "utf8"),
		);
		expect(fastfetch.logo.type).toBe("auto");
	});
});
