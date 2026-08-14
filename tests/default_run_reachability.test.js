import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { log, promptUser } from "../src/common/utils.js";
import {
	bootstrapClaudePolicy,
	installSuperpowers,
} from "../src/helpers/configure_claude.js";
import { promptDeviceType } from "../src/helpers/configure_hyprland.js";
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

function runGit(args, cwd) {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		stderr: "pipe",
		stdout: "pipe",
	});
	expect(result.exitCode).toBe(0);
}

function createPolicyRemote(root) {
	const remote = path.join(root, "policy.git");
	const seed = path.join(root, "policy-seed");
	runGit(["init", "--bare", "--initial-branch=main", remote], root);
	fs.mkdirSync(seed);
	runGit(["init", "--initial-branch=main"], seed);
	fs.writeFileSync(
		path.join(seed, "settings.json"),
		`${JSON.stringify({ enabledPlugins: { "policy@example": true } }, null, 2)}\n`,
	);
	runGit(["add", "settings.json"], seed);
	runGit(
		[
			"-c",
			"user.name=Haoshoku Tests",
			"-c",
			"user.email=haoshoku-tests@example.com",
			"commit",
			"-m",
			"seed policy",
		],
		seed,
	);
	runGit(["remote", "add", "origin", remote], seed);
	runGit(["push", "origin", "main"], seed);
	return remote;
}

