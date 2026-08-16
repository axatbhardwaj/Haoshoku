import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");
const activeTextRouteFiles = [
	"configs/omarchy/haoshoku/workspaces-pc.lua",
	"configs/omarchy/haoshoku/workspaces-laptop.lua",
	"configs/omarchy/haoshoku/bindings.lua",
	"src/common/device_type.js",
	"src/helpers/configure_omarchy_workspaces.js",
	"src/helpers/configure_kde_plasma.js",
	"src/helpers/configure_kde_activities.js",
	"configs/kwin/scripts/haoshoku-activities-placement/contents/code/main.js",
	"configs/scripts/haoshoku-special-workspace",
];
const retiredTerminalLauncher =
	/\b(?:warp-terminal|foot|ghostty|alacritty|konsole|agents-toggle)\b/i;

function activeRuntimeText(relativePath) {
	return fs
		.readFileSync(path.join(root, relativePath), "utf8")
		.split(/\r?\n/)
		.filter((line) => !/^\s*(?:#|;|--)/.test(line))
		.join("\n");
}

function kdeServiceLaunches(kdeShortcuts) {
	const launches = new Map();
	let desktopId;

	for (const line of kdeShortcuts.split(/\r?\n/)) {
		const section = line.match(/^\[services\]\[(.+)\]$/);
		if (section) {
			desktopId = section[1];
			continue;
		}
		const launch = line.match(/^_launch=(.+)$/);
		if (desktopId && launch) launches.set(desktopId, launch[1]);
	}

	return launches;
}

describe("active terminal caller boundary", () => {
	it("keeps all active terminal command routes on Kitty while retaining Warp dormant", () => {
		for (const relativePath of activeTextRouteFiles) {
			const content = activeRuntimeText(relativePath);
			expect(content, relativePath).not.toMatch(retiredTerminalLauncher);
		}

		const packages = fs.readFileSync(
			path.join(root, "common", "paru_applist.txt"),
			"utf8",
		);
		expect(packages).toContain("kitty");
		expect(packages).toContain("warp-terminal-bin");
		expect(
			fs.existsSync(path.join(root, "configs", "kitty", "kitty.conf")),
		).toBe(true);
		expect(
			fs.existsSync(path.join(root, "configs", "ghostty", "config.ghostty")),
		).toBe(true);
		expect(
			fs.existsSync(path.join(root, "configs", "alacritty", "alacritty.toml")),
		).toBe(true);
		const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
		expect(changelog).toContain(
			"Keep one dedicated home-rooted kitty terminal on workspace 7",
		);
		expect(activeTextRouteFiles).not.toContain("CHANGELOG.md");
	});

	it("assigns KDE Meta+Return to Kitty and uses a terminal-neutral Fastfetch logo", () => {
		const kdeShortcuts = fs.readFileSync(
			path.join(root, "configs", "kde_shortcuts.kksrc"),
			"utf8",
		);
		const serviceLaunches = kdeServiceLaunches(kdeShortcuts);
		for (const [desktopId, launch] of serviceLaunches) {
			if (retiredTerminalLauncher.test(desktopId)) {
				expect(launch, desktopId).toBe("none");
			}
		}
		expect(serviceLaunches.get("kitty.desktop")).toBe("Meta+Return");
		expect(serviceLaunches.get("org.kde.konsole.desktop")).toBe("none");
		expect(serviceLaunches.get("dev.warp.Warp.desktop")).toBe("none");

		const fastfetch = Bun.JSONC.parse(
			fs.readFileSync(
				path.join(root, "configs", "fastfetch", "config.jsonc"),
				"utf8",
			),
		);
		expect(fastfetch.logo.type).toBe("auto");
	});
});
