import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
let scratch;
let home;
let project;
let bin;

function write(file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

function snapshot(directory) {
	return Object.fromEntries(
		fs
			.readdirSync(directory, { recursive: true })
			.sort()
			.filter((name) => fs.statSync(path.join(directory, name)).isFile())
			.map((name) => [
				name,
				fs.readFileSync(path.join(directory, name), "utf8"),
			]),
	);
}

beforeEach(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-iobox-cli-"));
	home = path.join(scratch, "home");
	project = path.join(scratch, "project");
	bin = path.join(scratch, "bin");
	fs.mkdirSync(bin);
	fs.cpSync(path.join(root, "src"), path.join(project, "src"), {
		recursive: true,
	});
	fs.cpSync(
		path.join(root, "configs", "omarchy"),
		path.join(project, "configs", "omarchy"),
		{ recursive: true },
	);
	fs.cpSync(
		path.join(root, "configs", "scripts"),
		path.join(project, "configs", "scripts"),
		{ recursive: true },
	);
	fs.copyFileSync(
		path.join(root, "haoshoku.js"),
		path.join(project, "haoshoku.js"),
	);
	fs.symlinkSync(
		path.join(root, "node_modules"),
		path.join(project, "node_modules"),
		"dir",
	);
	fs.symlinkSync(process.execPath, path.join(bin, "bun"));
	fs.symlinkSync("/bin/bash", path.join(bin, "bash"));
	for (const [command, output] of [
		["omarchy", "Omarchy 4.0.0"],
		["hyprmoncfg", "1.12.0"],
		["systemctl", "enabled"],
	]) {
		write(path.join(bin, command), `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
		fs.chmodSync(path.join(bin, command), 0o755);
	}
	write(
		path.join(home, ".haoshoku.json"),
		'{"deviceType":"iobox","preserved":true}\n',
	);
	write(
		path.join(home, ".config", "hypr", "hyprland.lua"),
		'require("hypr.defaults")\n',
	);
	write(
		path.join(home, ".config", "hyprmoncfg", "profiles", "pc.json"),
		'{"live":true}\n',
	);
	write(
		path.join(project, "configs", "hyprmoncfg", "profiles", "pc.json"),
		'{"repo":true}\n',
	);
	write(
		path.join(home, ".config", "pipewire", "pipewire.conf.d", "live.conf"),
		"live audio\n",
	);
	write(
		path.join(
			project,
			"configs",
			"audio",
			"pipewire",
			"pipewire.conf.d",
			"repo.conf",
		),
		"repo audio\n",
	);
});

afterEach(() => fs.rmSync(scratch, { recursive: true }));

function run(flag) {
	return Bun.spawnSync(
		[process.execPath, path.join(project, "haoshoku.js"), flag],
		{
			env: {
				...process.env,
				HOME: home,
				XDG_STATE_HOME: path.join(scratch, "state"),
				BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(scratch, "bun-cache"),
				PATH: bin,
				HYPRLAND_INSTANCE_SIGNATURE: "",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
}

describe("iobox standalone device commands", () => {
	for (const flag of [
		"--workspaces",
		"--monitors",
		"--hyprmoncfg-backup",
		"--audio",
		"--audio-backup",
	]) {
		it(`${flag} refuses iobox without changing home or repo configs`, () => {
			const beforeHome = snapshot(home);
			const beforeRepo = snapshot(path.join(project, "configs"));
			const result = run(flag);
			expect(result.exitCode).not.toBe(0);
			expect(`${result.stdout}${result.stderr}`).toContain(
				"not supported on iobox",
			);
			expect(snapshot(home)).toEqual(beforeHome);
			expect(snapshot(path.join(project, "configs"))).toEqual(beforeRepo);
		});
		it.each(["pc", "laptop"])(`${flag} still runs for %s`, (deviceType) => {
			write(path.join(home, ".haoshoku.json"), JSON.stringify({ deviceType }));
			const before = [snapshot(home), snapshot(path.join(project, "configs"))];
			const result = run(flag);
			expect(result.exitCode, `${result.stdout}${result.stderr}`).toBe(0);
			expect([
				snapshot(home),
				snapshot(path.join(project, "configs")),
			]).not.toEqual(before);
		});
	}
});
