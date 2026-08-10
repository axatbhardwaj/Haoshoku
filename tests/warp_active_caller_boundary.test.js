import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");
const activeRouteFiles = [
	"configs/omarchy/workspaces-pc.conf",
	"configs/omarchy/workspaces-laptop.conf",
	"configs/caelestia/hypr-user-pc.conf",
	"configs/caelestia/hypr-user-laptop.conf",
	"src/helpers/configure_omarchy_workspaces.js",
	"src/helpers/configure_kde_plasma.js",
	"src/helpers/configure_kde_activities.js",
	"configs/kwin/scripts/haoshoku-activities-placement/contents/code/main.js",
	"configs/kde_shortcuts.kksrc",
	"configs/scripts/haoshoku-special-workspace",
];

describe("active terminal caller boundary", () => {
	it("uses Warp routes while retaining the inactive Kitty fallback", () => {
		for (const relativePath of activeRouteFiles) {
			const content = fs
				.readFileSync(path.join(root, relativePath), "utf8")
				.replace("[services][kitty.desktop]\n_launch=none", "");
			expect(content, relativePath).not.toMatch(/kitty|agents-toggle/i);
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
