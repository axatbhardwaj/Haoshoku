import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { log, promptUser } from "../src/common/utils.js";
import { promptDeviceType } from "../src/common/device_type.js";
import {
	configureUserApps,
	runCachyOSSetup,
} from "../src/os_scripts/cachyos.js";

const temporaryHomes = [];

afterEach(() => {
	for (const home of temporaryHomes.splice(0)) {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

function makeHome() {
	const home = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-default-reachability-"),
	);
	temporaryHomes.push(home);
	return home;
}

function deployModeFeaturesFromCli() {
	const cliPath = path.resolve(import.meta.dir, "..", "haoshoku.js");
	const source = fs.readFileSync(cliPath, "utf8");
	const optionUsages = [
		...source.matchAll(/\.option\(\s*"(--[a-z0-9-]+(?:\s+[^" ]+)?)"\s*,/g),
	].map(([, usage]) => usage);
	// Update and migration modes are not independent deploy capabilities on a
	// default setup path. This guard does not execute those state-specific
	// branches, so exclude them instead of claiming default-path coverage.
	const excludedNonDefaultModes = new Set([
		"--claude-update",
		"--skills",
		"--skills-update",
		"--3-4-migrate",
	]);

	return optionUsages
		.map((usage) => usage.split(/\s+/)[0])
		.filter(
			(flag) =>
				flag !== "--os" &&
				flag !== "--device-type" &&
				!excludedNonDefaultModes.has(flag) &&
				!flag.endsWith("-backup") &&
				!flag.endsWith("-list"),
		)
		.map((flag) => ({
			flag,
			feature: flag
				.slice(2)
				.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
		}));
}

// These are deliberate product boundaries, not gaps to hide from the guard.
// Arch/Omarchy offers every deploy feature, so its allowlist stays empty.
// Debian Server is headless: audio, MIME/browser scripts, and Omarchy display
// configuration are desktop-only and intentionally remain on the Arch path.
const DELIBERATE_OMISSIONS = {
	arch: new Map([
		[
			"--server-t3-code",
			"Arch installs the desktop package instead of the Debian headless service.",
		],
	]),
	"debian-server": new Map([
		["--audio", "WirePlumber routing depends on desktop device profiles."],
		["--mimeapps", "Default-app routing is a desktop-session concern."],
		["--scripts", "The managed user scripts are desktop app launchers."],
		["--workspaces", "Hyprland workspaces do not exist on a headless server."],
		["--monitors", "Hyprland monitor routing requires a desktop display."],
		[
			"--omarchy-plugins",
			"Omarchy plugins require the Omarchy desktop environment.",
		],
		[
			"--omarchy-bar",
			"The Omarchy bar requires the Omarchy desktop environment.",
		],
		[
			"--brave-managed-policies",
			"Brave/Omarchy theming is not installed on the server path.",
		],
	]),
};

function runIsolated(script, marker) {
	const home = makeHome();
	const child = Bun.spawnSync([process.execPath, "--eval", script], {
		env: {
			...process.env,
			HOME: home,
			TMPDIR: home,
			USER: "haoshoku-test",
		},
		stderr: "pipe",
		stdin: "ignore",
		stdout: "pipe",
	});
	const output = `${new TextDecoder().decode(child.stdout)}\n${new TextDecoder().decode(child.stderr)}`;
	expect(child.exitCode, output).toBe(0);
	const encoded = output.match(new RegExp(`${marker}=(.*)`))?.[1];
	expect(encoded, output).toBeDefined();
	return JSON.parse(encoded);
}

function runArchDefaultPath() {
	const modulePath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"os_scripts",
		"cachyos.js",
	);
	return runIsolated(
		`
			const calls = [];
			const record = (feature, result) => async () => {
				calls.push(feature);
				return result;
			};
			const {
				configureBrowserIntegration,
				configureUserApps,
				runCachyOSSetup,
			} = await import(${JSON.stringify(modulePath)});
			await runCachyOSSetup({
				promptDeviceTypeImpl: record("deviceType"),
				prepareArchPackageManagerImpl: record("packageManager", true),
				ensureRustToolchainImpl: record("rust"),
				ensureAurHelperImpl: record("aur", "paru"),
				installDevToolsImpl: record("devTools"),
				commandExistsImpl: async (command) => command === "omarchy",
				installSystemPackagesImpl: record("systemPackages"),
				installFlatpakAppsImpl: record("flatpaks"),
				configureUserAppsImpl: () => configureUserApps({
					promptUserImpl: async () => true,
					configureGitImpl: record("git"),
					configureBrowserIntegrationImpl: () => configureBrowserIntegration({
						configureChromiumProfilesImpl: record("chromiumProfiles"),
						configureMimeappsImpl: record("mimeapps"),
						installUserScriptsImpl: record("scripts"),
					}),
					configureAudioImpl: record("audio"),
					configureBashImpl: record("bash"),
					configureFastfetchImpl: record("fastfetch"),
					configureKittyImpl: record("kitty"),
					runCommandImpl: record("uosc", true),
					enableServicesImpl: record("services"),
					configureClaudeImpl: record("claude"),
					installGhStackImpl: record("ghStack"),
					configureClaudeStayAwakeImpl: record("claudeStayAwake"),
					configureClaudeRemoteControlImpl: record("claudeRemoteControl"),
					configurePrWatchImpl: record("prWatch"),
					syncWorktreeCleanupImpl: record("worktreeCleanup"),
					configureCodexImpl: record("codex"),
					configureSkillsImpl: record("skills", true),
				}),
				configureBraveManagedPoliciesImpl: record("braveManagedPolicies", true),
				configureHyprmoncfgImpl: record("monitors"),
				configureOmarchyWorkspacesImpl: record("workspaces"),
				configureOmarchyPluginsImpl: record("omarchyPlugins"),
				configureOmarchyBarImpl: record("omarchyBar"),
				configureOmazedImpl: record("omazed"),
			});
			console.log("DEFAULT_CALLS=" + JSON.stringify(calls));
		`,
		"DEFAULT_CALLS",
	);
}

