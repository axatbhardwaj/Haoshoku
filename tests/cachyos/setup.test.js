import { describe, expect, it } from "bun:test";
import { log } from "../../src/common/utils.js";
import { prepareArchPackageManager, runCachyOSSetup } from "../../src/os_scripts/cachyos.js";

describe("Arch package-manager preflight", () => {
	it("stops before package setup when sudo authentication fails", async () => {
		const events = [];
		const unreachable = async () => {
			throw new Error("setup continued without an authenticated sudo session");
		};
		const result = await runCachyOSSetup({
			configureFleetSshImpl: async () => true,
			configureTailscaleT3Impl: async () => true,
			readDeviceTypeImpl: () => "pc",
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
			configureVoxtypeOsdImpl: async () => {},
			configureKdeConnectCommandsImpl: unreachable,
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
			configureFleetSshImpl: async () => true,
			configureTailscaleT3Impl: async () => true,
			readDeviceTypeImpl: () => "pc",
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
			configureVoxtypeOsdImpl: async () => {},
			configureKdeConnectCommandsImpl: unreachable,
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

	it("stops the sudo keepalive when setup throws", async () => {
		const events = [];
		const unreachable = async () => {
			throw new Error("setup continued after injected failure");
		};
		const setup = runCachyOSSetup({
			configureFleetSshImpl: async () => true,
			configureTailscaleT3Impl: async () => true,
			readDeviceTypeImpl: () => "pc",
			promptDeviceTypeImpl: async () => {},
			startSudoSessionImpl: async () => () => events.push("sudo-stop"),
			commandExistsImpl: async () => false,
			prepareArchPackageManagerImpl: async () => true,
			ensureRustToolchainImpl: async () => {
				throw new Error("injected setup failure");
			},
			ensureAurHelperImpl: unreachable,
			installDevToolsImpl: unreachable,
			installSystemPackagesImpl: unreachable,
			installFlatpakAppsImpl: unreachable,
			configureUserAppsImpl: unreachable,
			configureBraveManagedPoliciesImpl: unreachable,
			configureHyprmoncfgImpl: unreachable,
			configureOmarchyWorkspacesImpl: unreachable,
			configureOmarchyPluginsImpl: unreachable,
			configureVoxtypeOsdImpl: async () => {},
			configureKdeConnectCommandsImpl: unreachable,
			configureOmarchyBarImpl: unreachable,
			configureOmazedImpl: unreachable,
			configureOmarchyAppearanceImpl: unreachable,
		});

		await expect(setup).rejects.toThrow("injected setup failure");
		expect(events).toEqual(["sudo-stop"]);
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
			"sudo -n pacman -Syu --noconfirm",
			"sudo -n pacman -S --needed --noconfirm base-devel git",
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
			"sudo -n pacman -S --needed --noconfirm base-devel git",
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
		expect(commands).toEqual(["sudo -n pacman -Syu --noconfirm"]);
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
			configureFleetSshImpl: async () => true,
			configureTailscaleT3Impl: async () => true,
			readDeviceTypeImpl: () => "pc",
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
			configureVoxtypeOsdImpl: async () => {},
			configureKdeConnectCommandsImpl: unreachable,
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
			configureFleetSshImpl: async () => true,
			configureTailscaleT3Impl: async () => true,
			readDeviceTypeImpl: () => "pc",
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
			configureVoxtypeOsdImpl: async () => {},
			configureKdeConnectCommandsImpl: unreachable,
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
				configureFleetSshImpl: async () => true,
				configureTailscaleT3Impl: async () => true,
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
				readDeviceTypeImpl: () => "pc",
				promptDeviceTypeImpl: record("device-type"),
				configureUserAppsImpl: record("user-apps"),
				configureBraveManagedPoliciesImpl: async (options) => {
					expect(options).toEqual({ nonInteractiveSudo: true });
					events.push("brave-policies");
					return true;
				},
				configureHyprmoncfgImpl: record("hyprmoncfg"),
				configureOmarchyWorkspacesImpl: record("workspaces"),
				configureOmarchyPluginsImpl: record("plugins"),
				configureVoxtypeOsdImpl: async () => {},
				configureKdeConnectCommandsImpl: record("kde-connect-commands"),
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
				"kde-connect-commands",
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
			configureFleetSshImpl: async () => true,
			configureTailscaleT3Impl: async () => true,
			readDeviceTypeImpl: () => "pc",
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
			configureVoxtypeOsdImpl: async () => {},
			configureKdeConnectCommandsImpl: record("kde-connect-commands"),
			configureOmarchyBarImpl: record("bar"),
			configureOmazedImpl: record("omazed"),
			configureOmarchyAppearanceImpl: record("appearance"),
		});

		expect(events.indexOf("bar")).toBeGreaterThan(events.indexOf("plugins"));
		expect(events).toEqual([
			"plugins",
			"kde-connect-commands",
			"bar",
			"omazed",
			"appearance",
		]);
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
					configureFleetSshImpl: async () => true,
					configureTailscaleT3Impl: async () => true,
					startSudoSessionImpl: async () => () => {},
					prepareArchPackageManagerImpl: async () => true,
					ensureRustToolchainImpl: async () => {},
					ensureAurHelperImpl: async () => "paru",
					installDevToolsImpl: async () => {},
					commandExistsImpl: async () => true,
					installSystemPackagesImpl: async () => {},
					installFlatpakAppsImpl: async () => {},
					readDeviceTypeImpl: () => "pc",
					promptDeviceTypeImpl: async () => {},
					configureUserAppsImpl: async () => {},
					configureBraveManagedPoliciesImpl: async () => {
						events.push("brave-policies");
						throw new Error("policy write failed");
					},
					configureHyprmoncfgImpl: async () => events.push("hyprmoncfg"),
					configureOmarchyWorkspacesImpl: async () => events.push("workspaces"),
					configureOmarchyPluginsImpl: async () => events.push("plugins"),
					configureVoxtypeOsdImpl: async () => {},
					configureKdeConnectCommandsImpl: async () =>
						events.push("kde-connect-commands"),
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
				"kde-connect-commands",
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
					configureFleetSshImpl: async () => true,
					configureTailscaleT3Impl: async () => true,
					startSudoSessionImpl: async () => () => {},
					prepareArchPackageManagerImpl: async () => true,
					ensureRustToolchainImpl: async () => {},
					ensureAurHelperImpl: async () => "paru",
					installDevToolsImpl: async () => {},
					commandExistsImpl: async () => true,
					installSystemPackagesImpl: async () => {},
					installFlatpakAppsImpl: async () => {},
					readDeviceTypeImpl: () => "pc",
					promptDeviceTypeImpl: async () => {},
					configureUserAppsImpl: async () => {},
					configureBraveManagedPoliciesImpl: async () => true,
					configureHyprmoncfgImpl: step("hyprmoncfg"),
					configureOmarchyWorkspacesImpl: step("workspaces"),
					configureOmarchyPluginsImpl: step("plugins"),
					configureVoxtypeOsdImpl: async () => {},
					configureKdeConnectCommandsImpl: step("kde-connect-commands"),
					configureOmarchyBarImpl: step("bar"),
					configureOmazedImpl: step("omazed"),
					configureOmarchyAppearanceImpl: step("appearance"),
				});

				expect(result).toBe(true);
				expect(events).toEqual([
					"hyprmoncfg",
					"workspaces",
					"plugins",
					"kde-connect-commands",
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

describe("Arch T3 phone access integration", () => {
	it.each([
		["pc", false],
		["pc", true],
		["laptop", false],
		["laptop", true],
	])("runs after user apps on %s and continues on failure (throws=%s)", async (deviceType, throws) => {
		const events = [];
		const errors = [];
		const original = log.error;
		log.error = (message) => errors.push(message);
		try {
			const result = await runCachyOSSetup({
				readDeviceTypeImpl: () => deviceType,
				promptDeviceTypeImpl: async () => {},
				startSudoSessionImpl: async () => () => events.push("sudo-stop"),
				prepareArchPackageManagerImpl: async () => true,
				ensureRustToolchainImpl: async () => {},
				ensureAurHelperImpl: async () => "paru",
				installDevToolsImpl: async () => {},
				commandExistsImpl: async () => false,
				installSystemPackagesImpl: async () => events.push("packages"),
				installFlatpakAppsImpl: async () => {},
				configureUserAppsImpl: async () => events.push("user-apps"),
				configureBraveManagedPoliciesImpl: async () => {},
				configureHyprmoncfgImpl: async () => {},
				configureOmarchyWorkspacesImpl: async () => {},
				configureOmarchyPluginsImpl: async () => {},
				configureVoxtypeOsdImpl: async () => {},
				configureKdeConnectCommandsImpl: async () => {},
				configureOmarchyBarImpl: async () => {},
				configureOmazedImpl: async () => {},
				configureOmarchyAppearanceImpl: async () => {},
				configureFleetSshImpl: async () => true,
				configureTailscaleT3Impl: async () => {
					events.push("tailscale-t3");
					if (throws) throw new Error("unavailable");
					return false;
				},
			});
			expect(result).toBe(true);
			expect(events).toEqual([
				"packages",
				"user-apps",
				"tailscale-t3",
				"sudo-stop",
			]);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toContain("--tailscale-t3");
		} finally {
			log.error = original;
		}
	});
});
