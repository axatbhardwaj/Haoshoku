import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { log } from "../src/common/utils.js";
import * as hyprmoncfg from "../src/helpers/configure_hyprmoncfg.js";

const WORKSPACE_ROOT = path.resolve(import.meta.dir, "..");
const PROFILE_PATH = path.join(
	WORKSPACE_ROOT,
	"configs",
	"hyprmoncfg",
	"profiles",
	"pc.json",
);

const CAPTURE_PATH = path.join(
	import.meta.dir,
	"fixtures",
	"hyprctl-monitors-pc.json",
);
const CAPTURED_OUTPUTS = JSON.parse(
	fs.readFileSync(CAPTURE_PATH, "utf8"),
).map((output) => ({
	key: `${output.make.toLowerCase()}|${output.model.toLowerCase()}|${output.serial.toLowerCase()}`,
	name: output.name,
	make: output.make,
	model: output.model,
	serial: output.serial,
	width: output.width,
	height: output.height,
	refresh: output.refreshRate,
	x: output.x,
	y: output.y,
	transform: output.transform,
}));

const EXPECTED_WORKSPACES = [
	["1", "DP-1", true, true],
	["2", "DP-1", false, true],
	["3", "DP-1", false, true],
	["4", "HDMI-A-1", false, true],
	["5", "HDMI-A-1", true, true],
	["6", "DP-2", false, true],
	["7", "DP-2", false, true],
	["8", "DP-1", false, true],
	["9", "HDMI-A-1", false, true],
	["10", "DP-2", false, true],
];

let tmpHome;
let tmpProjectRoot;
let warnings;
let warningOriginal;

const repoProfilesDir = () =>
	path.join(tmpProjectRoot, "configs", "hyprmoncfg", "profiles");
const liveProfilesDir = () =>
	path.join(tmpHome, ".config", "hyprmoncfg", "profiles");
const monitorsLuaPath = () =>
	path.join(tmpHome, ".config", "hypr", "monitors.lua");

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-hmcfg-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-hmcfg-root-"),
	);
	fs.mkdirSync(repoProfilesDir(), { recursive: true });
	warnings = [];
	warningOriginal = log.warning;
	log.warning = (message) => warnings.push(message);
});

