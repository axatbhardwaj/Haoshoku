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
	it("keeps gaming workspace 2 persistent without overlay-specific rules", () => {
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
		const gamingSpecificWorkspaceRule =
			/hl\.workspace_rule\(\{\s*workspace = "(?:2|11)"(?=[^}]*\bpersistent = false\b)[^}]*\}\)/;
		expect(workspacesConfig).not.toMatch(gamingSpecificWorkspaceRule);
		expect(laptopConfig).toContain(
			'hl.workspace_rule({ workspace = "2", persistent = true })',
		);
		expect(laptopConfig).not.toMatch(gamingSpecificWorkspaceRule);
	});

	it("routes Steam windows silently to workspace 2 and tiles them", () => {
		expect(workspacesConfig).toContain(
			'o.window("^[Ss]team$", { workspace = "2 silent", tile = true })',
		);
	});

	it("routes Omakade windows silently to workspace 2", () => {
		expect(workspacesConfig).toContain(
			'o.window("^io\\\\.github\\\\.tsouth89\\\\.Omakade$", { workspace = "2 silent" })',
		);
	});

	it("starts Steam and Omakade silently on workspace 2 at login", () => {
		expect(workspacesConfig).toContain(
			'o.exec_on_start("haoshoku-special-workspace numbered-login 2 steam")',
		);
		expect(workspacesConfig).toContain(
			'o.exec_on_start("haoshoku-special-workspace numbered-login 2 omakade")',
		);
	});

	it("binds SUPER+2 to Omakade rather than Steam", () => {
		expect(workspacesConfig).toContain(
			"haoshoku-special-workspace numbered 2 omakade",
		);
		expect(workspacesConfig).not.toContain(
			"haoshoku-special-workspace numbered 2 steam",
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
			'o.window("^[Ss]team$", { workspace = "2 silent", tile = true })',
		);
		expect(laptopConfig).toContain(
			'o.window("^io\\\\.github\\\\.tsouth89\\\\.Omakade$", { workspace = "2 silent" })',
		);
		expect(laptopConfig).toContain(
			'o.bind("SUPER + SHIFT + G", "Toggle gaming workspace", "haoshoku-gaming-workspace toggle")',
		);
		expect(laptopConfig).toContain(
			"haoshoku-special-workspace numbered 2 omakade",
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
if [[ "$1" == "dispatch" ]]; then
  [[ -z "$DISPATCH_OUTPUT" ]] || printf '%s\\n' "$DISPATCH_OUTPUT"
  exit "$DISPATCH_EXIT_CODE"
fi
`,
		);
		fs.chmodSync(hyprctl, 0o755);
		fs.symlinkSync(
			specialWorkspaceScript,
			path.join(directory, "haoshoku-special-workspace"),
		);
	});

	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	async function runToggle({
		activeWorkspace,
		clients = [],
		dispatchExitCode = "0",
		dispatchOutput = "",
	}) {
		const proc = Bun.spawn([script, "toggle"], {
			env: {
				...process.env,
				ACTIVE_WORKSPACE: String(activeWorkspace),
				CALL_LOG: log,
				DISPATCH_EXIT_CODE: dispatchExitCode,
				DISPATCH_OUTPUT: dispatchOutput,
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

	it("launches missing Steam when toggling into workspace 2", async () => {
		const result = await runToggle({ activeWorkspace: 3 });

		expect(result).toEqual({ exitCode: 0, stderr: "" });
		expect(calls()).toEqual([
			"activeworkspace -j",
			'dispatch hl.dsp.focus({ workspace = "2" })',
			"clients -j",
			'dispatch hl.dsp.exec_cmd("[workspace 2 silent] uwsm-app -- steam ")',
		]);
	});

	it("ensures Steam when toggling out to the previous workspace", async () => {
		const result = await runToggle({ activeWorkspace: 2 });

		expect(result).toEqual({ exitCode: 0, stderr: "" });
		expect(calls()).toEqual([
			"activeworkspace -j",
			'dispatch hl.dsp.focus({ workspace = "previous" })',
			"clients -j",
			'dispatch hl.dsp.exec_cmd("[workspace 2 silent] uwsm-app -- steam ")',
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
			'dispatch hl.dsp.focus({ workspace = "2" })',
			"clients -j",
		]);
	});

	it("treats exit-zero dispatch diagnostics as failures", async () => {
		const result = await runToggle({
			activeWorkspace: 2,
			dispatchOutput: "invalid dispatcher",
		});

		expect(result).toEqual({
			exitCode: 1,
			stderr: "invalid dispatcher\n",
		});
	});

	it("surfaces non-zero dispatch failures", async () => {
		const result = await runToggle({
			activeWorkspace: 2,
			dispatchExitCode: "23",
			dispatchOutput: "dispatch unavailable",
		});

		expect(result).toEqual({
			exitCode: 1,
			stderr: "dispatch unavailable\n",
		});
	});
});
