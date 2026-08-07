import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureOmarchyWorkspaces } from "../src/helpers/configure_omarchy_workspaces.js";

const CLI = path.resolve(import.meta.dir, "..", "haoshoku.js");
const PROJECT_ROOT = path.resolve(import.meta.dir, "..");

let tmpHome;
let tmpProjectRoot;

const hyprDir = () => path.join(tmpHome, ".config", "hypr");
const hyprlandConfig = () => path.join(hyprDir(), "hyprland.conf");

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-workspaces-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-workspaces-root-"),
	);
	fs.mkdirSync(hyprDir(), { recursive: true });
	fs.writeFileSync(hyprlandConfig(), "source = ~/.config/hypr/monitors.conf\n");
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

describe("--workspaces CLI mode", () => {
	it("describes every side effect in CLI help", () => {
		const result = Bun.spawnSync([CLI, "--help"], { stdout: "pipe" });

		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString().replace(/\s+/g, " ")).toContain(
			"--workspaces Deploy workspace config to ~/.config/hypr/, install helper script to ~/.local/bin/, add source line to ~/.config/hypr/hyprland.conf, and reload Hyprland",
		);
	});

	it("uses an injected command runner for Hyprland reload validation", async () => {
		const commands = [];

		await configureOmarchyWorkspaces({
			home: tmpHome,
			env: { HYPRLAND_INSTANCE_SIGNATURE: "test" },
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(commands).toEqual([
			"hyprctl reload",
			"hyprctl configerrors",
			`'${path.join(tmpHome, ".local", "bin", "haoshoku-special-workspace")}' numbered-login 7 kitty`,
		]);
	});

	it("deploys workspace configuration through the real CLI wiring", () => {
		fs.cpSync(
			path.join(PROJECT_ROOT, "src"),
			path.join(tmpProjectRoot, "src"),
			{ recursive: true },
		);
		fs.cpSync(
			path.join(PROJECT_ROOT, "configs", "omarchy"),
			path.join(tmpProjectRoot, "configs", "omarchy"),
			{ recursive: true },
		);
		fs.mkdirSync(path.join(tmpProjectRoot, "configs", "scripts"), {
			recursive: true,
		});
		fs.copyFileSync(
			path.join(PROJECT_ROOT, "configs", "scripts", "haoshoku-special-workspace"),
			path.join(
				tmpProjectRoot,
				"configs",
				"scripts",
				"haoshoku-special-workspace",
			),
		);
		fs.copyFileSync(CLI, path.join(tmpProjectRoot, "haoshoku.js"));
		fs.symlinkSync(
			path.join(PROJECT_ROOT, "node_modules"),
			path.join(tmpProjectRoot, "node_modules"),
			"dir",
		);
		const { HYPRLAND_INSTANCE_SIGNATURE: _session, ...isolatedEnv } = process.env;

		const result = Bun.spawnSync(
			[path.join(tmpProjectRoot, "haoshoku.js"), "--workspaces"],
			{
				env: { ...isolatedEnv, HOME: tmpHome },
				stderr: "pipe",
				stdout: "pipe",
			},
		);

		const destination = path.join(hyprDir(), "haoshoku-workspaces.conf");
		expect(result.exitCode).toBe(0);
		expect(fs.readFileSync(destination, "utf8")).toBe(
			fs.readFileSync(
				path.join(PROJECT_ROOT, "configs", "omarchy", "workspaces.conf"),
				"utf8",
			),
		);
		expect(fs.readFileSync(hyprlandConfig(), "utf8")).toContain(
			"source = ~/.config/hypr/haoshoku-workspaces.conf",
		);
	});
});
