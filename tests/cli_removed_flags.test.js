import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const cli = path.join(projectRoot, "haoshoku.js");
const homes = [];
const removedFlags = [
	["--server-paseo"],
	["--agent-skills-backup"],
	["--paseo-profiles"],
	["--paseo-profiles-backup"],
	["--paseo-tasks"],
	["--paseo-schedules"],
	["--paseo-schedules-check"],
	["--paseo-schedules-apply"],
	["--paseo-tasks-enabled", "enabled"],
	["--paseo-task-cleanup", "archive"],
	["--paseo-task-renaming", "enabled"],
];

afterEach(() => {
	for (const home of homes.splice(0)) {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

function run(args) {
	const home = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-removed-flags-"),
	);
	homes.push(home);
	// Instrument the CLI's imported interfaces so restored or newly routed
	// flags cannot reach a real helper, OS probe, service, or child process.
	const imports = [
		...fs
			.readFileSync(cli, "utf8")
			.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.\/src\/[^"]+)"/g),
	].map(([, names, file]) => ({
		file: path.resolve(projectRoot, file),
		names: names
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean),
	}));
	const script = `
		import { mock, spyOn } from "bun:test";
		import childProcess from "node:child_process";
		const called = (name) => () => {
			console.error("SIDE_EFFECT=" + name);
			return { ok: true };
		};
		for (const { file, names } of ${JSON.stringify(imports)}) {
			mock.module(file, () => Object.fromEntries(names.map((name) => [
				name,
				name === "log" ? { dim() {}, error() {}, info() {}, success() {}, warning() {} }
				: name === "getBanner" ? () => ""
				: name === "findActiveModeFlags" ? () => []
				: called(name),
			])));
		}
		mock.module("prompts", () => ({ default: called("prompts") }));
		for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
			spyOn(childProcess, name).mockImplementation(() => {
				called("child_process." + name)();
				throw new Error("Unexpected process call");
			});
		}
		for (const name of ["spawn", "spawnSync"]) {
			spyOn(Bun, name).mockImplementation(() => {
				called("Bun." + name)();
				throw new Error("Unexpected process call");
			});
		}
		process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
		await import(${JSON.stringify(cli)});
	`;
	return Bun.spawnSync([process.execPath, "--eval", script], {
		env: { ...process.env, HOME: home, TMPDIR: home },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
}

describe("removed CLI flags", () => {
	it("records helper calls for a supported mode", () => {
		const child = run(["--agent-skills"]);
		expect(child.exitCode).toBe(0);
		expect(new TextDecoder().decode(child.stderr)).toContain(
			"SIDE_EFFECT=syncAgentSkills",
		);
	});

	it("omits removed flags from help", () => {
		const child = run(["--help"]);
		expect(child.exitCode).toBe(0);
		const help = new TextDecoder().decode(child.stdout);
		for (const [flag] of removedFlags) expect(help).not.toContain(flag);
	});

	const cases = removedFlags.flatMap(([flag, value]) =>
		value
			? [
					[flag, [flag, value]],
					[flag, [`${flag}=${value}`]],
					[flag, [flag]],
				]
			: [[flag, [flag]]],
	);
	it.each(
		cases,
	)("rejects %s with no helper or process calls (%j)", (flag, args) => {
		const child = run(args);
		const output = `${new TextDecoder().decode(child.stdout)}\n${new TextDecoder().decode(child.stderr)}`;
		expect(child.exitCode, output).not.toBe(0);
		expect(output).toContain(`error: unknown option '${args[0]}'`);
		expect(output, flag).not.toContain("SIDE_EFFECT=");
	});
});
