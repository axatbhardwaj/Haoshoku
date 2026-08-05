import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "..", "haoshoku.js");
const PROJECT_ROOT = path.resolve(import.meta.dir, "..");

let tmpHome;
let tmpProjectRoot;

const scriptsDir = () => path.join(tmpProjectRoot, "configs", "scripts");
const localBin = () => path.join(tmpHome, ".local", "bin");

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-scripts-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-scripts-root-"),
	);
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

describe("--scripts CLI mode", () => {
	it("is listed in help with its deployment description", () => {
		const help = Bun.spawnSync([process.execPath, CLI, "--help"], {
			stderr: "pipe",
			stdout: "pipe",
		});
		const helpOutput = new TextDecoder().decode(help.stdout);
		const normalizedHelp = helpOutput.replace(/\s+/g, " ");

		expect(help.exitCode).toBe(0);
		expect(helpOutput).toContain("--scripts");
		expect(normalizedHelp).toContain(
			"Deploy user scripts (configs/scripts/ → ~/.local/bin/) and prune retired entries",
		);
	});

	it("deploys scripts through the real CLI wiring", () => {
		const scriptName = "cli-wiring-script";
		const scriptContents = "#!/usr/bin/env bash\necho cli wiring\n";
		fs.cpSync(path.join(PROJECT_ROOT, "src"), path.join(tmpProjectRoot, "src"), {
			recursive: true,
		});
		fs.copyFileSync(CLI, path.join(tmpProjectRoot, "haoshoku.js"));
		fs.symlinkSync(
			path.join(PROJECT_ROOT, "node_modules"),
			path.join(tmpProjectRoot, "node_modules"),
			"dir",
		);
		fs.mkdirSync(scriptsDir(), { recursive: true });
		fs.writeFileSync(path.join(scriptsDir(), scriptName), scriptContents, {
			mode: 0o755,
		});

		const result = Bun.spawnSync(
			[process.execPath, path.join(tmpProjectRoot, "haoshoku.js"), "--scripts"],
			{
				env: { ...process.env, HOME: tmpHome },
				stderr: "pipe",
				stdout: "pipe",
			},
		);

		const destination = path.join(localBin(), scriptName);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(destination)).toBe(true);
		expect(fs.statSync(destination).mode & 0o777).toBe(0o755);
	});
});