function runDebianDefaultPath() {
	const modulePath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"os_scripts",
		"debian_server.js",
	);
	const utilsPath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"common",
		"utils.js",
	);
	const uiPath = path.resolve(import.meta.dir, "..", "src", "common", "ui.js");
	const helperPath = (file) =>
		path.resolve(import.meta.dir, "..", "src", "helpers", file);
	return runIsolated(
		`
			import { mock } from "bun:test";
				const calls = [];
			const record = (feature, result) => async () => {
				calls.push(feature);
				return result;
			};
			mock.module(${JSON.stringify(utilsPath)}, () => ({
				commandExists: async () => false,
				log: { dim() {}, error() {}, info() {}, success() {}, warning() {} },
				promptUser: async () => true,
				runCommand: async () => true,
				safeCopyFile() {},
			}));
			mock.module(${JSON.stringify(uiPath)}, () => ({
				withSpinner: async (_message, action) => action(),
			}));
			mock.module(${JSON.stringify(helperPath("configure_git.js"))}, () => ({
				configureGit: record("git"),
			}));
			mock.module(${JSON.stringify(helperPath("configure_claude.js"))}, () => ({
				configureClaude: record("claude"),
			}));
			mock.module(${JSON.stringify(helperPath("configure_gh_stack.js"))}, () => ({ installGhStack: record("ghStack") }));
			mock.module(${JSON.stringify(helperPath("configure_claude_stay_awake.js"))}, () => ({
				configureClaudeStayAwake: record("claudeStayAwake"),
			}));
			mock.module(${JSON.stringify(helperPath("configure_claude_remote_control.js"))}, () => ({
				configureClaudeRemoteControl: record("claudeRemoteControl"),
			}));
			mock.module(${JSON.stringify(helperPath("configure_pr_watch.js"))}, () => ({
				configurePrWatch: record("prWatch"),
			}));
			mock.module(${JSON.stringify(helperPath("configure_worktree_cleanup.js"))}, () => ({
				syncWorktreeCleanup: record("worktreeCleanup"),
			}));
			mock.module(${JSON.stringify(helperPath("configure_codex.js"))}, () => ({
				configureCodex: record("codex"),
			}));
			mock.module(${JSON.stringify(helperPath("configure_skills.js"))}, () => ({
				configureSkills: record("skills", true),
			}));
			mock.module(${JSON.stringify(helperPath("configure_t3_code_server.js"))}, () => ({
				configureT3CodeServer: record("serverT3Code", true),
			}));
			const { runDebianServerSetup } = await import(${JSON.stringify(modulePath)});
			await runDebianServerSetup();
			console.log("DEFAULT_CALLS=" + JSON.stringify(calls));
		`,
		"DEFAULT_CALLS",
	);
}

