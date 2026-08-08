import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { promptDeviceType } from "../src/helpers/configure_hyprland.js";
import { configureOmarchyMonitors } from "../src/helpers/configure_omarchy_monitors.js";
import { configureOmarchyWorkspaces } from "../src/helpers/configure_omarchy_workspaces.js";
import { runCachyOSSetup } from "../src/os_scripts/cachyos.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const temporaryHomes = [];

function makeHome(configState) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-device-routing-"));
	temporaryHomes.push(home);
	fs.mkdirSync(path.join(home, ".config", "hypr"), { recursive: true });
	fs.writeFileSync(
		path.join(home, ".config", "hypr", "hyprland.conf"),
		"source = ~/.config/hypr/monitors.conf\nsource = ~/.config/hypr/bindings.conf\n",
	);
	fs.writeFileSync(
		path.join(home, ".config", "hypr", "bindings.conf"),
		"stock Omarchy bindings\n",
	);
	if (configState !== undefined) {
		fs.writeFileSync(path.join(home, ".haoshoku.json"), configState);
	}
	return home;
}

async function runOmarchySetup({
	home,
	promptDeviceTypeImpl,
	configureUserAppsImpl = async () => {},
}) {
	return runCachyOSSetup({
		prepareArchPackageManagerImpl: async () => true,
		ensureRustToolchainImpl: async () => {},
		ensureAurHelperImpl: async () => "paru",
		installDevToolsImpl: async () => {},
		commandExistsImpl: async () => true,
		installSystemPackagesImpl: async () => {},
		installFlatpakAppsImpl: async () => {},
		promptDeviceTypeImpl,
		configureUserAppsImpl,
		configureBraveManagedPoliciesImpl: async () => true,
		configureOmarchyMonitorsImpl: () =>
			configureOmarchyMonitors({ home, env: {} }),
		configureOmarchyWorkspacesImpl: () =>
			configureOmarchyWorkspaces({ home, env: {} }),
		configureOmazedImpl: async () => {},
	});
}

