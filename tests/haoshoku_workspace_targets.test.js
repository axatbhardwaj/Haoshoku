import { afterEach, beforeEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scripts = path.resolve(import.meta.dir, "../configs/scripts");
let home;
beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-targets-"));
	for (const directory of ["bin", ".config/haoshoku", ".local/state/omarchy"])
		fs.mkdirSync(path.join(home, directory), { recursive: true });
	fs.copyFileSync(
		path.resolve(import.meta.dir, "../configs/omarchy/workspace-monitors-io"),
		`${home}/.config/haoshoku/workspace-monitors`,
	);
	fs.writeFileSync(
		`${home}/.local/state/omarchy/monitor-workspaces`,
		"3\tDP-1\tcenter\n4\tDP-2\tleft\n2\tHDMI-A-1\tright\n",
	);
	fs.writeFileSync(
		`${home}/monitors`,
		JSON.stringify([
			{ name: "DP-2", description: "left" },
			{ name: "HDMI-A-1", description: "right" },
			{ name: "DP-1", description: "center" },
		]),
	);
	fs.writeFileSync(`${home}/clients`, "[]");
	fs.writeFileSync(`${home}/bin/t3code`, "#!/bin/sh\nexit 0\n", {
		mode: 0o755,
	});
	fs.writeFileSync(
		`${home}/bin/hyprctl`,
		`#!/bin/bash
case "$1 $2" in
  "monitors -j") cat "$HOME/monitors" ;;
  "clients -j") cat "$HOME/clients" ;;
  "activeworkspace -j") echo '{"id":32}' ;;
  dispatch) ;;
  *) printf '%s\\n' "$2" >> "$HOME/dispatches" ;;
esac
`,
		{ mode: 0o755 },
	);
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

function run(script, ...args) {
	const result = Bun.spawnSync([path.join(scripts, script), ...args], {
		env: {
			...process.env,
			HOME: home,
			XDG_CONFIG_HOME: `${home}/.config`,
			XDG_STATE_HOME: `${home}/.local/state`,
			PATH: `${home}/bin:${scripts}:${process.env.PATH}`,
			HAOSHOKU_GW_SPLIT_LOCK_FILE: `${home}/absent`,
		},
	});
	return {
		code: result.exitCode,
		stderr: result.stderr.toString(),
		calls: fs.existsSync(`${home}/dispatches`)
			? fs.readFileSync(`${home}/dispatches`, "utf8")
			: "",
	};
}

it("launches primary and numbered apps using physical roles in reordered native blocks", () => {
	let result = run("haoshoku-primary-app", "login");
	expect(result.stderr).toBe("");
	expect(result.code).toBe(0);
	expect(result.calls).toContain("[workspace 31 silent] uwsm-app -- t3code");
	result = run(
		"haoshoku-special-workspace",
		"numbered",
		"5",
		"communication-numbered",
	);
	expect(result.stderr).toBe("");
	expect(result.code).toBe(0);
	expect(result.calls).toContain('hl.dsp.focus({ workspace = "25" })');
	expect(result.calls).toContain(
		"[workspace 25 silent] uwsm-app -- teams-for-linux",
	);
	expect(result.calls).toContain("[workspace 25 silent] uwsm-app -- Telegram");
	result = run("haoshoku-special-workspace", "numbered-login", "7", "ghostty");
	expect(result.stderr).toBe("");
	expect(result.code).toBe(0);
	expect(result.calls).toContain("[workspace 42 silent]");
	expect(result.calls).toContain("--class=com.haoshoku.ws7");
});

it("does not dispatch or launch on a missing, disconnected or stale role target", () => {
	fs.writeFileSync(
		`${home}/monitors`,
		'[{"name":"HDMI-A-1","description":"right"}]',
	);
	fs.writeFileSync(
		`${home}/clients`,
		'[{"class":"com.t3tools.T3Code","address":"0x1","workspace":{"name":"1"}}]',
	);
	let result = run("haoshoku-primary-app", "focus", "6");
	expect(result.code).not.toBe(0);
	expect(result.calls).toBe("");
	fs.rmSync(`${home}/.local/state/omarchy/monitor-workspaces`);
	result = run(
		"haoshoku-special-workspace",
		"numbered",
		"5",
		"communication-numbered",
	);
	expect(result.code).not.toBe(0);
	expect(result.calls).toBe("");
});

it("returns gaming toggle to the same physical monitor's slot 1", () => {
	const result = run("haoshoku-gaming-workspace", "toggle");
	expect(result.stderr).toBe("");
	expect(result.code).toBe(0);
	expect(result.calls).toContain('hl.dsp.focus({ workspace = "31" })');
	expect(result.calls).not.toContain('workspace = "previous"');
	expect(result.calls).toContain("[workspace 32 silent] uwsm-app -- omakade");
});

it("uses the single-monitor ten-slot route on a laptop and rejects ambiguous desktops", () => {
	fs.copyFileSync(
		path.resolve(
			import.meta.dir,
			"../configs/omarchy/workspace-monitors-laptop",
		),
		`${home}/.config/haoshoku/workspace-monitors`,
	);
	fs.writeFileSync(
		`${home}/monitors`,
		'[{"name":"eDP-1","description":"panel"},{"name":"DP-1","description":"desk"}]',
	);
	fs.writeFileSync(
		`${home}/.local/state/omarchy/monitor-workspaces`,
		"0\teDP-1\tpanel\n3\tDP-1\tdesk\n",
	);
	let result = run(
		"haoshoku-special-workspace",
		"numbered-login",
		"10",
		"notion",
	);
	expect(result.code).toBe(0);
	expect(result.calls).toContain("[workspace 10 silent]");
	fs.rmSync(`${home}/dispatches`);
	fs.writeFileSync(`${home}/monitors`, '[{"name":"DP-1"},{"name":"DP-2"}]');
	result = run("haoshoku-primary-app", "login");
	expect(result.code).not.toBe(0);
	expect(result.calls).toBe("");
});

it("rejects stale identities, ambiguous native blocks and non-slot input without dispatch", () => {
	for (const state of [
		"3\tDP-1\treplaced-monitor\n",
		"3\tDP-1\tcenter\n3\tDP-2\tleft\n",
	]) {
		fs.writeFileSync(`${home}/.local/state/omarchy/monitor-workspaces`, state);
		const result = run("haoshoku-primary-app", "login");
		expect(result.code).not.toBe(0);
		expect(result.calls).toBe("");
	}
	const result = run(
		"haoshoku-special-workspace",
		"numbered",
		'7"\\edge',
		"ghostty",
	);
	expect(result.code).not.toBe(0);
	expect(result.calls).toBe("");
});
