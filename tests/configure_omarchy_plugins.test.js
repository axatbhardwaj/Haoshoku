import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { configureOmarchyPlugins } from "../src/helpers/configure_omarchy_plugins.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "common", "omarchy-plugins.json");

const MANIFEST = [
	{
		id: "crmne.hyprmoncfg",
		url: "https://github.com/crmne/omarchy-hyprmoncfg.git",
		manualAuth:
			"Needs the hyprmoncfg AUR package and daemon (installed separately; not handled by this installer)",
	},
	{
		id: "crmne.mpris",
		url: "https://github.com/crmne/omarchy-mpris.git",
		manualAuth: null,
	},
	{
		id: "dorneles.lock-keys",
		url: "https://github.com/jvlianodorneles/lock-keys.git",
		manualAuth: null,
	},
	{
		id: "white.nights",
		url: "https://github.com/nightdevil00/white.nights.git",
		manualAuth: null,
	},
	{
		id: "robzolkos.github",
		url: "https://github.com/robzolkos/omarchy-github.git",
		manualAuth: "GitHub token",
	},
	{
		id: "io.github.treramey.raindrop-bookmarks",
		url: "https://github.com/treramey/omarchy-raindrop-bookmarks.git",
		manualAuth: "Raindrop API token",
	},
	{
		id: "hass",
		url: "https://github.com/konradk/hass.git",
		manualAuth: "Home Assistant URL + long-lived token",
	},
	{
		id: "omaconnect",
		url: "https://github.com/jitendradara12/omaconnect.git",
		manualAuth: "KDE Connect pairing",
	},
];

const MISSING_WHEN_FIRST_5_PRESENT = [
	"io.github.treramey.raindrop-bookmarks",
	"hass",
	"omaconnect",
];

const MANUAL_AUTH_IDS = [
	"crmne.hyprmoncfg",
	"robzolkos.github",
	"io.github.treramey.raindrop-bookmarks",
	"hass",
	"omaconnect",
];

function installedJson(enabledIds, { disabled = [] } = {}) {
	return JSON.stringify(
		[...enabledIds, ...disabled].map((id) => ({
			id,
			enabled: !disabled.includes(id),
			firstParty: false,
			kinds: ["bar"],
		})),
	);
}

