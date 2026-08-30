import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { log } from "../src/common/utils.js";
import {
	configureUserApps,
	ensureRustToolchain,
	getInstalledPackages,
	installArchPackageBatch,
	installGamingPackages,
	installSystemPackages,
	normalizeArchPackageNames,
	prepareArchPackageManager,
	resolveAurHelper,
	runCachyOSSetup,
	selectArchInstallCommand,
} from "../src/os_scripts/cachyos.js";

describe("user app configuration", () => {
	it("runs the Kitty configurator and never reactivates Warp", async () => {
		const events = [];
		const record = (name) => async () => events.push(name);

		await configureUserApps({
			promptUserImpl: async () => false,
			configureGitImpl: record("git"),
			configureBrowserIntegrationImpl: record("browser"),
			configureAudioImpl: record("audio"),
			configureBashImpl: record("bash"),
			configureFastfetchImpl: record("fastfetch"),
			configureKittyImpl: record("kitty"),
			configureWarpImpl: async () => {
				throw new Error("Warp configuration must remain dormant");
			},
			runCommandImpl: record("uosc"),
			enableServicesImpl: record("services"),
			configureClaudeImpl: record("claude"),
			installGhStackImpl: record("gh-stack"),
			configureClaudeStayAwakeImpl: record("stay-awake"),
			configureClaudeRemoteControlImpl: record("remote-control"),
			configurePrWatchImpl: record("pr-watch"),
			syncWorktreeCleanupImpl: record("worktree-cleanup"),
			configureCodexImpl: record("codex"),
			configureSkillsImpl: record("skills"),
		});

		expect(events).toEqual([
			"browser",
			"audio",
			"bash",
			"fastfetch",
			"kitty",
			"uosc",
			"services",
			"claude",
			"gh-stack",
			"stay-awake",
			"pr-watch",
			"codex",
			"skills",
		]);
	});
});

describe("Rust toolchain preparation", () => {
	it("preserves Rust when rustc and cargo are already available", async () => {
		const commands = [];
		const result = await ensureRustToolchain({
			commandExistsImpl: async (command) =>
				command === "rustc" || command === "cargo",
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			withSpinnerImpl: async (_label, operation) => operation(),
		});

		expect(result).toBe(true);
		expect(commands).toEqual([]);
	});

	for (const { availableCommand, missingCommand } of [
		{ availableCommand: "rustc", missingCommand: "cargo" },
		{ availableCommand: "cargo", missingCommand: "rustc" },
	]) {
		it(`installs Rust when ${missingCommand} is missing`, async () => {
			const commands = [];
			const result = await ensureRustToolchain({
				commandExistsImpl: async (command) => command === availableCommand,
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
				withSpinnerImpl: async (_label, operation) => operation(),
			});

			expect(result).toBe(true);
			expect(commands).toEqual([
				"curl https://sh.rustup.rs -sSf | sh -s -- -y",
			]);
		});
	}

	it("reports failure when rustup fails", async () => {
		const result = await ensureRustToolchain({
			commandExistsImpl: async () => false,
			runCommandImpl: async () => false,
			withSpinnerImpl: async (_label, operation) => operation(),
		});

		expect(result).toBe(false);
	});
});

describe("Arch package routing", () => {
	it("prefers yay and falls back to paru", async () => {
		expect(
			await resolveAurHelper(async (command) =>
				["yay", "paru"].includes(command),
			),
		).toBe("yay");
		expect(await resolveAurHelper(async (command) => command === "paru")).toBe(
			"paru",
		);
		expect(await resolveAurHelper(async () => false)).toBeNull();
	});

	it("uses pacman for repository packages and the selected helper for AUR", () => {
		expect(selectArchInstallCommand("fish", true, "yay")).toBe(
			"sudo pacman -S --needed --noconfirm fish",
		);
		expect(selectArchInstallCommand("protonup-rs-bin", false, "yay")).toBe(
			"yay -S --needed --noconfirm protonup-rs-bin",
		);
		expect(selectArchInstallCommand("missing", false, null)).toBeNull();
	});
});