afterEach(() => {
	for (const home of temporaryHomes.splice(0)) {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

describe("Omarchy deviceType routing", () => {
	it("deploys laptop configs after the setup prompt is answered laptop", async () => {
		const home = makeHome();
		const events = [];

		const result = await runOmarchySetup({
			home,
			promptDeviceTypeImpl: async () => {
				events.push("device-prompt");
				return promptDeviceType({
					configPath: path.join(home, ".haoshoku.json"),
					promptFn: async () => ({ device: "laptop" }),
				});
			},
			configureUserAppsImpl: async () => {
				events.push("user-apps");
				expect(
					JSON.parse(
						fs.readFileSync(path.join(home, ".haoshoku.json"), "utf8"),
					).deviceType,
				).toBe("laptop");
			},
		});

		expect(result).toBe(true);
		expect(events).toEqual(["device-prompt", "user-apps"]);
		expect(
			fs.readFileSync(
				path.join(home, ".config", "hypr", "haoshoku-workspaces.conf"),
				"utf8",
			),
		).toBe(
			fs.readFileSync(
				path.join(
					PROJECT_ROOT,
					"configs",
					"omarchy",
					"workspaces-laptop.conf",
				),
				"utf8",
			),
		);
		expect(
			fs.readFileSync(
				path.join(home, ".config", "hypr", "monitors.conf"),
				"utf8",
			),
		).toBe(
			fs.readFileSync(
				path.join(
					PROJECT_ROOT,
					"configs",
					"omarchy",
					"monitors-laptop.conf",
				),
				"utf8",
			),
		);
	});

	it("uses the pc routing during unattended setup without persisting or invoking a prompt", async () => {
		const home = makeHome();
		let promptCalls = 0;

		const result = await runOmarchySetup({
			home,
			promptDeviceTypeImpl: () =>
				promptDeviceType({
					configPath: path.join(home, ".haoshoku.json"),
					isTTY: false,
					promptFn: async () => {
						promptCalls += 1;
						throw new Error("prompt must not run");
					},
				}),
		});

		expect(result).toBe(true);
		expect(promptCalls).toBe(0);
		expect(fs.existsSync(path.join(home, ".haoshoku.json"))).toBeFalse();
		expect(
			fs.readFileSync(path.join(home, ".config", "hypr", "monitors.conf")),
		).toEqual(
			fs.readFileSync(
				path.join(
					PROJECT_ROOT,
					"configs",
					"omarchy",
					"monitors-pc.conf",
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
		it(`deploys the ${scenario.variant} variants for ${scenario.name} deviceType`, async () => {
			const home = makeHome(scenario.config);

			await configureOmarchyMonitors({ home, env: {} });
			await configureOmarchyWorkspaces({ home, env: {} });

			const deployedWorkspaces = fs.readFileSync(
				path.join(home, ".config", "hypr", "haoshoku-workspaces.conf"),
				"utf8",
			);
			const deployedMonitors = fs.readFileSync(
				path.join(home, ".config", "hypr", "monitors.conf"),
				"utf8",
			);
			const variantWorkspaces = path.join(
				PROJECT_ROOT,
				"configs",
				"omarchy",
				`workspaces-${scenario.variant}.conf`,
			);
			const variantMonitors = path.join(
				PROJECT_ROOT,
				"configs",
				"omarchy",
				`monitors-${scenario.variant}.conf`,
			);

			if (scenario.variant === "laptop") {
				expect(deployedWorkspaces).not.toContain("monitor:");
				expect(deployedMonitors).toContain(
					"monitor = , preferred, auto, auto",
				);
				expect(deployedMonitors).not.toContain("monitor = DP-");
				expect(deployedMonitors).not.toContain("monitor = HDMI-");
			} else {
				expect(deployedWorkspaces).toContain("monitor:DP-1");
				expect(deployedMonitors).toContain("monitor = DP-2");
			}
			expect(fs.existsSync(variantWorkspaces)).toBe(true);
			expect(fs.existsSync(variantMonitors)).toBe(true);
			if (!fs.existsSync(variantWorkspaces) || !fs.existsSync(variantMonitors)) {
				return;
			}
			expect(deployedWorkspaces).toBe(
				fs.readFileSync(variantWorkspaces, "utf8"),
			);
			expect(deployedMonitors).toBe(fs.readFileSync(variantMonitors, "utf8"));
		});
	}
});

describe("Omarchy workspace variants", () => {
	it("pins PC workspaces 8 and 9 while keeping laptop workspaces unpinned", () => {
		const pcPath = path.join(
			PROJECT_ROOT,
			"configs",
			"omarchy",
			"workspaces-pc.conf",
		);
		const laptopPath = path.join(
			PROJECT_ROOT,
			"configs",
			"omarchy",
			"workspaces-laptop.conf",
		);
		const pc = fs.readFileSync(pcPath, "utf8");
		const laptop = fs.readFileSync(laptopPath, "utf8");

		expect(pc).toContain("workspace = 8, monitor:DP-1, persistent:true");
		expect(pc).toContain("workspace = 9, monitor:HDMI-A-1, persistent:true");
		expect(laptop).toContain("workspace = 8, persistent:true");
		expect(laptop).toContain("workspace = 9, persistent:true");
		expect(laptop).not.toMatch(/^workspace = [89], monitor:/m);
	});

	it("keeps laptop behavior byte-aligned with PC except topology metadata", () => {
		const pcPath = path.join(
			PROJECT_ROOT,
			"configs",
			"omarchy",
			"workspaces-pc.conf",
		);
		const laptopPath = path.join(
			PROJECT_ROOT,
			"configs",
			"omarchy",
			"workspaces-laptop.conf",
		);
		expect(fs.existsSync(pcPath)).toBe(true);
		expect(fs.existsSync(laptopPath)).toBe(true);
		if (!fs.existsSync(pcPath) || !fs.existsSync(laptopPath)) return;

		const pc = fs.readFileSync(pcPath, "utf8");
		const laptop = fs.readFileSync(laptopPath, "utf8");
		const linesMatching = (text, pattern) =>
			text.split(/\r?\n/).filter((line) => pattern.test(line));
		const workspaceIds = (text) =>
			linesMatching(text, /^workspace = \d+,/).map(
				(line) => line.match(/^workspace = (\d+),/)?.[1],
			);
		const behaviorLines = (text) =>
			linesMatching(
				text,
				/^(?:bindd?|unbind|windowrule|exec-once)\s*=|togglespecialworkspace/,
			);
		const normalizeTopology = (text) =>
			text
				.split(/\r?\n/)
				.map((line) => {
					if (!line.startsWith("workspace = ")) return line;
					const withoutMonitor = line.replace(/, monitor:[^,]+/, "");
					return withoutMonitor.startsWith("workspace = 5,")
						? withoutMonitor.replace(", default:true", "")
						: withoutMonitor;
				})
				.join("\n");

		expect(workspaceIds(laptop)).toEqual(workspaceIds(pc));
		expect(behaviorLines(laptop)).toEqual(behaviorLines(pc));
		expect(normalizeTopology(laptop)).toBe(normalizeTopology(pc));
		expect(linesMatching(laptop, /default:true/)).toEqual([
			"workspace = 1, default:true, persistent:true",
		]);
		expect(laptop).not.toContain("monitor:");
	});
});
