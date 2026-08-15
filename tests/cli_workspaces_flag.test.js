import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "..", "haoshoku.js");
const PROJECT_ROOT = path.resolve(import.meta.dir, "..");

let tmpHome;
let tmpProjectRoot;

const hyprDir = () => path.join(tmpHome, ".config", "hypr");

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-workspaces-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-workspaces-root-"),
	);
	fs.mkdirSync(hyprDir(), { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

describe("--workspaces CLI mode", () => {
	it("describes every side effect in CLI help", () => {
		const result = Bun.spawnSync([CLI, "--help"], { stdout: "pipe" });

		expect(result.exitCode).toBe(0);
		const help = result.stdout.toString().replace(/\s+/g, " ");
		expect(help).toContain(
			"--workspaces Deploy the two Lua overlay modules under ~/.config/hypr/haoshoku/, install the helper script, and register the two requires in ~/.config/hypr/hyprland.lua",
		);
		expect(help).not.toContain("monitors.conf");
		expect(help).not.toContain("hyprland.conf");
		expect(help).not.toContain("source =");
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
			path.join(
				PROJECT_ROOT,
				"configs",
				"scripts",
				"haoshoku-special-workspace",
			),
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
		const { HYPRLAND_INSTANCE_SIGNATURE: _session, ...isolatedEnv } =
			process.env;

		const result = Bun.spawnSync(
			[path.join(tmpProjectRoot, "haoshoku.js"), "--workspaces"],
			{
				env: { ...isolatedEnv, HOME: tmpHome },
				stderr: "pipe",
				stdout: "pipe",
			},
		);

		const destination = path.join(hyprDir(), "haoshoku", "workspaces.lua");
		expect(result.exitCode).toBe(0);
		expect(fs.readFileSync(destination, "utf8")).toBe(
			fs.readFileSync(
				path.join(
					PROJECT_ROOT,
					"configs",
					"omarchy",
					"haoshoku",
					"workspaces-pc.lua",
				),
				"utf8",
			),
		);
		expect(fs.readFileSync(path.join(hyprDir(), "hyprland.lua"), "utf8")).toContain(
			'require("hypr.haoshoku.workspaces")',
		);
	});

	it("sets or changes deviceType through the standalone CLI mode", () => {
		fs.writeFileSync(
			path.join(tmpHome, ".haoshoku.json"),
			`${JSON.stringify({ deviceType: "pc", preserved: true })}\n`,
		);
		const result = Bun.spawnSync([CLI, "--device-type", "laptop"], {
			env: { ...process.env, HOME: tmpHome },
			stderr: "pipe",
			stdout: "pipe",
		});

		expect(result.exitCode).toBe(0);
		expect(
			JSON.parse(fs.readFileSync(path.join(tmpHome, ".haoshoku.json"), "utf8")),
		).toEqual({ deviceType: "laptop", preserved: true });
	});

	it("rejects an unroutable standalone deviceType", () => {
		const result = Bun.spawnSync([CLI, "--device-type", "tablet"], {
			env: { ...process.env, HOME: tmpHome },
			stderr: "pipe",
			stdout: "pipe",
		});

		expect(result.exitCode).toBe(2);
		expect(result.stderr.toString()).toContain(
			"Device type must be pc or laptop",
		);
		expect(fs.existsSync(path.join(tmpHome, ".haoshoku.json"))).toBe(false);
	});

	it("rejects an explicitly empty standalone deviceType instead of entering setup", () => {
		const result = Bun.spawnSync(
			[CLI, "--device-type", "", "--os", "unsupported"],
			{
				env: { ...process.env, HOME: tmpHome },
				stderr: "pipe",
				stdout: "pipe",
			},
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.toString()).toContain(
			"Device type must be pc or laptop",
		);
		expect(fs.existsSync(path.join(tmpHome, ".haoshoku.json"))).toBe(false);
	});

});
