import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { promptDeviceType } from "../src/helpers/configure_hyprland.js";
import { configureOmarchyWorkspaces } from "../src/helpers/configure_omarchy_workspaces.js";
import { runCachyOSSetup } from "../src/os_scripts/cachyos.js";

const projectRoot = path.resolve(import.meta.dir, "..");
const temporaryHomes = [];

function makeHome(configState) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-device-routing-"));
	temporaryHomes.push(home);
	fs.mkdirSync(path.join(home, ".config", "hypr"), { recursive: true });
	if (configState !== undefined)
		fs.writeFileSync(path.join(home, ".haoshoku.json"), configState);
	return home;
}

function workspaceDestination(home) {
	return path.join(home, ".config", "hypr", "haoshoku", "workspaces.lua");
}

afterEach(() => {
	for (const home of temporaryHomes.splice(0))
		fs.rmSync(home, { recursive: true, force: true });
});

describe("Omarchy deviceType routing", () => {
	it("deploys the laptop Lua workspace profile after setup records laptop", async () => {
		const home = makeHome();
		const startedAt = performance.now();
		const result = await runCachyOSSetup({
			prepareArchPackageManagerImpl: async () => true,
			ensureRustToolchainImpl: async () => {},
			ensureAurHelperImpl: async () => "paru",
			installDevToolsImpl: async () => {},
			commandExistsImpl: async () => true,
			installSystemPackagesImpl: async () => {},
			installFlatpakAppsImpl: async () => {},
			configureUserAppsImpl: async () => {},
			promptDeviceTypeImpl: () =>
				promptDeviceType({
					configPath: path.join(home, ".haoshoku.json"),
					promptFn: async () => ({ device: "laptop" }),
				}),
			configureBraveManagedPoliciesImpl: async () => true,
			configureHyprmoncfgImpl: async () => {},
			configureOmarchyWorkspacesImpl: () => configureOmarchyWorkspaces({ home }),
			configureOmarchyPluginsImpl: async () => {},
			configureOmazedImpl: async () => {},
		});

		expect(result).toBe(true);
		expect(performance.now() - startedAt).toBeLessThan(500);
		expect(fs.readFileSync(workspaceDestination(home))).toEqual(
			fs.readFileSync(
				path.join(
					projectRoot,
					"configs",
					"omarchy",
					"haoshoku",
					"workspaces-laptop.lua",
				),
			),
		);
	});

	for (const scenario of [
		{ name: "pc", config: JSON.stringify({ deviceType: "pc" }), variant: "pc" },
		{
			name: "laptop",
			config: JSON.stringify({ deviceType: "laptop" }),
			variant: "laptop",
		},
		{ name: "unset", config: undefined, variant: "pc" },
		{ name: "malformed", config: "{not-json\n", variant: "pc" },
	]) {
		it(`deploys the ${scenario.variant} Lua profile for ${scenario.name} deviceType`, async () => {
			const home = makeHome(scenario.config);
			await configureOmarchyWorkspaces({ home });

			expect(fs.readFileSync(workspaceDestination(home))).toEqual(
				fs.readFileSync(
					path.join(
						projectRoot,
						"configs",
						"omarchy",
						"haoshoku",
						`workspaces-${scenario.variant}.lua`,
					),
				),
			);
		});
	}
});