function makeRunner({ installedJsonBody, failAddFor = [] } = {}) {
	const calls = [];
	const runner = async (argv) => {
		calls.push(argv);
		if (argv.join(" ") === "omarchy version") {
			return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
		}
		if (argv.join(" ") === "omarchy plugin list --json") {
			return { exitCode: 0, stdout: installedJsonBody, stderr: "" };
		}
		if (argv[1] === "plugin" && argv[2] === "add") {
			const entry = MANIFEST.find((plugin) => plugin.url === argv[3]);
			if (entry && failAddFor.includes(entry.id)) {
				return { exitCode: 1, stdout: "", stderr: "clone failed" };
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		}
		return { exitCode: 0, stdout: "", stderr: "" };
	};
	return { calls, runner };
}

function makeLog() {
	const lines = { info: [], success: [], warning: [] };
	return {
		lines,
		logImpl: {
			info: (message) => lines.info.push(message),
			success: (message) => lines.success.push(message),
			warning: (message) => lines.warning.push(message),
			error: (message) => lines.warning.push(message),
			dim: (message) => lines.info.push(message),
		},
	};
}

function commandType(calls, subcommand) {
	return calls.filter(
		(argv) => argv[0] === "omarchy" && argv[2] === subcommand,
	);
}

describe("Omarchy plugin installer", () => {
	it("probes the system Omarchy path while preserving the injected environment", async () => {
		const calls = [];
		const { logImpl } = makeLog();
		const result = await configureOmarchyPlugins({
			manifest: [],
			env: { SENTINEL: "kept", OMARCHY_PATH: "/live/shim" },
			runCommandImpl: async (argv, options = {}) => {
				calls.push([argv, options]);
				if (argv.join(" ") === "omarchy version") {
					return {
						exitCode: 0,
						stdout:
							options.env?.OMARCHY_PATH === "/usr/share/omarchy"
								? "Omarchy 4.0.0\n"
								: "Omarchy 3.8.5\n",
					};
				}
				return { exitCode: 0, stdout: "[]" };
			},
			logImpl,
		});

		expect(result.status).not.toBe("refused");
		expect(calls[0]).toEqual([
			["omarchy", "version"],
			{ env: { SENTINEL: "kept", OMARCHY_PATH: "/usr/share/omarchy" } },
		]);
	});

	it("refuses Omarchy 3 before reading or mutating plugin state", async () => {
		const calls = [];
		const { lines, logImpl } = makeLog();
		const result = await configureOmarchyPlugins({
			manifest: MANIFEST,
			runCommandImpl: async (argv) => {
				calls.push(argv);
				return { exitCode: 0, stdout: "Omarchy 3.8.5\n", stderr: "" };
			},
			logImpl,
		});

		expect(result).toEqual(
			expect.objectContaining({
				status: "refused",
				installed: [],
				enabled: [],
				failed: [],
			}),
		);
		expect(calls).toEqual([["omarchy", "version"]]);
		expect(lines.warning.join("\n")).toContain("Omarchy 4 or newer");
	});
	it("installs only the 3 missing plugins when 5 of 8 are already enabled", async () => {
		const enabledIds = MANIFEST.slice(0, 5).map((plugin) => plugin.id);
		const { calls, runner } = makeRunner({
			installedJsonBody: installedJson(enabledIds),
		});
		const { logImpl } = makeLog();

		const result = await configureOmarchyPlugins({
			manifest: MANIFEST,
			runCommandImpl: runner,
			logImpl,
		});

		const addCalls = commandType(calls, "add");
		expect(addCalls).toHaveLength(3);
		for (const id of MISSING_WHEN_FIRST_5_PRESENT) {
			const url = MANIFEST.find((plugin) => plugin.id === id).url;
			expect(addCalls).toContainEqual([
				"omarchy",
				"plugin",
				"add",
				url,
				"--enable",
				"--yes",
			]);
		}
		expect(commandType(calls, "enable")).toHaveLength(0);
		expect(result.installed.sort()).toEqual(
			[...MISSING_WHEN_FIRST_5_PRESENT].sort(),
		);
		expect(result.enabled).toEqual([]);
		expect(result.failed).toEqual([]);
		expect(result.alreadyReady.sort()).toEqual([...enabledIds].sort());
	});

	it("enables a present-but-disabled plugin instead of reinstalling it", async () => {
		const allIds = MANIFEST.map((plugin) => plugin.id);
		const { calls, runner } = makeRunner({
			installedJsonBody: installedJson(allIds, {
				disabled: ["robzolkos.github"],
			}),
		});
		const { logImpl } = makeLog();

		const result = await configureOmarchyPlugins({
			manifest: MANIFEST,
			runCommandImpl: runner,
			logImpl,
		});

		expect(commandType(calls, "add")).toHaveLength(0);
		expect(calls).toContainEqual([
			"omarchy",
			"plugin",
			"enable",
			"robzolkos.github",
		]);
		expect(result.installed).toEqual([]);
		expect(result.enabled).toEqual(["robzolkos.github"]);
		expect(result.alreadyReady).toHaveLength(7);
		expect(result.failed).toEqual([]);
	});

	it("records a failed install as non-fatal and keeps processing the rest", async () => {
		const enabledIds = MANIFEST.slice(0, 5).map((plugin) => plugin.id);
		const { calls, runner } = makeRunner({
			installedJsonBody: installedJson(enabledIds),
			failAddFor: ["hass"],
		});
		const { lines, logImpl } = makeLog();

		const result = await configureOmarchyPlugins({
			manifest: MANIFEST,
			runCommandImpl: runner,
			logImpl,
		});

		expect(commandType(calls, "add")).toHaveLength(3);
		expect(result.failed).toEqual(["hass"]);
		expect(result.installed.sort()).toEqual(
			["io.github.treramey.raindrop-bookmarks", "omaconnect"].sort(),
		);
		expect(result.alreadyReady).toHaveLength(5);
		expect(lines.warning.join("\n")).toContain("hass");
	});

	it("lists exactly the manual-auth plugins regardless of install state", async () => {
		const enabledIds = MANIFEST.slice(0, 5).map((plugin) => plugin.id);
		const { runner } = makeRunner({
			installedJsonBody: installedJson(enabledIds),
		});
		const { lines, logImpl } = makeLog();

		const result = await configureOmarchyPlugins({
			manifest: MANIFEST,
			runCommandImpl: runner,
			logImpl,
		});

		expect(result.manualAuthChecklist.map((item) => item.id)).toEqual(
			MANUAL_AUTH_IDS,
		);
		const logged = lines.info.join("\n");
		for (const id of MANUAL_AUTH_IDS) {
			expect(logged).toContain(id);
		}
		for (const plugin of MANIFEST.filter((p) => !p.manualAuth)) {
			expect(result.manualAuthChecklist.map((i) => i.id)).not.toContain(
				plugin.id,
			);
		}
	});

	it("treats a failing plugin list as empty and still attempts installs", async () => {
		const calls = [];
		const runner = async (argv) => {
			calls.push(argv);
			if (argv.join(" ") === "omarchy version") {
				return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
			}
			if (argv.join(" ") === "omarchy plugin list --json") {
				return { exitCode: 1, stdout: "", stderr: "no omarchy" };
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		};
		const { lines, logImpl } = makeLog();

		const result = await configureOmarchyPlugins({
			manifest: MANIFEST,
			runCommandImpl: runner,
			logImpl,
		});

		expect(commandType(calls, "add")).toHaveLength(8);
		expect(result.installed).toHaveLength(8);
		expect(result.failed).toEqual([]);
		expect(lines.warning.join("\n")).toContain("plugin list");
	});

	it.each([
		"null",
		"{}",
	])("treats a non-array plugin list (%s) as empty and still attempts installs", async (stdoutBody) => {
		const calls = [];
			const runner = async (argv) => {
				calls.push(argv);
				if (argv.join(" ") === "omarchy version") {
					return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
				}
				if (argv.join(" ") === "omarchy plugin list --json") {
				return { exitCode: 0, stdout: stdoutBody, stderr: "" };
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		};
		const { lines, logImpl } = makeLog();

		const result = await configureOmarchyPlugins({
			manifest: MANIFEST,
			runCommandImpl: runner,
			logImpl,
		});

		expect(commandType(calls, "add")).toHaveLength(8);
		expect(result.installed).toHaveLength(8);
		expect(result.failed).toEqual([]);
		expect(lines.warning.join("\n")).toContain(
			"treating all manifest plugins as missing",
		);
	});

	it("treats malformed plugin list JSON as empty and still attempts installs", async () => {
		const calls = [];
		const runner = async (argv) => {
			calls.push(argv);
			if (argv.join(" ") === "omarchy version") {
				return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
			}
			if (argv.join(" ") === "omarchy plugin list --json") {
				return { exitCode: 0, stdout: "not json", stderr: "" };
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		};
		const { lines, logImpl } = makeLog();

		const result = await configureOmarchyPlugins({
			manifest: MANIFEST,
			runCommandImpl: runner,
			logImpl,
		});

		expect(commandType(calls, "add")).toHaveLength(8);
		expect(result.installed).toHaveLength(8);
		expect(result.failed).toEqual([]);
		expect(lines.warning.join("\n")).toContain(
			"treating all manifest plugins as missing",
		);
	});

	it("ships a manifest on disk with exactly the 8 expected plugins", () => {
		const EXPECTED_PLUGINS = [
			{
				id: "crmne.hyprmoncfg",
				url: "https://github.com/crmne/omarchy-hyprmoncfg.git",
			},
			{ id: "crmne.mpris", url: "https://github.com/crmne/omarchy-mpris.git" },
			{
				id: "dorneles.lock-keys",
				url: "https://github.com/jvlianodorneles/lock-keys.git",
			},
			{
				id: "white.nights",
				url: "https://github.com/nightdevil00/white.nights.git",
			},
			{
				id: "robzolkos.github",
				url: "https://github.com/robzolkos/omarchy-github.git",
			},
			{
				id: "io.github.treramey.raindrop-bookmarks",
				url: "https://github.com/treramey/omarchy-raindrop-bookmarks.git",
			},
			{ id: "hass", url: "https://github.com/konradk/hass.git" },
			{
				id: "omaconnect",
				url: "https://github.com/jitendradara12/omaconnect.git",
			},
		];

		const onDisk = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
		expect(onDisk.length).toBe(8);
		expect(
			onDisk.map((plugin) => ({ id: plugin.id, url: plugin.url })),
		).toEqual(EXPECTED_PLUGINS);

		const urlPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/;
		for (const plugin of onDisk) {
			expect(plugin.url).toMatch(urlPattern);
		}

		const ids = onDisk.map((plugin) => plugin.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