function deployModeFeaturesFromCli() {
	const cliPath = path.resolve(import.meta.dir, "..", "haoshoku.js");
	const source = fs.readFileSync(cliPath, "utf8");
	const optionUsages = [
		...source.matchAll(/\.option\(\s*"(--[a-z0-9-]+(?:\s+[^" ]+)?)"\s*,/g),
	].map(([, usage]) => usage);
	// Update modes are not independent deploy capabilities on a default setup
	// path. This guard does not execute their update-specific branches, so exclude
	// them instead of aliasing them to --claude/--skills and claiming coverage.
	const excludedUpdateModes = new Set(["--claude-update", "--skills-update"]);

	return optionUsages
		.map((usage) => usage.split(/\s+/)[0])
		.filter(
			(flag) =>
				flag !== "--os" &&
				flag !== "--device-type" &&
				!excludedUpdateModes.has(flag) &&
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
					runCommandImpl: record("uosc", true),
					enableServicesImpl: record("services"),
					configureClaudeImpl: record("claude"),
					bootstrapClaudePolicyImpl: record("claudeBootstrap", true),
					installGhStackImpl: record("ghStack"),
					installSuperpowersImpl: record("superpowers"),
					configureClaudeStayAwakeImpl: record("claudeStayAwake"),
					configureClaudeRemoteControlImpl: record("claudeRemoteControl"),
					configurePrWatchImpl: record("prWatch"),
					syncWorktreeCleanupImpl: record("worktreeCleanup"),
					configureCodexImpl: record("codex"),
					configureAgentOsImpl: record("agentOs"),
				}),
				configureBraveManagedPoliciesImpl: record("braveManagedPolicies", true),
				configureOmarchyMonitorsImpl: record("monitors"),
				configureOmarchyWorkspacesImpl: record("workspaces"),
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
				bootstrapClaudePolicy: record("claudeBootstrap", true),
				installSuperpowers: record("superpowers"),
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
			mock.module(${JSON.stringify(helperPath("configure_agent_os.js"))}, () => ({
				configureAgentOs: record("agentOs"),
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

function runSharedCliDefault(targetOs) {
	const cliPath = path.resolve(import.meta.dir, "..", "haoshoku.js");
	const cliUtilsPath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"common",
		"cli_utils.js",
	);
	const archPath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"os_scripts",
		"cachyos.js",
	);
	const debianPath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"os_scripts",
		"debian_server.js",
	);
	const skillsPath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"helpers",
		"skill_manager.js",
	);
	return runIsolated(
		`
			import { mock } from "bun:test";
			const calls = [];
			mock.module("prompts", () => ({ default: async () => ({ value: true }) }));
			mock.module(${JSON.stringify(cliUtilsPath)}, () => ({
				detectOS: () => ${JSON.stringify(targetOs)},
				findActiveModeFlags: () => [],
			}));
			mock.module(${JSON.stringify(archPath)}, () => ({
				runCachyOSSetup: async () => true,
			}));
			mock.module(${JSON.stringify(debianPath)}, () => ({
				runDebianServerSetup: async () => true,
			}));
			mock.module(${JSON.stringify(skillsPath)}, () => ({
				CACHE_DIR: "/haoshoku-test-cache",
				printAvailableSkills() {},
				syncSkills() {
					calls.push("skills");
					return { status: "ok" };
				},
			}));
			Object.defineProperty(process.stdin, "isTTY", { value: true });
			process.argv = [process.execPath, ${JSON.stringify(cliPath)}];
			await import(${JSON.stringify(cliPath)});
			const deadline = Date.now() + 5000;
			while (!calls.includes("skills")) {
				if (Date.now() >= deadline) {
					throw new Error("Timed out waiting for the default-path skill sync");
				}
				await Bun.sleep(20);
			}
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
		configureOmarchyMonitorsImpl: async () => {},
		configureOmarchyWorkspacesImpl: async () => {},
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
		runCommandImpl: async () => true,
		enableServicesImpl: async () => {},
		configureClaudeImpl: async () => {},
		installGhStackImpl: async () => {},
		bootstrapClaudePolicyImpl: async () => true,
		configureClaudeStayAwakeImpl: async () => {},
		configureClaudeRemoteControlImpl: async () => {},
		configurePrWatchImpl: async () => {},
		syncWorktreeCleanupImpl: async () => {},
		installSuperpowersImpl: async () => {},
		configureCodexImpl: async () => {},
		configureAgentOsImpl: async () => {},
		...overrides,
	};
}

describe("default-run reachability", () => {
	beforeAll(() => {
		defaultCallsByPath.set(
			"arch",
			new Set([...runArchDefaultPath(), ...runSharedCliDefault("arch")]),
		);
		defaultCallsByPath.set(
			"debian-server",
			new Set([
				...runDebianDefaultPath(),
				...runSharedCliDefault("debian-server"),
			]),
		);
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

	it("offers Superpowers and invokes its helper when accepted", async () => {
		const offers = [];
		let installCalls = 0;

		await configureUserApps(
			userAppDoubles({
				promptUserImpl: async (message, initial) => {
					offers.push({ message, initial });
					return message === "Enable Superpowers plugin for Claude Code?";
				},
				installSuperpowersImpl: async () => {
					installCalls += 1;
				},
			}),
		);

		expect(offers).toContainEqual({
			message: "Enable Superpowers plugin for Claude Code?",
			initial: false,
		});
		expect(installCalls).toBe(1);
	});

	it("continues app setup when accepted Superpowers installation throws", async () => {
		const events = [];
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);

		try {
			await configureUserApps(
				userAppDoubles({
					promptUserImpl: async (message) =>
						message === "Enable Superpowers plugin for Claude Code?",
					installSuperpowersImpl: async () => {
						throw new Error("settings write failed");
					},
					configureCodexImpl: async () => events.push("codex"),
					configureAgentOsImpl: async () => events.push("agent-os"),
				}),
			);
		} finally {
			log.warning = originalWarning;
		}

		expect(events).toEqual(["codex", "agent-os"]);
		expect(warnings.join("\n")).toContain("settings write failed");
		expect(warnings.join("\n")).toContain("continuing");
	});

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

	it("enables Superpowers on a fresh machine when its offer is accepted", async () => {
		const home = makeHome();
		const settingsPath = path.join(home, ".claude", "settings.json");
		const offer = "Enable Superpowers plugin for Claude Code?";
		const prompts = [];

		await configureUserApps(
			userAppDoubles({
				promptUserImpl: async (message) => {
					prompts.push(message);
					return message === offer;
				},
				installSuperpowersImpl: () => installSuperpowers(settingsPath),
			}),
		);

		expect(prompts).toContain(offer);
		const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		expect(settings.enabledPlugins["superpowers@claude-plugins-official"]).toBe(
			true,
		);
	});

	it("keeps Superpowers enabled after the complete Claude policy setup sequence", async () => {
		const home = makeHome();
		const settingsPath = path.join(home, ".claude", "settings.json");
		const configPath = path.join(home, ".haoshoku.json");
		const remote = createPolicyRemote(home);
		fs.writeFileSync(
			configPath,
			`${JSON.stringify({ claudeBootstrapUrl: remote }, null, 2)}\n`,
		);

		await configureUserApps(
			userAppDoubles({
				promptUserImpl: async (message) =>
					message === "Enable Superpowers plugin for Claude Code?" ||
					message === "Bootstrap private Claude policy repository?",
				installSuperpowersImpl: () => installSuperpowers(settingsPath),
				bootstrapClaudePolicyImpl: (options) =>
					bootstrapClaudePolicy({
						...options,
						claudeHome: home,
						configPath,
					}),
			}),
		);

		const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
		expect(settings.enabledPlugins).toEqual({
			"policy@example": true,
			"superpowers@claude-plugins-official": true,
		});
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
					configureAgentOsImpl: async () => events.push("agent-os"),
				}),
			);
		} finally {
			log.warning = originalWarning;
		}

		expect(events).toEqual(["codex", "agent-os"]);
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
									bootstrapClaudePolicyImpl: record("bootstrap", true),
									configureClaudeStayAwakeImpl: record("stay-awake"),
									configureClaudeRemoteControlImpl: record("remote-control"),
									configurePrWatchImpl: record("pr-watch"),
									syncWorktreeCleanupImpl: record("worktree-cleanup"),
									installSuperpowersImpl: record("superpowers"),
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
		expect(warnings.join("\n")).toContain(
			'Interactive confirmation unavailable; declining "Bootstrap private Claude policy repository?".',
		);
		expect(warnings.join("\n")).not.toContain("gh-stack");
		expect(warnings.join("\n")).not.toContain(
			"Enable Claude stay-awake service?",
		);
		expect(warnings.join("\n")).not.toContain("Enable PR watch helper?");
		expect(warnings.join("\n")).toContain(
			'Interactive confirmation unavailable; declining "Enable automatic git worktree cleanup? This enables a persistent weekly timer that runs cleanup-worktrees.sh --apply and deletes eligible worktrees.".',
		);
		expect(warnings.join("\n")).toContain(
			'Interactive confirmation unavailable; declining "Enable Superpowers plugin for Claude Code?".',
		);
	});
});
