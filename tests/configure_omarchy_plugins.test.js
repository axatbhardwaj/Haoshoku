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
		id: "dizziee.system-stats",
		url: "https://github.com/JJDizz1L/dizziee.system-stats.git",
		manualAuth: null,
	},
	{
		id: "io.github.viganogabriele.agent-usage-plus",
		url: "https://github.com/viganogabriele/agent-usage-plus.git",
		manualAuth: null,
		disableOnInstall: ["omarchy.agents", "robzolkos.agent-usage"],
	},
	{
		id: "aislandener.galaxy-buds",
		url: "https://github.com/aislandener/galaxy-buds-control.git",
		manualAuth: "Galaxy Buds Bluetooth pairing",
	},
];

const DECENT_WORKSPACES = MANIFEST.find(
	(plugin) => plugin.id === "io.github.thetrueferret.decent-workspaces",
);

const MISSING_WHEN_FIRST_8_PRESENT = ["aislandener.galaxy-buds"];

const MANUAL_AUTH_IDS = [
	"crmne.hyprmoncfg",
	"robzolkos.github",
	"io.github.treramey.raindrop-bookmarks",
	"omaconnect",
	"aislandener.galaxy-buds",
];

function installedJson(
	enabledIds,
	{ disabled = [], includeFirstParty = true } = {},
) {
	const ids = [...enabledIds, ...disabled];
	if (includeFirstParty && !ids.some((id) => id.startsWith("omarchy."))) {
		ids.unshift("omarchy.shell");
	}
	return JSON.stringify(
		ids.map((id) => ({
			id,
			enabled: !disabled.includes(id),
			firstParty: id.startsWith("omarchy."),
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
	it("installs only the 1 missing plugin when 8 of 9 are already enabled", async () => {
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
			"io.github.viganogabriele.agent-usage-plus",
			"aislandener.galaxy-buds",
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
				{ id: "robzolkos.github", requirement: "GitHub token" },
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

	it("ships a manifest on disk with exactly the 9 expected plugins", () => {
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
				id: "dizziee.system-stats",
				url: "https://github.com/JJDizz1L/dizziee.system-stats.git",
				manualAuth: null,
			},
			{
				id: "io.github.viganogabriele.agent-usage-plus",
				url: "https://github.com/viganogabriele/agent-usage-plus.git",
				manualAuth: null,
				disableOnInstall: ["omarchy.agents", "robzolkos.agent-usage"],
			},
			{
				id: "aislandener.galaxy-buds",
				url: "https://github.com/aislandener/galaxy-buds-control.git",
				manualAuth: "Galaxy Buds Bluetooth pairing",
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

	it("NEVER issues omarchy plugin remove under failures, stale snapshots, or legacy arrangement-shaped input", async () => {
		// Permanent data-loss guard: three cold-review findings shared one forbidden
		// side effect. No installer failure is ever allowed to remove user plugin data.
		const legacyBarPlugin = {
			...DECENT_WORKSPACES,
			bar: { section: "left", index: 1 },
		};
		const legacySettingsPlugin = {
			...DECENT_WORKSPACES,
			settings: { maxWorkspaceId: 11 },
		};
		const scenarios = [
			{
				name: "failed add",
				plugin: DECENT_WORKSPACES,
				list: installedJson(["omarchy.workspaces"]),
				fail: (argv) => argv[1] === "plugin" && argv[2] === "add",
			},
			{
				name: "failed disableOnInstall",
				plugin: DECENT_WORKSPACES,
				list: installedJson(["omarchy.workspaces"]),
				fail: (argv) => argv[1] === "plugin" && argv[2] === "disable",
			},
			{
				name: "untrustworthy snapshot",
				plugin: DECENT_WORKSPACES,
				list: JSON.stringify([{ id: "third.party", enabled: true }]),
				fail: () => false,
			},
			{
				name: "obsolete bar input failure",
				plugin: legacyBarPlugin,
				list: installedJson(["omarchy.workspaces"]),
				fail: (argv) => argv[1] === "bar" && argv[2] === "move",
			},
			{
				name: "obsolete settings input failure",
				plugin: legacySettingsPlugin,
				list: installedJson(["omarchy.workspaces"]),
				fail: (argv) => argv[1] === "bar" && argv[2] === "set",
			},
		];

		for (const scenario of scenarios) {
			const calls = [];
			await configureOmarchyPlugins({
				manifest: [scenario.plugin],
				runCommandImpl: async (argv) => {
					calls.push(argv);
					if (argv.join(" ") === "omarchy version") {
						return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
					}
					if (argv.join(" ") === "omarchy plugin list --json") {
						return { exitCode: 0, stdout: scenario.list, stderr: "" };
					}
					if (scenario.fail(argv)) {
						return { exitCode: 1, stdout: "", stderr: "injected failure" };
					}
					return { exitCode: 0, stdout: "", stderr: "" };
				},
				logImpl: makeLog().logImpl,
			});

			expect({
				scenario: scenario.name,
				removeCalls: commandType(calls, "remove"),
			}).toEqual({ scenario: scenario.name, removeCalls: [] });
		}
	});

	it("does not attempt add when the list snapshot is untrustworthy", async () => {
		const calls = [];
		const result = await configureOmarchyPlugins({
			manifest: [DECENT_WORKSPACES],
			runCommandImpl: async (argv) => {
				calls.push(argv);
				if (argv.join(" ") === "omarchy version") {
					return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
				}
				if (argv.join(" ") === "omarchy plugin list --json") {
					return { exitCode: 1, stdout: "", stderr: "shell unavailable" };
				}
				if (argv[1] === "plugin" && argv[2] === "add") {
					return { exitCode: 1, stdout: "", stderr: "already installed" };
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			logImpl: makeLog().logImpl,
		});

		expect(calls).toEqual([
			["omarchy", "version"],
			["omarchy", "plugin", "list", "--json"],
		]);
		expect(result.snapshotUnavailable).toBe(true);
		expect(result.failed).toEqual([]);
		expect(result.configureFailed).toEqual([]);
	});

	it("skips disableOnInstall when the list snapshot is untrustworthy", async () => {
		const calls = [];
		const result = await configureOmarchyPlugins({
			manifest: [DECENT_WORKSPACES],
			runCommandImpl: async (argv) => {
				calls.push(argv);
				if (argv.join(" ") === "omarchy version") {
					return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
				}
				if (argv.join(" ") === "omarchy plugin list --json") {
					return { exitCode: 1, stdout: "", stderr: "shell unavailable" };
				}
				if (argv.join(" ") === "omarchy plugin disable omarchy.workspaces") {
					return { exitCode: 1, stdout: "", stderr: "plugin is not known" };
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			logImpl: makeLog().logImpl,
		});

		expect(calls).toEqual([
			["omarchy", "version"],
			["omarchy", "plugin", "list", "--json"],
		]);
		expect(result.snapshotUnavailable).toBe(true);
		expect(result.installed).toEqual([]);
		expect(result.configured).toEqual([]);
		expect(result.configureFailed).toEqual([]);
	});

	it("does not report a fresh plugin without disableOnInstall as configured", async () => {
		const plainPlugin = MANIFEST[1];
		const result = await configureOmarchyPlugins({
			manifest: [plainPlugin],
			runCommandImpl: makeRunner({ installedJsonBody: installedJson([]) }).runner,
			logImpl: makeLog().logImpl,
		});

		expect(result.installed).toEqual([plainPlugin.id]);
		expect(result.configured).toEqual([]);
	});

	it("runs fresh-install disableOnInstall after add and reports it configured", async () => {
		const calls = [];
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
						stdout: installedJson(["omarchy.workspaces"]),
						stderr: "",
					};
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			logImpl: makeLog().logImpl,
		});

		expect(calls.slice(2)).toEqual([
			["omarchy", "plugin", "add", DECENT_WORKSPACES.url, "--enable", "--yes"],
			["omarchy", "plugin", "disable", "omarchy.workspaces"],
		]);
		expect(result.configured).toEqual([DECENT_WORKSPACES.id]);
	});

	it("does not reapply disableOnInstall for a present-and-enabled plugin", async () => {
		const { calls, runner } = makeRunner({
			installedJsonBody: installedJson([DECENT_WORKSPACES.id, "omarchy.workspaces"]),
		});
		const result = await configureOmarchyPlugins({
			manifest: [DECENT_WORKSPACES],
			runCommandImpl: runner,
			logImpl: makeLog().logImpl,
		});

		expect(calls.slice(2)).toEqual([]);
		expect(result.alreadyReady).toEqual([DECENT_WORKSPACES.id]);
	});

	it("enables a present-but-disabled plugin without reapplying disableOnInstall", async () => {
		const { calls, runner } = makeRunner({
			installedJsonBody: installedJson(["omarchy.workspaces"], {
				disabled: [DECENT_WORKSPACES.id],
			}),
		});
		const result = await configureOmarchyPlugins({
			manifest: [DECENT_WORKSPACES],
			runCommandImpl: runner,
			logImpl: makeLog().logImpl,
		});

		expect(calls.slice(2)).toEqual([
			["omarchy", "plugin", "enable", DECENT_WORKSPACES.id],
		]);
		expect(result.enabled).toEqual([DECENT_WORKSPACES.id]);
	});

	it.each([
		{ label: "disabled", list: installedJson([], { disabled: ["omarchy.workspaces"] }) },
		{ label: "absent", list: installedJson([]) },
	])("skips a disableOnInstall target that is $label", async ({ list }) => {
		const { calls, runner } = makeRunner({ installedJsonBody: list });
		await configureOmarchyPlugins({
			manifest: [DECENT_WORKSPACES],
			runCommandImpl: runner,
			logImpl: makeLog().logImpl,
		});

		expect(commandType(calls, "disable")).toEqual([]);
	});

	it("reports each failing disableOnInstall target while keeping the plugin", async () => {
		const calls = [];
		const plugin = {
			...DECENT_WORKSPACES,
			disableOnInstall: ["omarchy.workspaces", "omarchy.workspaces-secondary"],
		};
		const result = await configureOmarchyPlugins({
			manifest: [plugin],
			runCommandImpl: async (argv) => {
				calls.push(argv);
				if (argv.join(" ") === "omarchy version") {
					return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
				}
				if (argv.join(" ") === "omarchy plugin list --json") {
					return {
						exitCode: 0,
						stdout: installedJson([
							"omarchy.workspaces",
							"omarchy.workspaces-secondary",
						]),
						stderr: "",
					};
				}
				if (argv[1] === "plugin" && argv[2] === "disable") {
					return { exitCode: 1, stdout: "", stderr: "disable failed" };
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			logImpl: makeLog().logImpl,
		});

		expect(commandType(calls, "remove")).toEqual([]);
		expect(result.installed).toEqual([plugin.id]);
		expect(result.configured).toEqual([]);
		expect(result.configureFailed).toEqual([
			{
				id: plugin.id,
				action: "disable",
				targetId: "omarchy.workspaces",
			},
			{
				id: plugin.id,
				action: "disable",
				targetId: "omarchy.workspaces-secondary",
			},
		]);
	});

	it("does not retry disableOnInstall on the run after a disable failure", async () => {
		const first = await configureOmarchyPlugins({
			manifest: [DECENT_WORKSPACES],
			runCommandImpl: async (argv) => {
				if (argv.join(" ") === "omarchy version") {
					return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
				}
				if (argv.join(" ") === "omarchy plugin list --json") {
					return {
						exitCode: 0,
						stdout: installedJson(["omarchy.workspaces"]),
						stderr: "",
					};
				}
				if (argv.join(" ") === "omarchy plugin disable omarchy.workspaces") {
					return { exitCode: 1, stdout: "", stderr: "disable failed" };
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			logImpl: makeLog().logImpl,
		});

		expect(first.configureFailed).toEqual([
			{
				id: DECENT_WORKSPACES.id,
				action: "disable",
				targetId: "omarchy.workspaces",
			},
		]);

		const secondCalls = [];
		const second = await configureOmarchyPlugins({
			manifest: [DECENT_WORKSPACES],
			runCommandImpl: async (argv) => {
				secondCalls.push(argv);
				if (argv.join(" ") === "omarchy version") {
					return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
				}
				return {
					exitCode: 0,
					stdout: installedJson([
						DECENT_WORKSPACES.id,
						"omarchy.workspaces",
					]),
					stderr: "",
				};
			},
			logImpl: makeLog().logImpl,
		});

		expect(secondCalls).toEqual([
			["omarchy", "version"],
			["omarchy", "plugin", "list", "--json"],
		]);
		expect(second.alreadyReady).toEqual([DECENT_WORKSPACES.id]);
		expect(second.configured).toEqual([]);
		expect(second.configureFailed).toEqual([]);
	});

});
