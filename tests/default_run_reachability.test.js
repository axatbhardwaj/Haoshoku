import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promptDeviceType } from "../src/common/device_type.js";
import { log, promptUser } from "../src/common/utils.js";
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
		// The default setup persists dark through agent-skills sync. This flag is
		// only an explicit preference override, not another deploy capability.
		"--explainer-theme",
		// The workspaces deploy ensures the gaming autostart defaults. These
		// flags only create or override that preference outside the default
		// setup path.
		"--gaming",
		"--gaming-steam-autostart",
		"--gaming-omakade-autostart",
		// The split-lock sudoers rule is installed only after the opt-in gaming
		// prompt, never on an unattended default run.
		"--gaming-split-lock",
		"--axstack-check",
		"--skills",
		"--skills-update",
		"--3-4-migrate",
		// Discord theming follows the Omarchy appearance checkout only when
		// explicitly requested; normal setup leaves Vesktop/Vencord untouched.
		"--discord-theme",
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
// Arch/Omarchy omits the retired background integrations and headless services.
// Debian Server is headless: audio, MIME/browser scripts, and Omarchy display
// configuration are desktop-only and intentionally remain on the Arch path.
const DELIBERATE_OMISSIONS = {
	arch: new Map([
		[
			"--claude-remote-control",
			"Persistent Claude sessions are no longer offered by Arch/Omarchy setup.",
		],
		[
			"--claude-stay-awake",
			"Arch/Omarchy setup no longer installs a Claude sleep inhibitor.",
		],
		[
			"--worktree-cleanup",
			"Arch/Omarchy setup no longer enables automatic worktree deletion.",
		],
		[
			"--server-t3-code",
			"Arch installs the desktop package instead of the Debian headless service.",
		],
		[
			"--server-hermes-relay",
			"Hermes relay transport is enabled only on an explicitly configured Debian server.",
		],
	]),
	"debian-server": new Map([
		["--tailscale-t3", "Arch provisioning; Debian uses --server-t3-code with preconfigured Tailscale."],
		["--audio", "WirePlumber routing depends on desktop device profiles."],
		["--mimeapps", "Default-app routing is a desktop-session concern."],
		["--scripts", "The managed user scripts are desktop app launchers."],
		["--workspaces", "Hyprland workspaces do not exist on a headless server."],
		["--monitors", "Hyprland monitor routing requires a desktop display."],
		[
			"--kde-connect-commands",
			"KDE Connect display commands require an Omarchy desktop session.",
		],
		[
			"--omarchy-plugins",
			"Omarchy plugins require the Omarchy desktop environment.",
		],
		[
			"--omarchy-bar",
			"The Omarchy bar requires the Omarchy desktop environment.",
		],
		[
			"--omarchy-appearance",
			"Omarchy appearance requires the Omarchy desktop environment.",
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

function runArchDefaultPath({ isOmarchy = true, gitAnswer = true } = {}) {
	const modulePath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"os_scripts",
		"cachyos.js",
	);
	return runIsolated(
		`
			import { mock } from "bun:test";
			const calls = [];
			const prompts = [];
			const record = (feature, result) => async () => {
				calls.push(feature);
				return result;
			};
			mock.module(${JSON.stringify(path.resolve(import.meta.dir, "..", "src/helpers/configure_git.js"))}, () => ({
				configureGit: record("git"),
			}));
			const utilsPath = ${JSON.stringify(path.resolve(import.meta.dir, "..", "src/common/utils.js"))};
			const utils = await import(utilsPath);
			mock.module(utilsPath, () => ({
				...utils,
				promptUser: async (message, initial) => {
					prompts.push({ message, initial });
					return ${gitAnswer};
				},
			}));
			const {
				configureBrowserIntegration,
				configureUserApps,
				runCachyOSSetup,
			} = await import(${JSON.stringify(modulePath)});
			await runCachyOSSetup({
				configureTailscaleT3Impl: record("tailscaleT3", true),
				promptDeviceTypeImpl: record("deviceType"),
				startSudoSessionImpl: record("sudoSession", () => calls.push("sudoStop")),
				prepareArchPackageManagerImpl: record("packageManager", true),
				ensureRustToolchainImpl: record("rust"),
				ensureAurHelperImpl: record("aur", "paru"),
				installDevToolsImpl: record("devTools"),
				commandExistsImpl: async (command) => command === "omarchy" && ${isOmarchy},
				installSystemPackagesImpl: record("systemPackages"),
				installFlatpakAppsImpl: record("flatpaks"),
				configureUserAppsImpl: (options) => configureUserApps({
					...options,
					promptUserImpl: undefined,
					configureGitImpl: undefined,
					configureBrowserIntegrationImpl: () => configureBrowserIntegration({
						configureChromiumProfilesImpl: record("chromiumProfiles"),
						configureMimeappsImpl: record("mimeapps"),
						installUserScriptsImpl: record("scripts"),
					}),
					configureAudioImpl: record("audio"),
					configureBashImpl: record("bash"),
					configureFastfetchImpl: record("fastfetch"),
					configureGhosttyImpl: record("ghostty"),
					runCommandImpl: record("uosc", true),
					enableServicesImpl: record("services"),
					configureClaudeImpl: record("claude"),
					installGhStackImpl: record("ghStack"),
					configurePrWatchImpl: record("prWatch"),
					configureCodexImpl: record("codex"),
					syncAgentsConfigImpl: record("agents", true),
					configureAxstackImpl: record("axstack", { ok: true }),
					configureSkillsImpl: record("skills", true),
					syncAgentSkillsImpl: record("agentSkills", true),
				}),
				configureBraveManagedPoliciesImpl: record("braveManagedPolicies", true),
				configureHyprmoncfgImpl: record("monitors"),
				configureOmarchyWorkspacesImpl: record("workspaces"),
				configureOmarchyPluginsImpl: record("omarchyPlugins"),
				configureVoxtypeOsdImpl: async () => {},
				configureKdeConnectCommandsImpl: record("kdeConnectCommands"),
				configureOmarchyBarImpl: record("omarchyBar"),
				configureOmazedImpl: record("omazed"),
				configureOmarchyAppearanceImpl: record("omarchyAppearance"),
			});
			console.log("DEFAULT_CALLS=" + JSON.stringify({ calls, prompts }));
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
			mock.module(${JSON.stringify(helperPath("configure_agents.js"))}, () => ({
				syncAgentsConfig: record("agents", true),
			}));
			mock.module(${JSON.stringify(helperPath("configure_axstack.js"))}, () => ({
				configureAxstack: record("axstack", { ok: true }),
			}));
			mock.module(${JSON.stringify(helperPath("configure_skills.js"))}, () => ({
				configureSkills: record("skills", true),
			}));
			mock.module(${JSON.stringify(helperPath("configure_agent_skills.js"))}, () => ({
				syncAgentSkills: record("agentSkills", true),
			}));
			mock.module(${JSON.stringify(helperPath("configure_hermes_relay.js"))}, () => ({
				configureHermesRelay: record("serverHermesRelay", true),
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
let archDefaultResult;

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
		configureTailscaleT3Impl: async () => true,
		startSudoSessionImpl: async () => () => {},
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
		configureVoxtypeOsdImpl: async () => {},
		configureKdeConnectCommandsImpl: async () => {},
		configureOmarchyBarImpl: async () => {},
		configureOmazedImpl: async () => {},
		configureOmarchyAppearanceImpl: async () => {},
	};
}

function userAppDoubles(overrides = {}) {
	return {
		promptUserImpl: async () => false,
		configureGitImpl: async () => {},
		configureBrowserIntegrationImpl: async () => {},
		configureAudioImpl: async () => {},
		configureBashImpl: () => {},
		configureFastfetchImpl: async () => {},
		configureGhosttyImpl: async () => {},
		runCommandImpl: async () => true,
		enableServicesImpl: async () => {},
		configureClaudeImpl: async () => {},
		installGhStackImpl: async () => {},
		configurePrWatchImpl: async () => {},
		configureCodexImpl: async () => {},
		syncAgentsConfigImpl: async () => {},
		configureAxstackImpl: async () => ({ ok: true }),
		configureSkillsImpl: async () => true,
		syncAgentSkillsImpl: async () => true,
		...overrides,
	};
}

describe("default-run reachability", () => {
	beforeAll(() => {
		archDefaultResult = runArchDefaultPath();
		defaultCallsByPath.set("arch", new Set(archDefaultResult.calls));
		defaultCallsByPath.set("debian-server", new Set(runDebianDefaultPath()));
	});

	it("leaves git configuration to Omarchy without a prompt or helper call", () => {
		expect({
			gitCalls: archDefaultResult.calls.filter((call) => call === "git").length,
			prompts: archDefaultResult.prompts,
		}).toEqual({ gitCalls: 0, prompts: [] });
		expect(defaultCallsByPath.get("arch").has("prWatch")).toBe(true);
	});

	it.each([true, false])("offers git configuration on non-Omarchy Arch (answer=%s)", (gitAnswer) => {
		const result = runArchDefaultPath({ isOmarchy: false, gitAnswer });
		expect({
			gitCalls: result.calls.filter((call) => call === "git").length,
			prompts: result.prompts,
		}).toEqual({
			gitCalls: gitAnswer ? 1 : 0,
			prompts: [{ message: "Configure git?", initial: true }],
		});
		expect(result.calls).toContain("prWatch");
	});

	it.each([
		"arch",
		"debian-server",
	])("omits retired Paseo profile sync on the %s default path", (pathName) => {
		expect(defaultCallsByPath.get(pathName).has("paseoProfiles")).toBe(false);
	});

	for (const deployFeature of deployModeFeatures) {
		it(`invokes ${deployFeature.flag} on every applicable default path`, () => {
			expect(missingDefaultPaths(deployFeature)).toEqual([]);
		});
	}

	for (const isOmarchy of [true, false]) {
		it(`automatically detects device type when Omarchy is ${isOmarchy}`, async () => {
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
							detectDeviceTypeImpl: () => "laptop",
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
			expect(interactivePromptCalls).toBe(0);
			expect(JSON.parse(fs.readFileSync(configPath, "utf8")).deviceType).toBe(
				"laptop",
			);
		});
	}

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
								detectDeviceTypeImpl: () => null,
								isTTY: false,
								promptFn: async () => {
									interactivePromptCalls += 1;
									throw new Error("device prompt must not run");
								},
							}),
						configureUserAppsImpl: ({ isOmarchy }) =>
							configureUserApps(
								userAppDoubles({
									isOmarchy,
									promptUserImpl: nonInteractivePrompt,
									configureGitImpl: record("git"),
									installGhStackImpl: record("gh-stack"),
									configurePrWatchImpl: record("pr-watch"),
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
		expect(events).toEqual(["gh-stack", "pr-watch"]);
		expect(warnings.join("\n")).toContain(
			"returning deviceType pc without saving it",
		);
		expect(warnings.join("\n")).toContain(
			"full setup routing reads persisted config independently",
		);
		expect(warnings.join("\n")).not.toContain("gh-stack");
		expect(warnings.join("\n")).not.toContain("Enable PR watch helper?");
	});
});
