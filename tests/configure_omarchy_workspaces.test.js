import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureOmarchyWorkspaces } from "../src/helpers/configure_omarchy_workspaces.js";

describe("configureOmarchyWorkspaces", () => {
	let home;
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-workspaces-"));
		fs.mkdirSync(path.join(home, ".config", "hypr"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".config", "hypr", "hyprland.conf"),
			"source = ~/.config/hypr/monitors.conf\n",
		);
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("deploys once, preserves the main config, and installs an executable helper", async () => {
		const first = await configureOmarchyWorkspaces({ home, env: {} });
		const second = await configureOmarchyWorkspaces({ home, env: {} });
		const main = fs.readFileSync(
			path.join(home, ".config", "hypr", "hyprland.conf"),
			"utf8",
		);
		expect(first).toEqual({
			overlayChanged: true,
			scriptChanged: true,
			sourceChanged: true,
			validated: false,
		});
		expect(second).toEqual({
			overlayChanged: false,
			scriptChanged: false,
			sourceChanged: false,
			validated: false,
		});
		expect(main).toContain("source = ~/.config/hypr/monitors.conf");
		expect(
			main.match(/source = ~\/\.config\/hypr\/haoshoku-workspaces\.conf/g),
		).toHaveLength(1);
		expect(
			fs.statSync(
				path.join(home, ".local", "bin", "haoshoku-special-workspace"),
			).mode & 0o111,
		).toBe(0o111);
	});

	it("backs up a differing managed overlay", async () => {
		const overlay = path.join(
			home,
			".config",
			"hypr",
			"haoshoku-workspaces.conf",
		);
		fs.writeFileSync(overlay, "old\n");
		await configureOmarchyWorkspaces({ home, env: {}, now: () => 42 });
		expect(fs.readFileSync(`${overlay}.bak.42`, "utf8")).toBe("old\n");
	});

	it("refuses to invent a non-Omarchy main config", async () => {
		fs.rmSync(path.join(home, ".config", "hypr", "hyprland.conf"));
		expect(configureOmarchyWorkspaces({ home, env: {} })).rejects.toThrow(
			"config not found",
		);
	});

	it("reloads and checks errors only in a live Hyprland session", async () => {
		const commands = [];
		const result = await configureOmarchyWorkspaces({
			home,
			env: { HYPRLAND_INSTANCE_SIGNATURE: "test" },
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});
		expect(commands).toEqual(["hyprctl reload", "hyprctl configerrors"]);
		expect(result.validated).toBe(true);
	});
});
