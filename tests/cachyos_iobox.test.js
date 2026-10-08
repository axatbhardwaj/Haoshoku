import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	installArchPackageBatch,
	installSystemPackages,
	runCachyOSSetup,
} from "../src/os_scripts/cachyos.js";

describe("iobox full setup", () => {
	it.each([
		true,
		false,
	])("routes the persisted profile and skips desktop steps (Omarchy=%s)", async (isOmarchy) => {
		const calls = [];
		const record = (name, result) => async () => {
			calls.push(name);
			return result;
		};
		const result = await runCachyOSSetup({
			promptDeviceTypeImpl: record("device", "pc"),
			readDeviceTypeImpl: () => "iobox",
			startSudoSessionImpl: async () => record("sudo-stop"),
			commandExistsImpl: async () => isOmarchy,
			prepareArchPackageManagerImpl: record("prepare", true),
			ensureRustToolchainImpl: record("rust", true),
			ensureAurHelperImpl: record("aur", "paru"),
			installDevToolsImpl: record("dev-tools"),
			installSystemPackagesImpl: async (helper, omarchy, options) => {
				calls.push(["packages", helper, omarchy, options?.deviceType]);
			},
			installFlatpakAppsImpl: record("flatpaks"),
			configureUserAppsImpl: async (options) => {
				calls.push(["apps", options]);
			},
			configureTailscaleT3Impl: record("tailscale-t3", true),
			configureBraveManagedPoliciesImpl: record("brave-policies"),
			configureHyprmoncfgImpl: record("monitors"),
			configureOmarchyWorkspacesImpl: record("workspaces"),
			configureOmarchyPluginsImpl: record("plugins"),
			configureVoxtypeOsdImpl: record("voxtype"),
			configureKdeConnectCommandsImpl: record("kde-connect"),
			configureOmarchyBarImpl: record("bar"),
			configureOmazedImpl: record("omazed"),
			configureOmarchyAppearanceImpl: record("appearance"),
		});
		expect(result).toBe(true);
		expect(calls).toEqual([
			"device",
			"prepare",
			"rust",
			"aur",
			"dev-tools",
			["packages", "paru", isOmarchy, "iobox"],
			["apps", { isOmarchy, deviceType: "iobox" }],
			"tailscale-t3",
			...(isOmarchy ? ["omazed", "appearance"] : []),
			"sudo-stop",
		]);
	});
});

describe("iobox packages", () => {
	it("installs the agent package file without gaming and skips installed targets on rerun", async () => {
		const files = [];
		const commands = [];
		const prompts = [];
		const installed = new Set();
		let requested;
		const options = {
			deviceType: "iobox",
			readFileImpl: (file, encoding) => {
				files.push(path.basename(file));
				return fs.readFileSync(file, encoding);
			},
			installArchPackageBatchImpl: async (packages, batchOptions) => {
				requested = packages;
				const result = await installArchPackageBatch(packages, {
					...batchOptions,
					getInstalledPackagesImpl: async () => installed,
					packageInRepositoryImpl: async () => true,
					runCommandImpl: async (command) => {
						commands.push(command);
						return true;
					},
				});
				for (const pkg of result.installed) installed.add(pkg);
				return result;
			},
			runCommandImpl: async (command) => commands.push(command),
			promptUserImpl: async (message) => {
				prompts.push(message);
				return true;
			},
			installGamingPackagesImpl: async () => commands.push("gaming"),
			configureSplitLockSudoersImpl: async () => commands.push("split-lock"),
		};
		await installSystemPackages("paru", true, options);
		expect(files).toEqual(["paru_applist_iobox.txt"]);
		for (const pkg of [
			"t3code-nightly-bin",
			"tailscale",
			"github-cli",
			"git",
			"1password",
			"1password-cli",
			"bun-bin",
			"nvm",
		]) {
			expect(installed.has(pkg)).toBe(true);
		}
		for (const pkg of [
			"flatpak",
			"steam",
			"mpv",
			"mpv-uosc",
			"chromium",
			"brave-origin-bin",
			"kdeconnect",
		]) {
			expect(installed.has(pkg)).toBe(false);
		}
		expect(prompts).toEqual([]);
		expect(commands).toEqual([
			`sudo -n pacman -S --needed --noconfirm ${requested.join(" ")}`,
			"sudo -n pacman -S --needed --noconfirm ttf-jetbrains-mono-nerd",
		]);
		const firstRun = [...commands];
		await installSystemPackages("paru", true, options);
		expect(files).toEqual(["paru_applist_iobox.txt", "paru_applist_iobox.txt"]);
		expect(commands).toEqual([
			...firstRun,
			"sudo -n pacman -S --needed --noconfirm ttf-jetbrains-mono-nerd",
		]);
		expect(prompts).toEqual([]);
	});
});

it("exits the full iobox CLI non-zero naming linger when the service step fails", () => {
	const root = path.resolve(import.meta.dir, "..");
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "iobox-linger-cli-"));
	const cli = path.join(root, "haoshoku.js");
	const setup = path.join(root, "src/os_scripts/cachyos.js");
	const childScript = `
		import { mock } from "bun:test";
		import * as arch from ${JSON.stringify(setup)};
		const runSetup = arch.runCachyOSSetup;
		mock.module(${JSON.stringify(setup)}, () => ({
			...arch,
			runCachyOSSetup: () => runSetup({
				promptDeviceTypeImpl: async () => {},
				readDeviceTypeImpl: () => "iobox",
				startSudoSessionImpl: async () => () => console.log("SUDO_STOPPED"),
				commandExistsImpl: async () => false,
				prepareArchPackageManagerImpl: async () => true,
				ensureRustToolchainImpl: async () => {},
				ensureAurHelperImpl: async () => "paru",
				installDevToolsImpl: async () => {},
				installSystemPackagesImpl: async () => {},
				configureUserAppsImpl: async () => {},
				configureTailscaleT3Impl: async () => { throw new Error("linger failed: sudo denied"); },
			}),
		}));
		process.argv = [process.execPath, ${JSON.stringify(cli)}, "--os", "arch"];
		await import(${JSON.stringify(cli)});
	`;
	try {
		const child = Bun.spawnSync([process.execPath, "--eval", childScript], {
			env: {
				...process.env,
				HOME: home,
				XDG_STATE_HOME: path.join(home, "state"),
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const output =
			new TextDecoder().decode(child.stdout) +
			new TextDecoder().decode(child.stderr);
		expect(child.exitCode, output).toBe(1);
		expect(output).toContain("linger failed");
		expect(output).toContain("SUDO_STOPPED");
		expect(output).not.toContain("Arch setup finished");
	} finally {
		fs.rmSync(home, { recursive: true });
	}
});
