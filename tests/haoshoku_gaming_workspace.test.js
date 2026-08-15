import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(import.meta.dir, "..");
const script = path.join(
	root,
	"configs",
	"scripts",
	"haoshoku-gaming-workspace",
);
const specialWorkspaceScript = path.join(
	root,
	"configs",
	"scripts",
	"haoshoku-special-workspace",
);
const workspacesConfig = fs.readFileSync(
	path.join(root, "configs", "omarchy", "haoshoku", "workspaces-pc.lua"),
	"utf8",
);

describe("gaming workspace configuration", () => {
	it("leaves PC monitor ownership to Omarchy while keeping the laptop gaming workspace ephemeral", () => {
		const laptopConfig = fs.readFileSync(
			path.join(
				root,
				"configs",
				"omarchy",
				"haoshoku",
				"workspaces-laptop.lua",
			),
			"utf8",
		);
		expect(workspacesConfig).not.toContain("hl.workspace_rule");
		expect(laptopConfig).toContain(
			'hl.workspace_rule({ workspace = "11", persistent = false })',
		);
	});

	it("routes Steam windows silently to workspace 11", () => {
		expect(workspacesConfig).toContain(
			'o.window("^[Ss]team$", { workspace = "11 silent" })',
		);
	});

	it("binds SUPER SHIFT G to the gaming workspace script", () => {
		expect(workspacesConfig).toContain(
			'o.bind("SUPER + SHIFT + G", "Toggle gaming workspace", "haoshoku-gaming-workspace toggle")',
		);
	});

	it("ports the gaming block to laptop with topology-only differences", () => {
		const laptopConfig = fs.readFileSync(
			path.join(
				root,
				"configs",
				"omarchy",
				"haoshoku",
				"workspaces-laptop.lua",
			),
			"utf8",
		);

		expect(laptopConfig).toContain(
			'o.window("^[Ss]team$", { workspace = "11 silent" })',
		);
		expect(laptopConfig).toContain(
			'o.bind("SUPER + SHIFT + G", "Toggle gaming workspace", "haoshoku-gaming-workspace toggle")',
		);
		expect(laptopConfig).not.toContain(
			"haoshoku-special-workspace numbered 2 steam",
		);
		expect(laptopConfig).not.toContain("monitor:");
	});
});

describe("haoshoku-gaming-workspace toggle", () => {
	let directory;
	let log;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-gaming-"));
		log = path.join(directory, "calls");
		const hyprctl = path.join(directory, "hyprctl");
		fs.writeFileSync(
			hyprctl,
			`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  "activeworkspace -j") printf '{"id":%s}\\n' "$ACTIVE_WORKSPACE" ;;
  "clients -j") printf '%s\\n' "$HYPR_CLIENTS" ;;
esac
`,
		);
		fs.chmodSync(hyprctl, 0o755);
		fs.symlinkSync(
			specialWorkspaceScript,
			path.join(directory, "haoshoku-special-workspace"),
		);
	});

	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	async function runToggle({ activeWorkspace, clients = [] }) {
		const proc = Bun.spawn([script, "toggle"], {
			env: {
				...process.env,
				ACTIVE_WORKSPACE: String(activeWorkspace),
				CALL_LOG: log,
				HAOSHOKU_GW_HYPRCTL: path.join(directory, "hyprctl"),
				HYPR_CLIENTS: JSON.stringify(clients),
				PATH: `${directory}:${process.env.PATH}`,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		return {
			exitCode: await proc.exited,
			stderr: await new Response(proc.stderr).text(),
		};
	}

	function calls() {
		return fs.readFileSync(log, "utf8").trim().split("\n");
	}

	it("launches missing Steam when toggling into workspace 11", async () => {
		const result = await runToggle({ activeWorkspace: 3 });

		expect(result).toEqual({ exitCode: 0, stderr: "" });
		expect(calls()).toEqual([
			"activeworkspace -j",
			"dispatch workspace 11",
			"clients -j",
			"dispatch exec [workspace 11 silent] uwsm-app -- steam",
		]);
	});

	it("does not launch Steam when toggling out to the previous workspace", async () => {
		const result = await runToggle({ activeWorkspace: 11 });

		expect(result).toEqual({ exitCode: 0, stderr: "" });
		expect(calls()).toEqual([
			"activeworkspace -j",
			"dispatch workspace previous",
		]);
	});

	it("does not relaunch Steam when it is already present on an inbound toggle", async () => {
		const result = await runToggle({
			activeWorkspace: 3,
			clients: [{ class: "steam" }],
		});

		expect(result).toEqual({ exitCode: 0, stderr: "" });
		expect(calls()).toEqual([
			"activeworkspace -j",
			"dispatch workspace 11",
			"clients -j",
		]);
	});
});
