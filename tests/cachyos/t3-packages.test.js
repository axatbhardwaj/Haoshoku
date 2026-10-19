import { describe, expect, it } from "bun:test";
import { log } from "../../src/common/utils.js";
import { installArchPackageBatch, installSystemPackages, runCachyOSSetup } from "../../src/os_scripts/cachyos.js";

describe("stable T3 package transaction safety", () => {
	it.each([
		"nightly-package",
		"unmanaged-cli",
		"unmanaged-desktop",
	])("holds only T3 and installs unrelated packages for %s", async (origin) => {
		const commands = [];
		const queries = [];
		const warnings = [];
		const original = log.warning;
		log.warning = (message) => warnings.push(message);
		try {
			const result = await installArchPackageBatch(["chromium", "t3code-bin"], {
				aurHelper: "paru",
				getInstalledPackagesImpl: async () => new Set(origin === "nightly-package" ? ["t3code-nightly-bin"] : []),
				whichImpl: (name) => (origin === "unmanaged-cli" && name === "t3") || (origin === "unmanaged-desktop" && name === "t3code") ? "/custom/t3" : null,
				packageInRepositoryImpl: async (pkg) => { queries.push(pkg); return true; },
				runCommandImpl: async (command) => { commands.push(command); return true; },
			});
			expect(result.held).toEqual(["t3code-bin"]);
			expect(result.installed).toEqual(["chromium"]);
			expect(queries).toEqual(["chromium"]);
			expect(commands).toEqual(["sudo -n pacman -S --needed --noconfirm chromium"]);
			expect(warnings.join(" ")).toContain("T3 stable migration held");
		} finally { log.warning = original; }
	});
});


describe("bounded T3 package hold in full Arch setup", () => {
	it.each(["pc", "laptop", "iobox"])("continues unrelated work and keeps the existing %s T3 failure policy", async (deviceType) => {
		const events = [], warnings = [], errors = [];
		const originalWarning = log.warning, originalError = log.error;
		log.warning = (message) => warnings.push(message);
		log.error = (message) => errors.push(message);
		const noop = async () => {};
		try {
			const result = await runCachyOSSetup({
        syncWorktreeCleanupImpl: async () => {},
				readDeviceTypeImpl: () => deviceType,
				promptDeviceTypeImpl: noop,
				startSudoSessionImpl: async () => () => events.push("sudo-stop"),
				prepareArchPackageManagerImpl: async () => true,
				ensureRustToolchainImpl: noop,
				ensureAurHelperImpl: async () => "paru",
				installDevToolsImpl: noop,
				commandExistsImpl: async () => true,
				installSystemPackagesImpl: (aurHelper, isOmarchy, options) => installSystemPackages(aurHelper, isOmarchy, {
					...options,
					readFileImpl: () => "chromium\nt3code-bin\n",
					getInstalledPackagesImpl: async () => new Set(["ttf-jetbrains-mono-nerd", "t3code-nightly-bin"]),
					installArchPackageBatchImpl: (packages, batch) => installArchPackageBatch(packages, {
						...batch,
						getInstalledPackagesImpl: async () => new Set(["t3code-nightly-bin"]),
						whichImpl: () => null,
						packageInRepositoryImpl: async () => true,
						runCommandImpl: async (command) => { events.push(command); return true; },
					}),
					promptUserImpl: async () => false,
				}),
				installFlatpakAppsImpl: async () => events.push("flatpaks"),
				configureUserAppsImpl: async () => events.push("user-apps"),
				configureTailscaleT3Impl: async () => { events.push("tailscale-t3"); return false; },
				configureFleetSshImpl: async () => { events.push("fleet-ssh"); return true; },
				configureBraveManagedPoliciesImpl: noop,
				configureHyprmoncfgImpl: noop,
				configureOmarchyWorkspacesImpl: async () => events.push("workspaces"),
				configureOmarchyPluginsImpl: noop,
				configureVoxtypeOsdImpl: noop,
				configureKdeConnectCommandsImpl: noop,
				configureOmarchyBarImpl: noop,
				configureOmazedImpl: noop,
				configureOmarchyAppearanceImpl: noop,
			});
			expect(result).toBe(deviceType !== "iobox");
			expect(events).toEqual([
				"sudo -n pacman -S --needed --noconfirm chromium",
				...(deviceType === "iobox" ? [] : ["flatpaks"]),
				"user-apps", "tailscale-t3",
				...(deviceType === "iobox" ? [] : ["fleet-ssh", "workspaces"]),
				"sudo-stop",
			]);
			expect(warnings.join(" ")).toContain("T3 stable migration held");
			expect(errors.join(" ")).toContain("haoshoku --tailscale-t3");
		} finally { log.warning = originalWarning; log.error = originalError; }
	});
});