describe("Arch package-list normalization", () => {
	it("trims, deduplicates, and preserves first-seen order", () => {
		expect(
			normalizeArchPackageNames([
				" chromium ",
				"visual-studio-code-bin",
				"chromium",
				"bun-bin",
			]),
		).toEqual({
			valid: ["chromium", "visual-studio-code-bin", "bun-bin"],
			invalid: [],
		});
	});

	it("rejects empty and shell-active package names", () => {
		expect(
			normalizeArchPackageNames([
				"",
				"   ",
				"good_pkg+git@source",
				"bad package",
				"bad;touch-/tmp/pwned",
				"$(bad)",
			]),
		).toEqual({
			valid: ["good_pkg+git@source"],
			invalid: ["", "bad package", "bad;touch-/tmp/pwned", "$(bad)"],
		});
	});

	it("rejects option-like and hidden-path-like package names", () => {
		expect(
			normalizeArchPackageNames(["--help", ".hidden", "valid-package"]),
		).toEqual({
			valid: ["valid-package"],
			invalid: ["--help", ".hidden"],
		});
	});
});

describe("installed package snapshots", () => {
	it("discards partial output when pacman exits nonzero", async () => {
		const result = await getInstalledPackages(() => ({
			stdout: new Response("partial-package\n").body,
			exited: Promise.resolve(1),
		}));

		expect(result).toEqual(new Set());
	});
});

