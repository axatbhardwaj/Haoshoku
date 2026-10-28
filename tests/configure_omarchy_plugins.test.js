import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { configureOmarchyPlugins } from "../src/helpers/configure_omarchy_plugins.js";
import {
	MANIFEST,
	DECENT_WORKSPACES,
	MISSING_WHEN_FIRST_8_PRESENT,
	MANUAL_AUTH_IDS,
	installedJson,
	makeRunner,
	makeLog,
	commandType,
} from "./configure_omarchy_plugins/fixtures.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "common", "omarchy-plugins.json");

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
				return { exitCode: 0, stdout: installedJson([]) };
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
	it("installs only the missing plugins when the first 8 are already enabled", async () => {
		const enabledIds = MANIFEST.slice(0, 8).map((plugin) => plugin.id);
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
		expect(addCalls).toHaveLength(1);
		for (const id of MISSING_WHEN_FIRST_8_PRESENT) {
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
			[...MISSING_WHEN_FIRST_8_PRESENT].sort(),
		);
		expect(result.enabled).toEqual([]);
		expect(result.failed).toEqual([]);
		expect(result.alreadyReady.sort()).toEqual([...enabledIds].sort());
	});

	it("enables a present-but-disabled plugin instead of reinstalling it", async () => {
		const allIds = MANIFEST.map((plugin) => plugin.id);
		const { calls, runner } = makeRunner({
			installedJsonBody: installedJson(allIds, {
				disabled: ["io.github.ciryon.pullbar"],
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
			"io.github.ciryon.pullbar",
		]);
		expect(result.installed).toEqual([]);
		expect(result.enabled).toEqual(["io.github.ciryon.pullbar"]);
		expect(result.alreadyReady).toHaveLength(8);
		expect(result.failed).toEqual([]);
	});

	it("records a failed install as non-fatal and keeps processing the rest", async () => {
		const enabledIds = [
			...MANIFEST.slice(0, 4).map((plugin) => plugin.id),
			"omarchy.workspaces",
		];
		const { calls, runner } = makeRunner({
			installedJsonBody: installedJson(enabledIds),
			failAddFor: ["dizziee.system-stats"],
		});
		const { lines, logImpl } = makeLog();

		const result = await configureOmarchyPlugins({
			manifest: MANIFEST,
			runCommandImpl: runner,
			logImpl,
		});

		expect(commandType(calls, "add")).toHaveLength(5);
		expect(commandType(calls, "remove")).toEqual([]);
		expect(result.failed).toEqual(["dizziee.system-stats"]);
		expect(result.configureFailed).toEqual([]);
		expect(result.installed).toEqual([
			"omaconnect",
			"io.github.thetrueferret.decent-workspaces",
			"aislandener.galaxy-buds",
			"io.github.nag3sy.feishin",
		]);
		expect(result.alreadyReady).toHaveLength(4);
		expect(lines.warning.join("\n")).toContain("dizziee.system-stats");
	});

	it("lists exactly the manual-auth plugins regardless of install state", async () => {
		const enabledIds = MANIFEST.slice(0, 7).map((plugin) => plugin.id);
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

	it("skips all plugin work while returning the manual-auth checklist", async () => {
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

		expect(calls).toEqual([
			["omarchy", "version"],
			["omarchy", "plugin", "list", "--json"],
		]);
		expect(result).toEqual({
			snapshotUnavailable: true,
			installed: [],
			enabled: [],
			alreadyReady: [],
			failed: [],
			configured: [],
			configureFailed: [],
			manualAuthChecklist: [
				{
					id: "crmne.hyprmoncfg",
					requirement:
						"Needs the hyprmoncfg AUR package and daemon (installed separately; not handled by this installer)",
				},
				{
					id: "io.github.ciryon.pullbar",
					requirement: "GitHub CLI auth (`gh auth login`)",
				},
				{
					id: "io.github.treramey.raindrop-bookmarks",
					requirement: "Raindrop API token",
				},
				{ id: "omaconnect", requirement: "KDE Connect pairing" },
				{
					id: "aislandener.galaxy-buds",
					requirement: "Galaxy Buds Bluetooth pairing",
				},
			],
		});
		expect(lines.warning.join("\n")).toContain("exit code 1");
		for (const id of MANUAL_AUTH_IDS) {
			expect(lines.info.join("\n")).toContain(id);
		}
	});

	it("treats a successful list with no first-party plugin as untrustworthy", async () => {
		const calls = [];
		const { lines, logImpl } = makeLog();
		const result = await configureOmarchyPlugins({
			manifest: [DECENT_WORKSPACES],
			runCommandImpl: async (argv) => {
				calls.push(argv);
				if (argv.join(" ") === "omarchy version") {
					return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
				}
				if (argv.join(" ") === "omarchy plugin list --json") {
					return {
						exitCode: 0,
						stdout: installedJson(["third.party"], {
							includeFirstParty: false,
						}),
						stderr: "",
					};
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			logImpl,
		});

		expect(calls).toEqual([
			["omarchy", "version"],
			["omarchy", "plugin", "list", "--json"],
		]);
		expect(commandType(calls, "add")).toEqual([]);
		expect(commandType(calls, "disable")).toEqual([]);
		expect(commandType(calls, "remove")).toEqual([]);
		expect(result.snapshotUnavailable).toBe(true);
		expect(lines.warning.join("\n")).toContain("no first-party plugin");
	});

	it.each([
		"null",
		"{}",
	])("skips all plugin work for a non-array plugin list (%s)", async (stdoutBody) => {
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

		expect(calls).toEqual([
			["omarchy", "version"],
			["omarchy", "plugin", "list", "--json"],
		]);
		expect(result.snapshotUnavailable).toBe(true);
		expect(result.installed).toEqual([]);
		expect(result.enabled).toEqual([]);
		expect(result.alreadyReady).toEqual([]);
		expect(result.failed).toEqual([]);
		expect(result.configured).toEqual([]);
		expect(result.configureFailed).toEqual([]);
		expect(lines.warning.join("\n")).toContain("expected a JSON array");
	});

	it("skips all plugin work for malformed plugin list JSON", async () => {
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

		expect(calls).toEqual([
			["omarchy", "version"],
			["omarchy", "plugin", "list", "--json"],
		]);
		expect(result.snapshotUnavailable).toBe(true);
		expect(result.installed).toEqual([]);
		expect(result.enabled).toEqual([]);
		expect(result.alreadyReady).toEqual([]);
		expect(result.failed).toEqual([]);
		expect(result.configured).toEqual([]);
		expect(result.configureFailed).toEqual([]);
		expect(lines.warning.join("\n")).toContain(
			"plugin list returned untrustworthy data",
		);
	});

	it("installs Advanced Audio Control from the shipped manifest and disables stock audio", async () => {
		const { calls, runner } = makeRunner({
			installedJsonBody: installedJson(["omarchy.audio"]),
		});
		const { logImpl } = makeLog();

		const result = await configureOmarchyPlugins({
			manifestPath: MANIFEST_PATH,
			runCommandImpl: runner,
			logImpl,
		});

		expect(result.installed).toContain("ssupt.audio-control");
		expect(commandType(calls, "add")).toContainEqual([
			"omarchy",
			"plugin",
			"add",
			"https://github.com/ssupt/omarchy-audio-control.git",
			"--enable",
			"--yes",
		]);
		expect(commandType(calls, "disable")).toContainEqual([
			"omarchy",
			"plugin",
			"disable",
			"omarchy.audio",
		]);
	});

	it("ships a manifest on disk with exactly the 11 expected plugins", () => {
		const EXPECTED_PLUGINS = [
			{
				id: "crmne.hyprmoncfg",
				url: "https://github.com/crmne/omarchy-hyprmoncfg.git",
				manualAuth:
					"Needs the hyprmoncfg AUR package and daemon (installed separately; not handled by this installer)",
			},
			{
				id: "white.nights",
				url: "https://github.com/nightdevil00/white.nights.git",
				manualAuth: null,
			},
			{
				id: "io.github.ciryon.pullbar",
				url: "https://github.com/ciryon/omarchy-pullbar.git",
				manualAuth: "GitHub CLI auth (`gh auth login`)",
			},
			{
				id: "io.github.treramey.raindrop-bookmarks",
				url: "https://github.com/treramey/omarchy-raindrop-bookmarks.git",
				manualAuth: "Raindrop API token",
			},
			{
				id: "omaconnect",
				url: "https://github.com/jitendradara12/omaconnect.git",
				manualAuth: "KDE Connect pairing",
			},
			{
				id: "io.github.thetrueferret.decent-workspaces",
				url: "https://github.com/TheTrueFerret/omarchy-decent-workspaces.git",
				manualAuth: null,
				disableOnInstall: ["omarchy.workspaces"],
			},
			{
				id: "io.github.woogy7.vitals",
				url: "https://github.com/Woogy7/omarchy-vitals.git",
				manualAuth: null,
			},
			{
				id: "aislandener.galaxy-buds",
				url: "https://github.com/aislandener/galaxy-buds-control.git",
				manualAuth: "Galaxy Buds Bluetooth pairing",
			},
			{
				id: "io.github.nag3sy.feishin",
				url: "https://github.com/nag3sy/feishin-omarchy-plugin.git",
				manualAuth: null,
			},
			{
				id: "io.github.nodrej.speech-orb",
				url: "https://github.com/nodrej/omarchy-speech-orb.git",
				manualAuth: null,
			},
			{
				id: "ssupt.audio-control",
				url: "https://github.com/ssupt/omarchy-audio-control.git",
				manualAuth: null,
				disableOnInstall: ["omarchy.audio"],
			},
		];

		const onDisk = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
		expect(onDisk).toEqual(EXPECTED_PLUGINS);

		const urlPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/;
		for (const plugin of onDisk) {
			expect(plugin.url).toMatch(urlPattern);
		}

		const ids = onDisk.map((plugin) => plugin.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

});