afterEach(() => {
	log.warning = warningOriginal;
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

function seedRepoProfile(contents = '{"name":"pc","source":"repo"}\n') {
	fs.writeFileSync(path.join(repoProfilesDir(), "pc.json"), contents);
}


function successfulDependencies(calls = []) {
	return {
		captureCommandImpl: async () => ({
			exitCode: 0,
			stdout: "Omarchy 4.0.0\n",
		}),
		commandExistsImpl: async (command) =>
			command === "hyprmoncfg" || command === "paru",
		runCommandImpl: async (args) => {
			calls.push(args);
			if (args[0] === "hyprmoncfg") {
				return { exitCode: 0, stdout: "hyprmoncfg v1.12.0\n" };
			}
			return { exitCode: 0, stdout: "" };
		},
	};
}

function readProfile() {
	return JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
}

describe("configure_hyprmoncfg module shape", () => {
	it("exports deploy, backup, and configure entry points", () => {
		expect(typeof hyprmoncfg.syncHyprmoncfg).toBe("function");
		expect(typeof hyprmoncfg.backupHyprmoncfg).toBe("function");
		expect(typeof hyprmoncfg.configureHyprmoncfg).toBe("function");
	});
});

describe("pc hyprmoncfg profile", () => {
	it("is valid JSON with the three exact captured output identities and layouts", () => {
		const profile = readProfile();

		expect(profile.name).toBe("pc");
		expect(profile.outputs).toHaveLength(3);
		expect(profile.outputs.map((output) => ({
			key: output.key,
			name: output.name,
			make: output.make,
			model: output.model,
			serial: output.serial,
			width: output.width,
			height: output.height,
			refresh: output.refresh,
			x: output.x,
			y: output.y,
			transform: output.transform,
		}))).toEqual(CAPTURED_OUTPUTS);
		for (const output of profile.outputs) {
			expect(output.enabled).toBe(true);
			expect(output.scale).toBe(1);
		}
	});

	it("carries workspaces 1-10 with stable monitor targets", () => {
		const profile = readProfile();
		const keyByName = new Map(
			profile.outputs.map((output) => [output.name, output.key]),
		);

		expect(profile.workspaces.enabled).toBe(true);
		expect(profile.workspaces.strategy).toBe("manual");
		expect(profile.workspaces.rules).toHaveLength(10);
		expect(profile.workspaces.rules.map((rule) => [
			rule.workspace,
			rule.output_name,
			Boolean(rule.default),
			Boolean(rule.persistent),
		])).toEqual(EXPECTED_WORKSPACES);

		for (const rule of profile.workspaces.rules) {
			expect(rule.output_key).toBe(keyByName.get(rule.output_name));
		}
	});

	it("every workspace rule targets a monitor by key or name", () => {
		const rules = readProfile().workspaces.rules;
		const normalized = rules.filter(
			(rule) => !(rule.output_key === "" && rule.output_name === ""),
		);

		expect(normalized).toHaveLength(10);
		expect(normalized).toEqual(rules);
		for (const rule of rules) {
			expect(Boolean(rule.output_key || rule.output_name)).toBe(true);
		}
	});
});

describe("syncHyprmoncfg — repo to live", () => {
	it("refuses Omarchy 3 before deploying profiles or probing packages", async () => {
		seedRepoProfile();
		const calls = [];
		const result = await hyprmoncfg.syncHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
			captureCommandImpl: async () => ({
				exitCode: 0,
				stdout: "Omarchy 3.8.5\n",
			}),
			commandExistsImpl: async (command) => calls.push(command),
			runCommandImpl: async (args) => calls.push(args),
		});

		expect(result).toEqual(
			expect.objectContaining({
				status: "refused",
				deployed: 0,
				packageReady: false,
				serviceEnabled: false,
			}),
		);
		expect(calls).toEqual([]);
		expect(fs.existsSync(liveProfilesDir())).toBe(false);
	});
	it("deploys only repository JSON profiles", async () => {
		seedRepoProfile();
		fs.writeFileSync(path.join(repoProfilesDir(), "pc.conf"), "sidecar");

		await hyprmoncfg.syncHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
			enable: false,
			...successfulDependencies(),
		});

		expect(
			fs.readFileSync(path.join(liveProfilesDir(), "pc.json"), "utf8"),
		).toBe('{"name":"pc","source":"repo"}\n');
		expect(fs.existsSync(path.join(liveProfilesDir(), "pc.conf"))).toBe(false);
	});

	it("atomically replaces a changed live profile and preserves its previous bytes", async () => {
		seedRepoProfile("new profile\n");
		fs.mkdirSync(liveProfilesDir(), { recursive: true });
		const destination = path.join(liveProfilesDir(), "pc.json");
		fs.writeFileSync(destination, "old profile\n");
		const renames = [];
		const fsImpl = new Proxy(fs, {
			get(target, property) {
				if (property === "renameSync") {
					return (source, targetPath) => {
						renames.push([source, targetPath]);
						return target.renameSync(source, targetPath);
					};
				}
				return Reflect.get(target, property);
			},
		});

		await hyprmoncfg.syncHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
			fsImpl,
			now: () => 1234,
			enable: false,
			...successfulDependencies(),
		});

		expect(fs.readFileSync(destination, "utf8")).toBe("new profile\n");
		expect(fs.readFileSync(`${destination}.bak.1234`, "utf8")).toBe(
			"old profile\n",
		);
		expect(renames.some(([, targetPath]) => targetPath === destination)).toBe(
			true,
		);
	});

	it("installs an old hyprmoncfg with paru and enables hyprmoncfgd", async () => {
		seedRepoProfile();
		const calls = [];
		let versionProbes = 0;
		const runCommandImpl = async (args) => {
			calls.push(args);
			if (args[0] === "hyprmoncfg") {
				versionProbes += 1;
				return {
					exitCode: 0,
					stdout:
						versionProbes === 1
							? "hyprmoncfg v1.11.9\n"
							: "hyprmoncfg v1.12.0\n",
				};
			}
			return { exitCode: 0, stdout: "" };
		};

		await hyprmoncfg.syncHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
			captureCommandImpl: async () => ({
				exitCode: 0,
				stdout: "Omarchy 4.0.0\n",
			}),
			commandExistsImpl: async (command) =>
				command === "hyprmoncfg" || command === "paru",
			runCommandImpl,
		});

		expect(calls).toContainEqual(["hyprmoncfg", "--version"]);
		expect(calls).toContainEqual([
			"paru",
			"-S",
			"--needed",
			"--noconfirm",
			"hyprmoncfg",
		]);
		expect(calls).toContainEqual(["systemctl", "--user", "--version"]);
		expect(calls).toContainEqual([
			"systemctl",
			"--user",
			"daemon-reload",
		]);
		expect(calls).toContainEqual([
			"systemctl",
			"--user",
			"enable",
			"--now",
			"hyprmoncfgd.service",
		]);
	});

	it("warns without throwing when no AUR helper or user systemctl is available", async () => {
		seedRepoProfile();
		const calls = [];
		const runCommandImpl = async (args) => {
			calls.push(args);
			return { exitCode: 127, stdout: "" };
		};

		await expect(
			hyprmoncfg.syncHyprmoncfg({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
				captureCommandImpl: async () => ({
					exitCode: 0,
					stdout: "Omarchy 4.0.0\n",
				}),
				commandExistsImpl: async () => false,
				runCommandImpl,
			}),
		).resolves.toBeDefined();

		expect(calls).toEqual([["systemctl", "--user", "--version"]]);
		expect(
			warnings.some((message) => message.includes("AUR helper")),
		).toBe(true);
		expect(
			warnings.some((message) =>
				message.includes("systemctl --user unavailable"),
			),
		).toBe(true);
	});

	it("leaves an unmarked monitors.lua byte-for-byte untouched and warns with its path", async () => {
		const profile = {
			name: "pc",
			workspaces: {
				rules: [{ workspace: "1" }, { workspace: "2" }],
			},
		};
		seedRepoProfile(`${JSON.stringify(profile)}\n`);
		fs.mkdirSync(path.dirname(monitorsLuaPath()), { recursive: true });
		const original = "-- user-owned\nreturn {}\n";
		fs.writeFileSync(monitorsLuaPath(), original);

		await hyprmoncfg.syncHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
			enable: false,
			...successfulDependencies(),
		});

		expect(fs.readFileSync(monitorsLuaPath(), "utf8")).toBe(original);
		const warning = warnings.find((message) =>
			message.includes(monitorsLuaPath()),
		);
		expect(warning).toContain("monitor layout");
		expect(warning).toContain(
			`${profile.workspaces.rules.length} PC workspace-monitor rules`,
		);
		expect(warning).toMatch(/back up.*remove/i);
		expect(warning).toMatch(/re-run Haoshoku|hyprmoncfg apply/i);
	});

	it("warns when the Lua marker has an unsupported version suffix", async () => {
		seedRepoProfile();
		fs.mkdirSync(path.dirname(monitorsLuaPath()), { recursive: true });
		fs.writeFileSync(
			monitorsLuaPath(),
			"-- Generated by hyprmoncfg v1.13\nreturn {}\n",
		);

		await hyprmoncfg.syncHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
			enable: false,
			...successfulDependencies(),
		});

		expect(
			warnings.some((message) => message.includes(monitorsLuaPath())),
		).toBe(true);
	});

	it("accepts the exact Lua marker after a UTF-8 BOM", async () => {
		seedRepoProfile();
		fs.mkdirSync(path.dirname(monitorsLuaPath()), { recursive: true });
		fs.writeFileSync(
			monitorsLuaPath(),
			"\uFEFF-- Generated by hyprmoncfg\r\nreturn {}\n",
		);

		await hyprmoncfg.syncHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
			enable: false,
			...successfulDependencies(),
		});

		expect(
			warnings.some((message) => message.includes(monitorsLuaPath())),
		).toBe(false);
	});
});