describe("batched Arch package installation", () => {
	it("does not query or execute option-like package names", async () => {
		const metadataQueries = [];
		const commands = [];
		const result = await installArchPackageBatch(
			["--help", ".hidden", "repo-one"],
			{
				aurHelper: "yay",
				getInstalledPackagesImpl: async () => new Set(),
				packageInRepositoryImpl: async (pkg) => {
					metadataQueries.push(pkg);
					return true;
				},
				packageInAurImpl: async () => true,
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
			},
		);

		expect(metadataQueries).toEqual(["repo-one"]);
		expect(commands).toEqual(["sudo pacman -S --needed --noconfirm repo-one"]);
		expect(result.invalid).toEqual(["--help", ".hidden"]);
	});

	it("skips installed targets and uses one batch per available source", async () => {
		const commands = [];
		const result = await installArchPackageBatch(
			["already", "repo-one", "aur-one", "repo-two", "aur-two"],
			{
				aurHelper: "yay",
				getInstalledPackagesImpl: async () => new Set(["already"]),
				packageInRepositoryImpl: async (pkg) => pkg.startsWith("repo-"),
				packageInAurImpl: async () => true,
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
			},
		);

		expect(commands).toEqual([
			"sudo pacman -S --needed --noconfirm repo-one repo-two",
			"yay -S --needed --noconfirm --batchinstall aur-one aur-two",
		]);
		expect(result).toEqual({
			installed: ["repo-one", "aur-one", "repo-two", "aur-two"],
			failed: [],
			missing: [],
			invalid: [],
			skipped: ["already"],
		});
	});

	it("filters missing AUR and malformed targets before install commands", async () => {
		const metadataQueries = [];
		const commands = [];
		const result = await installArchPackageBatch(
			["repo-one", "aur-good", "aur-missing", "bad;name"],
			{
				aurHelper: "paru",
				getInstalledPackagesImpl: async () => new Set(),
				packageInRepositoryImpl: async (pkg) => pkg === "repo-one",
				packageInAurImpl: async (pkg) => {
					metadataQueries.push(pkg);
					return pkg === "aur-good";
				},
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
			},
		);

		expect(metadataQueries).toEqual(["aur-good", "aur-missing"]);
		expect(commands).toEqual([
			"sudo pacman -S --needed --noconfirm repo-one",
			"paru -S --needed --noconfirm --batchinstall aur-good",
		]);
		expect(result.missing).toEqual(["aur-missing"]);
		expect(result.invalid).toEqual(["bad;name"]);
	});

	it("retries only still-absent repository targets after batch failure", async () => {
		const snapshots = [new Set(), new Set(["repo-one"])];
		const commands = [];
		const result = await installArchPackageBatch(["repo-one", "repo-two"], {
			aurHelper: "yay",
			getInstalledPackagesImpl: async () => snapshots.shift() ?? new Set(),
			packageInRepositoryImpl: async () => true,
			packageInAurImpl: async () => false,
			runCommandImpl: async (command) => {
				commands.push(command);
				return command === "sudo pacman -S --needed --noconfirm repo-two";
			},
		});

		expect(commands).toEqual([
			"sudo pacman -S --needed --noconfirm repo-one repo-two",
			"sudo pacman -S --needed --noconfirm repo-two",
		]);
		expect(result.installed).toEqual(["repo-one", "repo-two"]);
		expect(result.failed).toEqual([]);
	});

	it("retries only still-absent AUR targets after batch failure", async () => {
		const snapshots = [new Set(), new Set(["aur-one"])];
		const commands = [];
		const result = await installArchPackageBatch(["aur-one", "aur-two"], {
			aurHelper: "yay",
			getInstalledPackagesImpl: async () => snapshots.shift() ?? new Set(),
			packageInRepositoryImpl: async () => false,
			packageInAurImpl: async () => true,
			runCommandImpl: async (command) => {
				commands.push(command);
				return command === "yay -S --needed --noconfirm aur-two";
			},
		});

		expect(commands).toEqual([
			"yay -S --needed --noconfirm --batchinstall aur-one aur-two",
			"yay -S --needed --noconfirm aur-two",
		]);
		expect(result).toEqual({
			installed: ["aur-one", "aur-two"],
			failed: [],
			missing: [],
			invalid: [],
			skipped: [],
		});
	});

	it("runs the AUR batch when repository fallback fails", async () => {
		const commands = [];
		const result = await installArchPackageBatch(["repo-one", "aur-one"], {
			aurHelper: "paru",
			getInstalledPackagesImpl: async () => new Set(),
			packageInRepositoryImpl: async (pkg) => pkg === "repo-one",
			packageInAurImpl: async () => true,
			runCommandImpl: async (command) => {
				commands.push(command);
				return (
					command === "paru -S --needed --noconfirm --batchinstall aur-one"
				);
			},
		});

		expect(commands).toContain(
			"paru -S --needed --noconfirm --batchinstall aur-one",
		);
		expect(result).toEqual({
			installed: ["aur-one"],
			failed: ["repo-one"],
			missing: [],
			invalid: [],
			skipped: [],
		});
	});

	it("marks non-repository targets missing without an AUR helper", async () => {
		const commands = [];
		let aurMetadataQueries = 0;
		const result = await installArchPackageBatch(["repo-one", "aur-one"], {
			aurHelper: null,
			getInstalledPackagesImpl: async () => new Set(),
			packageInRepositoryImpl: async (pkg) => pkg === "repo-one",
			packageInAurImpl: async () => {
				aurMetadataQueries += 1;
				return true;
			},
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(commands).toEqual(["sudo pacman -S --needed --noconfirm repo-one"]);
		expect(aurMetadataQueries).toBe(0);
		expect(result).toEqual({
			installed: ["repo-one"],
			failed: [],
			missing: ["aur-one"],
			invalid: [],
			skipped: [],
		});
	});

	it("does not query metadata or install packages for empty input", async () => {
		let repositoryMetadataQueries = 0;
		let aurMetadataQueries = 0;
		const commands = [];
		const result = await installArchPackageBatch([], {
			aurHelper: "yay",
			getInstalledPackagesImpl: async () => new Set(),
			packageInRepositoryImpl: async () => {
				repositoryMetadataQueries += 1;
				return false;
			},
			packageInAurImpl: async () => {
				aurMetadataQueries += 1;
				return false;
			},
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(repositoryMetadataQueries).toBe(0);
		expect(aurMetadataQueries).toBe(0);
		expect(commands).toEqual([]);
		expect(result).toEqual({
			installed: [],
			failed: [],
			missing: [],
			invalid: [],
			skipped: [],
		});
	});

	it("preserves input order across every terminal result category", async () => {
		const snapshots = [
			new Set(["skipped"]),
			new Set(["repo-present"]),
			new Set(["aur-present"]),
		];
		const result = await installArchPackageBatch(
			[
				"skipped",
				"repo-present",
				"repo-success",
				"repo-fail",
				"aur-present",
				"aur-success",
				"aur-fail",
				"missing",
				"bad;name",
			],
			{
				aurHelper: "yay",
				getInstalledPackagesImpl: async () => snapshots.shift() ?? new Set(),
				packageInRepositoryImpl: async (pkg) => pkg.startsWith("repo-"),
				packageInAurImpl: async (pkg) => pkg !== "missing",
				runCommandImpl: async (command) =>
					command.endsWith("repo-success") || command.endsWith("aur-success"),
			},
		);

		expect(result).toEqual({
			installed: ["repo-present", "repo-success", "aur-present", "aur-success"],
			failed: ["repo-fail", "aur-fail"],
			missing: ["missing"],
			invalid: ["bad;name"],
			skipped: ["skipped"],
		});
	});
});

describe("system package installation orchestration", () => {
	it("passes filtered package-file entries to the batch installer before Nerd Fonts", async () => {
		const commands = [];
		const batchRequests = [];
		const events = [];

		await installSystemPackages("yay", false, {
			refreshSudoImpl: async () => true,
			readFileImpl: () =>
				"# Applications\n chromium \n\nvisual-studio-code-bin\n",
			installArchPackageBatchImpl: async (packages, options) => {
				events.push("batch");
				batchRequests.push({ packages, options });
				return {
					installed: ["chromium", "visual-studio-code-bin"],
					failed: [],
					missing: [],
					invalid: [],
					skipped: [],
				};
			},
			runCommandImpl: async (command) => {
				events.push("font");
				commands.push(command);
				return true;
			},
			promptUserImpl: async () => false,
		});

		expect(batchRequests).toEqual([
			{
				packages: ["chromium", "visual-studio-code-bin"],
				options: { aurHelper: "yay" },
			},
		]);
		expect(commands).toEqual([
			"sudo pacman -S --needed --noconfirm ttf-jetbrains-mono-nerd",
		]);
		expect(events).toEqual(["batch", "font"]);
	});

	it("does not batch packages when sudo validation fails", async () => {
		let batchCalls = 0;

		await installSystemPackages("paru", false, {
			refreshSudoImpl: async () => false,
			readFileImpl: () => "chromium\n",
			installArchPackageBatchImpl: async () => {
				batchCalls += 1;
				return {
					installed: [],
					failed: [],
					missing: [],
					invalid: [],
					skipped: [],
				};
			},
			runCommandImpl: async () => true,
			promptUserImpl: async () => false,
		});

		expect(batchCalls).toBe(0);
	});
});

describe("portable gaming setup", () => {
	it("installs the portable package set and Omarchy GPU support", async () => {
		const commands = [];
		const result = await installGamingPackages({
			aurHelper: "yay",
			isOmarchy: true,
			commandExistsImpl: async (name) =>
				name === "omarchy-install-gaming-gpu-lib32",
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(commands).toEqual([
			"sudo pacman -S --needed --noconfirm steam gamemode lib32-gamemode gamescope mangohud lib32-mangohud",
			"yay -S --needed --noconfirm protonup-rs-bin",
			"omarchy-install-gaming-gpu-lib32",
		]);
		expect(result).toBe(true);
	});

	it("does not guess GPU packages outside Omarchy", async () => {
		const commands = [];
		await installGamingPackages({
			aurHelper: "paru",
			isOmarchy: false,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});
		expect(commands).toHaveLength(2);
	});
});

describe("Arch package-manager preflight", () => {
	it("stops before package setup when sudo authentication fails", async () => {
		const events = [];
		const unreachable = async () => {
			throw new Error("setup continued without an authenticated sudo session");
		};
		const result = await runCachyOSSetup({
			promptDeviceTypeImpl: async () => events.push("device-type"),
			startSudoSessionImpl: async () => {
				events.push("sudo-start");
				return null;
			},
			prepareArchPackageManagerImpl: async () => {
				events.push("unexpected-prepare");
				return false;
			},
			ensureRustToolchainImpl: unreachable,
			ensureAurHelperImpl: unreachable,
			installDevToolsImpl: unreachable,
			commandExistsImpl: async () => {
				events.push("unexpected-detect-omarchy");
				return true;
			},
			installSystemPackagesImpl: unreachable,
			installFlatpakAppsImpl: unreachable,
			configureUserAppsImpl: unreachable,
			configureBraveManagedPoliciesImpl: unreachable,
			configureHyprmoncfgImpl: unreachable,
			configureOmarchyWorkspacesImpl: unreachable,
			configureOmarchyPluginsImpl: unreachable,
			configureOmarchyBarImpl: unreachable,
			configureOmazedImpl: unreachable,
			configureOmarchyAppearanceImpl: unreachable,
		});

		expect(result).toBe(false);
		expect(events).toEqual(["device-type", "sudo-start"]);
	});

	it("stops the sudo keepalive when package-manager setup aborts", async () => {
		const events = [];
		const unreachable = async () => {
			throw new Error(
				"setup continued after package-manager preparation failed",
			);
		};
		const result = await runCachyOSSetup({
			promptDeviceTypeImpl: async () => events.push("device-type"),
			startSudoSessionImpl: async () => {
				events.push("sudo-start");
				return () => events.push("sudo-stop");
			},
			commandExistsImpl: async () => {
				events.push("detect-omarchy");
				return true;
			},
			prepareArchPackageManagerImpl: async () => {
				events.push("prepare");
				return false;
			},
			ensureRustToolchainImpl: unreachable,
			ensureAurHelperImpl: unreachable,
			installDevToolsImpl: unreachable,
			installSystemPackagesImpl: unreachable,
			installFlatpakAppsImpl: unreachable,
			configureUserAppsImpl: unreachable,
			configureBraveManagedPoliciesImpl: unreachable,
			configureHyprmoncfgImpl: unreachable,
			configureOmarchyWorkspacesImpl: unreachable,
			configureOmarchyPluginsImpl: unreachable,
			configureOmarchyBarImpl: unreachable,
			configureOmazedImpl: unreachable,
			configureOmarchyAppearanceImpl: unreachable,
		});

		expect(result).toBe(false);
		expect(events).toEqual([
			"device-type",
			"sudo-start",
			"detect-omarchy",
			"prepare",
			"sudo-stop",
		]);
	});

	it("uses pacman outside Omarchy before installing build dependencies", async () => {
		const commands = [];
		const result = await prepareArchPackageManager({
			isOmarchy: false,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"sudo pacman -Syu --noconfirm",
			"sudo pacman -S --needed --noconfirm base-devel git",
		]);
	});

	it("uses the Omarchy updater before installing build dependencies", async () => {
		const commands = [];
		const result = await prepareArchPackageManager({
			isOmarchy: true,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"omarchy update -y",
			"sudo pacman -S --needed --noconfirm base-devel git",
		]);
	});

	it("does not install dependencies when the full upgrade fails", async () => {
		const commands = [];
		const result = await prepareArchPackageManager({
			runCommandImpl: async (command) => {
				commands.push(command);
				return false;
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual(["sudo pacman -Syu --noconfirm"]);
	});

	it("reports failure when essential dependencies cannot be installed", async () => {
		let attempt = 0;
		const result = await prepareArchPackageManager({
			runCommandImpl: async () => {
				attempt += 1;
				return attempt === 1;
			},
		});

		expect(result).toBe(false);
	});

	it("stops the full setup when package-manager preparation fails", async () => {
		const events = [];
		const unreachable = async () => {
			throw new Error(
				"setup continued after package-manager preparation failed",
			);
		};
		const result = await runCachyOSSetup({
			promptDeviceTypeImpl: async () => events.push("device-type"),
			startSudoSessionImpl: async () => () => {},
			commandExistsImpl: async () => {
				events.push("detect-omarchy");
				return false;
			},
			prepareArchPackageManagerImpl: async () => {
				events.push("prepare");
				return false;
			},
			ensureRustToolchainImpl: unreachable,
			ensureAurHelperImpl: unreachable,
			installDevToolsImpl: unreachable,
			installSystemPackagesImpl: unreachable,
			installFlatpakAppsImpl: unreachable,
			configureUserAppsImpl: unreachable,
			configureBraveManagedPoliciesImpl: unreachable,
			configureHyprmoncfgImpl: unreachable,
			configureOmarchyWorkspacesImpl: unreachable,
			configureOmarchyPluginsImpl: unreachable,
			configureOmarchyBarImpl: unreachable,
			configureOmazedImpl: unreachable,
			configureOmarchyAppearanceImpl: unreachable,
		});

		expect(result).toBe(false);
		expect(events).toEqual(["device-type", "detect-omarchy", "prepare"]);
	});

	it("detects Omarchy before selecting the package-manager preflight", async () => {
		const events = [];
		const unreachable = async () => {
			throw new Error(
				"setup continued after package-manager preparation failed",
			);
		};
		const result = await runCachyOSSetup({
			promptDeviceTypeImpl: async () => events.push("device-type"),
			startSudoSessionImpl: async () => () => {},
			commandExistsImpl: async (command) => {
				expect(command).toBe("omarchy");
				events.push("detect-omarchy");
				return true;
			},
			prepareArchPackageManagerImpl: async ({ isOmarchy } = {}) => {
				events.push(`prepare-${isOmarchy}`);
				return false;
			},
			ensureRustToolchainImpl: unreachable,
			ensureAurHelperImpl: unreachable,
			installDevToolsImpl: unreachable,
			installSystemPackagesImpl: unreachable,
			installFlatpakAppsImpl: unreachable,
			configureUserAppsImpl: unreachable,
			configureBraveManagedPoliciesImpl: unreachable,
			configureHyprmoncfgImpl: unreachable,
			configureOmarchyWorkspacesImpl: unreachable,
			configureOmarchyPluginsImpl: unreachable,
			configureOmarchyBarImpl: unreachable,
			configureOmazedImpl: unreachable,
			configureOmarchyAppearanceImpl: unreachable,
		});

		expect(result).toBe(false);
		expect(events).toEqual(["device-type", "detect-omarchy", "prepare-true"]);
	});

	it("runs Brave policy provisioning only for Omarchy in the plain setup flow", async () => {
		async function runSetup(isOmarchy) {
			const events = [];
			const record = (event, result) => async () => {
				events.push(event);
				return result;
			};
			const result = await runCachyOSSetup({
				startSudoSessionImpl: async () => () => {},
				prepareArchPackageManagerImpl: record("prepare", true),
				ensureRustToolchainImpl: record("rust", true),
				ensureAurHelperImpl: record("aur", "paru"),
				installDevToolsImpl: record("dev-tools"),
				commandExistsImpl: async (command) => {
					expect(command).toBe("omarchy");
					return isOmarchy;
				},
				installSystemPackagesImpl: record("system-packages"),
				installFlatpakAppsImpl: record("flatpaks"),
				promptDeviceTypeImpl: record("device-type"),
				configureUserAppsImpl: record("user-apps"),
				configureBraveManagedPoliciesImpl: record("brave-policies", true),
				configureHyprmoncfgImpl: record("hyprmoncfg"),
				configureOmarchyWorkspacesImpl: record("workspaces"),
				configureOmarchyPluginsImpl: record("plugins"),
				configureOmarchyBarImpl: record("bar"),
				configureOmazedImpl: record("omazed"),
				configureOmarchyAppearanceImpl: record("appearance"),
			});
			return { events, result };
		}

		expect(await runSetup(true)).toEqual({
			result: true,
			events: [
				"device-type",
				"prepare",
				"rust",
				"aur",
				"dev-tools",
				"system-packages",
				"flatpaks",
				"user-apps",
				"brave-policies",
				"hyprmoncfg",
				"workspaces",
				"plugins",
				"bar",
				"omazed",
				"appearance",
			],
		});
		expect(await runSetup(false)).toEqual({
			result: true,
			events: [
				"device-type",
				"prepare",
				"rust",
				"aur",
				"dev-tools",
				"system-packages",
				"flatpaks",
				"user-apps",
			],
		});
	});

	it("configures the Omarchy bar strictly after its plugins", async () => {
		const events = [];
		const record = (name, result) => async () => {
			events.push(name);
			return result;
		};

		await runCachyOSSetup({
			promptDeviceTypeImpl: async () => {},
			startSudoSessionImpl: async () => () => {},
			prepareArchPackageManagerImpl: async () => true,
			ensureRustToolchainImpl: async () => {},
			ensureAurHelperImpl: async () => "paru",
			installDevToolsImpl: async () => {},
			commandExistsImpl: async () => true,
			installSystemPackagesImpl: async () => {},
			installFlatpakAppsImpl: async () => {},
			configureUserAppsImpl: async () => {},
			configureBraveManagedPoliciesImpl: async () => {},
			configureHyprmoncfgImpl: async () => {},
			configureOmarchyWorkspacesImpl: async () => {},
			configureOmarchyPluginsImpl: record("plugins"),
			configureOmarchyBarImpl: record("bar"),
			configureOmazedImpl: record("omazed"),
			configureOmarchyAppearanceImpl: record("appearance"),
		});

		expect(events.indexOf("bar")).toBeGreaterThan(events.indexOf("plugins"));
		expect(events).toEqual(["plugins", "bar", "omazed", "appearance"]);
	});

	it("continues Omarchy setup when Brave policy provisioning throws", async () => {
		const events = [];
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);

		try {
			let thrown;
			let result;
			try {
				result = await runCachyOSSetup({
					startSudoSessionImpl: async () => () => {},
					prepareArchPackageManagerImpl: async () => true,
					ensureRustToolchainImpl: async () => {},
					ensureAurHelperImpl: async () => "paru",
					installDevToolsImpl: async () => {},
					commandExistsImpl: async () => true,
					installSystemPackagesImpl: async () => {},
					installFlatpakAppsImpl: async () => {},
					promptDeviceTypeImpl: async () => {},
					configureUserAppsImpl: async () => {},
					configureBraveManagedPoliciesImpl: async () => {
						events.push("brave-policies");
						throw new Error("policy write failed");
					},
					configureHyprmoncfgImpl: async () => events.push("hyprmoncfg"),
					configureOmarchyWorkspacesImpl: async () => events.push("workspaces"),
					configureOmarchyPluginsImpl: async () => events.push("plugins"),
					configureOmarchyBarImpl: async () => events.push("bar"),
					configureOmazedImpl: async () => events.push("omazed"),
					configureOmarchyAppearanceImpl: async () => events.push("appearance"),
				});
			} catch (error) {
				thrown = error;
			}

			expect(events).toEqual([
				"brave-policies",
				"hyprmoncfg",
				"workspaces",
				"plugins",
				"bar",
				"omazed",
				"appearance",
			]);
			expect(thrown).toBeUndefined();
			expect(result).toBe(true);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("policy write failed");
			expect(warnings[0]).toContain("continuing");
		} finally {
			log.warning = originalWarning;
		}
	});

	for (const failingStep of ["hyprmoncfg", "workspaces", "plugins", "bar"]) {
		it(`warns and continues Omarchy setup when the ${failingStep} device variant is missing`, async () => {
			const events = [];
			const warnings = [];
			const originalWarning = log.warning;
			log.warning = (message) => warnings.push(message);

			try {
				const step = (name) => async () => {
					events.push(name);
					if (name === failingStep) {
						throw new Error(`missing ${name}-laptop.conf`);
					}
				};
				const result = await runCachyOSSetup({
					startSudoSessionImpl: async () => () => {},
					prepareArchPackageManagerImpl: async () => true,
					ensureRustToolchainImpl: async () => {},
					ensureAurHelperImpl: async () => "paru",
					installDevToolsImpl: async () => {},
					commandExistsImpl: async () => true,
					installSystemPackagesImpl: async () => {},
					installFlatpakAppsImpl: async () => {},
					promptDeviceTypeImpl: async () => {},
					configureUserAppsImpl: async () => {},
					configureBraveManagedPoliciesImpl: async () => true,
					configureHyprmoncfgImpl: step("hyprmoncfg"),
					configureOmarchyWorkspacesImpl: step("workspaces"),
					configureOmarchyPluginsImpl: step("plugins"),
					configureOmarchyBarImpl: step("bar"),
					configureOmazedImpl: step("omazed"),
					configureOmarchyAppearanceImpl: step("appearance"),
				});

				expect(result).toBe(true);
				expect(events).toEqual([
					"hyprmoncfg",
					"workspaces",
					"plugins",
					"bar",
					"omazed",
					"appearance",
				]);
				expect(warnings).toHaveLength(1);
				expect(warnings[0]).toContain(`missing ${failingStep}-laptop.conf`);
				expect(warnings[0]).toContain("continuing");
			} finally {
				log.warning = originalWarning;
			}
		});
	}
});

describe("Omarchy-owned defaults", () => {
	it("provisions both native desktop assistants", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);

		expect(packages).toContain("claude-desktop");
		expect(packages).toContain("openai-codex-desktop");
	});

	it("keeps KDE, Fish, and appearance packages out of the application list", () => {
		const packages = fs.readFileSync(
			path.resolve(import.meta.dir, "..", "common", "paru_applist.txt"),
			"utf8",
		);
		for (const removed of [
			"fish",
			"partitionmanager",
			"dolphin",
			"kvantum",
			"okular",
			"merkuro",
		]) {
			expect(packages.split(/\s+/)).not.toContain(removed);
		}
	});

	it("keeps Chromium installed and provisions Brave Origin", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);
		expect(packages).toContain("chromium");
		expect(packages).toContain("brave-origin-bin");
		for (const retired of [
			"brave-bin",
			"floorp-bin",
			"google-chrome",
			"thorium-browser-avx2-bin",
		]) {
			expect(packages).not.toContain(retired);
		}
	});

	it("keeps optional gaming packages behind the gaming prompt", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\s+/);
		expect(packages).not.toContain("protonup-rs-bin");
		expect(packages).not.toContain("steam-native-runtime");
	});

	it("does not manage Stremio and its retired Qt5 dependency chain", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);
		expect(packages).not.toContain("stremio");
	});
});