const deployModeFeatures = deployModeFeaturesFromCli();
const defaultCallsByPath = new Map();

function missingDefaultPaths({ flag, feature }) {
	return [...defaultCallsByPath]
		.filter(([pathName]) => !DELIBERATE_OMISSIONS[pathName].has(flag))
		.filter(([, calls]) => !calls.has(feature))
		.map(([pathName]) => pathName);
}

function defaultSetupOverrides({
	isOmarchy,
	promptDeviceTypeImpl,
	configureUserAppsImpl = async () => {},
}) {
	return {
		prepareArchPackageManagerImpl: async () => true,
		ensureRustToolchainImpl: async () => {},
		ensureAurHelperImpl: async () => "paru",
		installDevToolsImpl: async () => {},
		commandExistsImpl: async (command) => {
			expect(command).toBe("omarchy");
			return isOmarchy;
		},
		installSystemPackagesImpl: async () => {},
		installFlatpakAppsImpl: async () => {},
		promptDeviceTypeImpl,
		configureUserAppsImpl,
		configureBraveManagedPoliciesImpl: async () => true,
		configureHyprmoncfgImpl: async () => {},
		configureOmarchyWorkspacesImpl: async () => {},
		configureOmarchyPluginsImpl: async () => {},
		configureOmarchyBarImpl: async () => {},
		configureOmazedImpl: async () => {},
	};
}

function userAppDoubles(overrides = {}) {
	return {
		configureGitImpl: async () => {},
		configureBrowserIntegrationImpl: async () => {},
		configureAudioImpl: async () => {},
		configureBashImpl: () => {},
		configureFastfetchImpl: async () => {},
		configureKittyImpl: async () => {},
		runCommandImpl: async () => true,
		enableServicesImpl: async () => {},
		configureClaudeImpl: async () => {},
		installGhStackImpl: async () => {},
		configureClaudeStayAwakeImpl: async () => {},
		configureClaudeRemoteControlImpl: async () => {},
		configurePrWatchImpl: async () => {},
		syncWorktreeCleanupImpl: async () => {},
		configureCodexImpl: async () => {},
		configureSkillsImpl: async () => true,
		...overrides,
	};
}