describe("explicit stable T3 AUR source", () => {
	it.each([
		"yay",
		"paru",
	])("keeps aur/t3code-bin through %s batch fallback and canonical status", async (aurHelper) => {
		const commands = [],
			repositoryQueries = [];
		const result = await installArchPackageBatch(
			["chromium", "t3code-bin", "aur-one"],
			{
				aurHelper,
				whichImpl: () => null,
				getInstalledPackagesImpl: async () => new Set(),
				packageInRepositoryImpl: async (pkg) => {
					repositoryQueries.push(pkg);
					return pkg !== "aur-one";
				},
				packageInAurImpl: async () => true,
				captureCommandImpl: async () => ({
					exitCode: 0,
					stdout: "t3code-bin 0.1.0-1",
				}),
				runCommandImpl: async (command) => {
					commands.push(command);
					return !command.includes("--batchinstall");
				},
			},
		);
		expect(repositoryQueries).toEqual(["chromium", "aur-one"]);
		expect(commands).toEqual([
			"sudo -n pacman -S --needed --noconfirm chromium",
			`${aurHelper} -S --needed --noconfirm --batchinstall aur/t3code-bin aur-one`,
			`${aurHelper} -S --needed --noconfirm aur/t3code-bin`,
			`${aurHelper} -S --needed --noconfirm aur-one`,
		]);
		expect(result.installed).toEqual(["chromium", "t3code-bin", "aur-one"]);
		expect(result.failed).toEqual([]);
	});

	it.each([
		null,
		"yay",
	])("does not fall back to a repository T3 when AUR is unavailable (%s)", async (aurHelper) => {
		const commands = [];
		const result = await installArchPackageBatch(["t3code-bin"], {
			aurHelper,
			whichImpl: () => null,
			getInstalledPackagesImpl: async () => new Set(),
			packageInRepositoryImpl: async () => true,
			packageInAurImpl: async () => false,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});
		expect(result.missing).toEqual(["t3code-bin"]);
		expect(commands).toEqual([]);
	});

	it.each([
		"0.0.45-1",
		"unknown",
		"0.1.0-nightly.1-1",
	])("holds installed unsuitable desktop %s with explicit operator remediation", async (version) => {
		const commands = [],
			warnings = [];
		const previous = log.warning;
		log.warning = (message) => warnings.push(message);
		try {
			const result = await installArchPackageBatch(["t3code-bin", "chromium"], {
				aurHelper: "yay",
				whichImpl: () => null,
				getInstalledPackagesImpl: async () => new Set(["t3code-bin"]),
				captureCommandImpl: async () => ({
					exitCode: 0,
					stdout: `t3code-bin ${version}`,
				}),
				packageInRepositoryImpl: async () => true,
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
			});
			expect(result.held).toEqual(["t3code-bin"]);
			expect(result.skipped).toEqual([]);
			expect(result.installed).toEqual(["chromium"]);
			expect(commands).toEqual([
				"sudo -n pacman -S --needed --noconfirm chromium",
			]);
			expect(warnings.join(" ")).toContain("yay -S aur/t3code-bin");
		} finally {
			log.warning = previous;
		}
	});

	it.each([
		"0.1.0-1",
		"0.2.0-1",
	])("preserves an already supported desktop %s without replacing it", async (version) => {
		const result = await installArchPackageBatch(["t3code-bin"], {
			aurHelper: "yay",
			whichImpl: () => null,
			getInstalledPackagesImpl: async () => new Set(["t3code-bin"]),
			captureCommandImpl: async () => ({
				exitCode: 0,
				stdout: `t3code-bin ${version}`,
			}),
			runCommandImpl: async () => {
				throw new Error("must not replace desktop");
			},
		});
		expect(result.skipped).toEqual(["t3code-bin"]);
		expect(result.held).toEqual([]);
	});

	it("does not announce success if a successful transaction leaves the desktop below floor", async () => {
		const result = await installArchPackageBatch(["t3code-bin"], {
			aurHelper: "yay",
			whichImpl: () => null,
			getInstalledPackagesImpl: async () => new Set(),
			packageInRepositoryImpl: async () => false,
			packageInAurImpl: async () => true,
			captureCommandImpl: async () => ({
				exitCode: 0,
				stdout: "t3code-bin 0.0.45-1",
			}),
			runCommandImpl: async () => true,
		});
		expect(result.installed).toEqual([]);
		expect(result.held).toEqual(["t3code-bin"]);
	});
});
