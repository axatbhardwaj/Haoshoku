import { describe, expect, it } from "bun:test";
import path from "node:path";

import { Command } from "commander";

const projectRoot = path.resolve(import.meta.dir, "..");
const cli = path.join(projectRoot, "haoshoku.js");
const hyprmoncfgHelper = path.join(
	projectRoot,
	"src/helpers/configure_hyprmoncfg.js",
);
const pluginsHelper = path.join(
	projectRoot,
	"src/helpers/configure_omarchy_plugins.js",
);
const migrationHelper = path.join(
	projectRoot,
	"src/helpers/migrate_omarchy_3_to_4.js",
);

function runCliMode({
	flag,
	helperPath,
	helperExport,
	marker,
	migrationStatus = "completed",
	migrationResult,
}) {
	const helperExports =
		helperPath === hyprmoncfgHelper
			? ["configureHyprmoncfg", "backupHyprmoncfg"]
			: helperPath === pluginsHelper
				? ["configureOmarchyPlugins"]
				: ["migrateOmarchy3To4"];
	const childScript = `
		import { mock } from "bun:test";
		mock.module(${JSON.stringify(helperPath)}, () => ({
			${helperExports
				.map(
					(exportName) =>
							`${exportName}: async () => { ${exportName === helperExport ? `console.log(${JSON.stringify(marker)}); ${exportName === "migrateOmarchy3To4" ? `return ${JSON.stringify(migrationResult ?? { status: migrationStatus })};` : ""}` : ""} }`,
				)
				.join(",\n\t\t\t")}
		}));
		process.argv = [process.execPath, ${JSON.stringify(cli)}, ${JSON.stringify(flag)}];
		await import(${JSON.stringify(cli)} + "?cli-mode=" + ${JSON.stringify(flag)});
	`;
	const child = Bun.spawnSync([process.execPath, "--eval", childScript], {
		stderr: "pipe",
		stdout: "pipe",
	});
	return {
		exitCode: child.exitCode,
		output: `${new TextDecoder().decode(child.stdout)}\n${new TextDecoder().decode(child.stderr)}`,
	};
}

describe("Omarchy one-shot CLI modes", () => {
	it("maps --3-4-migrate to Commander's 34Migrate option key", () => {
		const command = new Command().option("--3-4-migrate");
		command.parse(["bun", "haoshoku", "--3-4-migrate"]);

		expect(command.opts()["34Migrate"]).toBe(true);
	});

	it("routes each mode through its isolated helper seam", () => {
		for (const mode of [
			{
				flag: "--monitors",
				helperPath: hyprmoncfgHelper,
				helperExport: "configureHyprmoncfg",
				marker: "HYPRMONCFG_DEPLOYED",
			},
			{
				flag: "--hyprmoncfg-backup",
				helperPath: hyprmoncfgHelper,
				helperExport: "backupHyprmoncfg",
				marker: "HYPRMONCFG_BACKED_UP",
			},
			{
				flag: "--omarchy-plugins",
				helperPath: pluginsHelper,
				helperExport: "configureOmarchyPlugins",
				marker: "OMARCHY_PLUGINS_CONFIGURED",
			},
			{
				flag: "--3-4-migrate",
				helperPath: migrationHelper,
				helperExport: "migrateOmarchy3To4",
				marker: "OMARCHY_3_TO_4_MIGRATED",
			},
		]) {
			const result = runCliMode(mode);
			expect(result.exitCode, result.output).toBe(0);
			expect(result.output).toContain(mode.marker);
		}
	});

	for (const status of [
		"completed",
		"refused",
		"failed",
		"deferred",
		"manual attention",
	]) {
		it(`reports migration CLI status and exits appropriately for ${status}`, () => {
			const result = runCliMode({
				flag: "--3-4-migrate",
				helperPath: migrationHelper,
				helperExport: "migrateOmarchy3To4",
				marker: `MIGRATION_RESULT_${status}`,
				migrationStatus: status,
			});

			expect(result.output).toContain(
				`Omarchy 3→4 migration status: ${status}`,
			);
			expect(result.exitCode).toBe(status === "completed" ? 0 : 1);
		});
	}

	it("prints migration steps, backup paths, and follow-up checklists", () => {
		const result = runCliMode({
			flag: "--3-4-migrate",
			helperPath: migrationHelper,
			helperExport: "migrateOmarchy3To4",
			marker: "MIGRATION_DETAILS",
			migrationResult: {
				status: "manual attention",
				steps: [
					{ name: "version gate", status: "clean" },
					{
						name: "orphan cleanup",
						status: "applied",
						files: [
							{
								path: "/tmp/monitors.conf",
								status: "applied",
								backup: "/tmp/monitors.conf.bak.42",
							},
						],
					},
					{
						name: "monitors.lua regeneration",
						status: "manual attention",
						restoredFrom: "/tmp/monitors.lua.bak.42",
					},
				],
				manualAuthChecklist: [
					{ id: "weather", requirement: "sign in" },
				],
				laptopFollowUp: "save the laptop profile",
				recoveryInstruction: "restore monitors.lua from backup",
			},
		});

		expect(result.output).toContain("version gate: clean");
		expect(result.output).toContain("orphan cleanup: applied");
		expect(result.output).toContain("/tmp/monitors.conf.bak.42");
		expect(result.output).toContain("/tmp/monitors.lua.bak.42");
		expect(result.output).toContain("weather: sign in");
		expect(result.output).toContain("save the laptop profile");
		expect(result.output).toContain("restore monitors.lua from backup");
	});

	it("describes the Omarchy 4 destinations without legacy v3 artifacts", () => {
		const result = Bun.spawnSync([cli, "--help"], { stdout: "pipe" });
		const help = result.stdout.toString().replace(/\s+/g, " ");

		expect(result.exitCode).toBe(0);
		expect(help).toContain(
			"--monitors Deploy hyprmoncfg profile JSON to ~/.config/hyprmoncfg/profiles/, ensure and enable hyprmoncfg",
		);
		expect(help).toContain(
			"--hyprmoncfg-backup Backup live hyprmoncfg profile JSON to configs/hyprmoncfg/profiles/",
		);
		expect(help).toContain(
			"--omarchy-plugins Configure the Omarchy plugins declared in common/omarchy-plugins.json",
		);
		expect(help).toContain(
			"--3-4-migrate Migrate an Omarchy 3 configuration to Omarchy 4",
		);
		expect(help).not.toContain("monitors.conf");
		expect(help).not.toContain("hyprland.conf");
		expect(help).not.toContain("source =");
	});
});
