import { describe, expect, it } from "bun:test";

import { configureOmarchyPlugins } from "../../src/helpers/configure_omarchy_plugins.js";
import {
	MANIFEST,
	DECENT_WORKSPACES,
	installedJson,
	makeRunner,
	makeLog,
	commandType,
} from "./fixtures.js";

describe("Omarchy plugin installer", () => {
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
			runCommandImpl: makeRunner({ installedJsonBody: installedJson([]) })
				.runner,
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
			installedJsonBody: installedJson([
				DECENT_WORKSPACES.id,
				"omarchy.workspaces",
			]),
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
		{
			label: "disabled",
			list: installedJson([], { disabled: ["omarchy.workspaces"] }),
		},
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
					stdout: installedJson([DECENT_WORKSPACES.id, "omarchy.workspaces"]),
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