describe("default-run reachability", () => {
	beforeAll(() => {
		defaultCallsByPath.set("arch", new Set(runArchDefaultPath()));
		defaultCallsByPath.set("debian-server", new Set(runDebianDefaultPath()));
	});

	for (const deployFeature of deployModeFeatures) {
		it(`invokes ${deployFeature.flag} on every applicable default path`, () => {
			expect(missingDefaultPaths(deployFeature)).toEqual([]);
		});
	}

	for (const isOmarchy of [true, false]) {
		it(`invokes the device-type helper when Omarchy is ${isOmarchy}`, async () => {
			const home = makeHome();
			const configPath = path.join(home, ".haoshoku.json");
			let deviceTypeCalls = 0;
			let interactivePromptCalls = 0;

			await runCachyOSSetup(
				defaultSetupOverrides({
					isOmarchy,
					promptDeviceTypeImpl: async () => {
						deviceTypeCalls += 1;
						return promptDeviceType({
							configPath,
							isTTY: true,
							promptFn: async () => {
								interactivePromptCalls += 1;
								return { device: "laptop" };
							},
						});
					},
				}),
			);

			expect(deviceTypeCalls).toBe(1);
			expect(interactivePromptCalls).toBe(1);
			expect(JSON.parse(fs.readFileSync(configPath, "utf8")).deviceType).toBe(
				"laptop",
			);
		});
	}

	it("keeps Claude stay-awake unconditional when optional offers are declined", async () => {
		const offers = [];
		let stayAwakeCalls = 0;

		await configureUserApps(
			userAppDoubles({
				promptUserImpl: async (message, initial) => {
					offers.push({ message, initial });
					return false;
				},
				configureClaudeStayAwakeImpl: async () => {
					stayAwakeCalls += 1;
				},
			}),
		);

		expect(offers.map(({ message }) => message)).not.toContain(
			"Enable Claude stay-awake service?",
		);
		expect(stayAwakeCalls).toBe(1);
	});

	it("keeps PR watch unconditional when optional offers are declined", async () => {
		const offers = [];
		let prWatchCalls = 0;

		await configureUserApps(
			userAppDoubles({
				promptUserImpl: async (message, initial) => {
					offers.push({ message, initial });
					return false;
				},
				configurePrWatchImpl: async () => {
					prWatchCalls += 1;
				},
			}),
		);

		expect(offers.map(({ message }) => message)).not.toContain(
			"Enable PR watch helper?",
		);
		expect(prWatchCalls).toBe(1);
	});

	it("offers disclosed opt-in worktree cleanup and invokes its helper when accepted", async () => {
		const offers = [];
		let cleanupCalls = 0;
		const cleanupOffer =
			"Enable automatic git worktree cleanup? This enables a persistent weekly timer that runs cleanup-worktrees.sh --apply and deletes eligible worktrees.";

		await configureUserApps(
			userAppDoubles({
				promptUserImpl: async (message, initial) => {
					offers.push({ message, initial });
					return message === cleanupOffer;
				},
				syncWorktreeCleanupImpl: async () => {
					cleanupCalls += 1;
				},
			}),
		);

		expect(offers).toContainEqual({
			message: cleanupOffer,
			initial: false,
		});
		expect(cleanupCalls).toBe(1);
	});

	it("continues app setup when accepted worktree cleanup throws", async () => {
		const events = [];
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);

		try {
			await configureUserApps(
				userAppDoubles({
					promptUserImpl: async (message) =>
						message.startsWith("Enable automatic git worktree cleanup?"),
					syncWorktreeCleanupImpl: async () => {
						throw new Error("timer deployment failed");
					},
					configureCodexImpl: async () => events.push("codex"),
					configureSkillsImpl: async () => events.push("skills"),
				}),
			);
		} finally {
			log.warning = originalWarning;
		}

		expect(events).toEqual(["codex", "skills"]);
		expect(warnings.join("\n")).toContain("timer deployment failed");
		expect(warnings.join("\n")).toContain("continuing");
	});

	it("completes unattended setup with explicit defaults and no persisted fallback", async () => {
		const home = makeHome();
		const configPath = path.join(home, ".haoshoku.json");
		const events = [];
		const warnings = [];
		let interactivePromptCalls = 0;
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);

		const nonInteractivePrompt = (message, initial) =>
			promptUser(message, initial, {
				isTTY: false,
				promptFn: async () => {
					interactivePromptCalls += 1;
					throw new Error("interactive prompt must not run");
				},
			});
		const record = (name, result) => async () => {
			events.push(name);
			return result;
		};

		try {
			await expect(
				runCachyOSSetup(
					defaultSetupOverrides({
						isOmarchy: false,
						promptDeviceTypeImpl: () =>
							promptDeviceType({
								configPath,
								isTTY: false,
								promptFn: async () => {
									interactivePromptCalls += 1;
									throw new Error("device prompt must not run");
								},
							}),
						configureUserAppsImpl: () =>
							configureUserApps(
								userAppDoubles({
									promptUserImpl: nonInteractivePrompt,
									configureGitImpl: record("git"),
									installGhStackImpl: record("gh-stack"),
									configureClaudeStayAwakeImpl: record("stay-awake"),
									configureClaudeRemoteControlImpl: record("remote-control"),
									configurePrWatchImpl: record("pr-watch"),
									syncWorktreeCleanupImpl: record("worktree-cleanup"),
								}),
							),
					}),
				),
			).resolves.toBe(true);
		} finally {
			log.warning = originalWarning;
		}

		expect(interactivePromptCalls).toBe(0);
		expect(fs.existsSync(configPath)).toBe(false);
		expect(events).toEqual(["gh-stack", "stay-awake", "pr-watch"]);
		expect(warnings.join("\n")).toContain(
			"returning deviceType pc without saving it",
		);
		expect(warnings.join("\n")).toContain(
			"full setup routing reads persisted config independently",
		);
		expect(warnings.join("\n")).toContain(
			'Interactive confirmation unavailable; declining "Configure git?".',
		);
		expect(warnings.join("\n")).not.toContain("gh-stack");
		expect(warnings.join("\n")).not.toContain(
			"Enable Claude stay-awake service?",
		);
		expect(warnings.join("\n")).not.toContain("Enable PR watch helper?");
		expect(warnings.join("\n")).toContain(
			'Interactive confirmation unavailable; declining "Enable automatic git worktree cleanup? This enables a persistent weekly timer that runs cleanup-worktrees.sh --apply and deletes eligible worktrees.".',
		);
	});
});