describe("backupHyprmoncfg — live to repo", () => {
	it("backs up JSON profiles and excludes generated conf/lua sidecars", async () => {
		fs.mkdirSync(liveProfilesDir(), { recursive: true });
		fs.writeFileSync(path.join(liveProfilesDir(), "pc.json"), "live json\n");
		fs.writeFileSync(path.join(liveProfilesDir(), "pc.conf"), "generated conf\n");
		fs.writeFileSync(path.join(liveProfilesDir(), "pc.lua"), "generated lua\n");

		await hyprmoncfg.backupHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(fs.readFileSync(path.join(repoProfilesDir(), "pc.json"), "utf8")).toBe(
			"live json\n",
		);
		expect(fs.existsSync(path.join(repoProfilesDir(), "pc.conf"))).toBe(false);
		expect(fs.existsSync(path.join(repoProfilesDir(), "pc.lua"))).toBe(false);
	});

	it("never writes monitors.lua from deploy or backup", async () => {
		seedRepoProfile("repo json\n");
		fs.mkdirSync(liveProfilesDir(), { recursive: true });
		fs.writeFileSync(path.join(liveProfilesDir(), "pc.json"), "live json\n");
		const writtenPaths = [];
		const fsImpl = new Proxy(fs, {
			get(target, property) {
				if (property === "writeFileSync") {
					return (targetPath, ...args) => {
						writtenPaths.push(String(targetPath));
						return target.writeFileSync(targetPath, ...args);
					};
				}
				if (property === "copyFileSync") {
					return (source, destination, ...args) => {
						writtenPaths.push(String(destination));
						return target.copyFileSync(source, destination, ...args);
					};
				}
				if (property === "renameSync") {
					return (source, destination) => {
						writtenPaths.push(String(destination));
						return target.renameSync(source, destination);
					};
				}
				if (property === "mkdirSync") {
					return (targetPath, ...args) => {
						writtenPaths.push(String(targetPath));
						return target.mkdirSync(targetPath, ...args);
					};
				}
				return Reflect.get(target, property);
			},
		});

		await hyprmoncfg.syncHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
			fsImpl,
			now: () => 2000,
			enable: false,
			...successfulDependencies(),
		});
		fs.writeFileSync(path.join(liveProfilesDir(), "pc.json"), "new live json\n");
		await hyprmoncfg.backupHyprmoncfg({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
			fsImpl,
			now: () => 3000,
		});

		expect(writtenPaths.length).toBeGreaterThan(0);
		expect(writtenPaths.filter((targetPath) => targetPath.endsWith("monitors.lua"))).toEqual([]);
	});
});
