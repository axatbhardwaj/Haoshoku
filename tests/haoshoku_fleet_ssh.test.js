import { afterEach, beforeEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const cli = path.join(root, "haoshoku.js");
let home;
beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-cli-"));
});
afterEach(() => fs.rmSync(home, { recursive: true }));
function run(
	args,
	{
		osType = "arch",
		hostname = "io",
		fails = false,
		fullSetup = false,
		status = {
			BackendState: "Running",
			MagicDNSSuffix: "tail140c22.ts.net",
			Peer: {},
		},
	} = {},
) {
	const script = `
		import { mock } from "bun:test";
		const os = await import("node:os");
		mock.module("node:os", () => ({ ...os, hostname: () => ${JSON.stringify(hostname)} }));
		const utilsPath = ${JSON.stringify(path.join(root, "src/common/utils.js"))};
		const utils = await import(utilsPath);
		mock.module(utilsPath, () => ({ ...utils,
			runCommandCapture: async (command) => {
				console.log("FLEET_PROBE:" + command);
				return { exitCode: ${fails} && (!${fullSetup} || command === "tailscale debug prefs") ? 1 : 0, stdout: JSON.stringify(command === "tailscale debug prefs" ? {RunSSH:true} : ${JSON.stringify(status)}) };
			},
			runCommand: async () => { throw new Error("unexpected mutation"); },
		}));
		const cliUtilsPath = ${JSON.stringify(path.join(root, "src/common/cli_utils.js"))};
		const cliUtils = await import(cliUtilsPath);
		mock.module(cliUtilsPath, () => ({ ...cliUtils, detectOS: () => ${JSON.stringify(osType)} }));
		const archPath = ${JSON.stringify(path.join(root, "src/os_scripts/cachyos.js"))};
		if (${fullSetup}) {
			const arch = await import(archPath);
			const setup = arch.runCachyOSSetup;
			mock.module(archPath, () => ({ ...arch, runCachyOSSetup: () => setup({
				readDeviceTypeImpl: () => "iobox", promptDeviceTypeImpl: async () => {},
				startSudoSessionImpl: async () => () => console.log("SUDO_STOPPED"),
				commandExistsImpl: async () => false, prepareArchPackageManagerImpl: async () => true,
				ensureRustToolchainImpl: async () => {}, ensureAurHelperImpl: async () => "paru",
				installDevToolsImpl: async () => {}, installSystemPackagesImpl: async () => {},
				configureUserAppsImpl: async () => {}, configureTailscaleT3Impl: async () => true,
			}) }));
		} else {
			mock.module(archPath, () => ({ runCachyOSSetup: async () => { throw new Error("unexpected full setup"); } }));
		}
		process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
		await import(${JSON.stringify(cli)});
	`;
	const child = Bun.spawnSync([process.execPath, "--eval", script], {
		env: {
			...process.env,
			HOME: home,
			XDG_STATE_HOME: path.join(home, "state"),
			BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(
				os.tmpdir(),
				"fleet-cli-transpiler-cache",
			),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: child.exitCode,
		output:
			new TextDecoder().decode(child.stdout) +
			new TextDecoder().decode(child.stderr),
	};
}

it("runs only fleet SSH from the standalone flag", () => {
	const result = run(["--fleet-ssh"]);
	expect(result.exitCode, result.output).toBe(0);
	expect(result.output).toContain("FLEET_PROBE:tailscale debug prefs");
	expect(fs.readFileSync(path.join(home, ".ssh/config"), "utf8")).toBe(
		"Include config.d/haoshoku-fleet\n",
	);
	expect(fs.existsSync(path.join(home, ".haoshoku.json"))).toBe(false);
});
it.each([
	["io", "debian-server"],
	["unknown", "arch"],
	["axat-vps", "debian-server"],
])("rejects standalone on %s / %s without SSH changes", (hostname, osType) => {
	const result = run(["--fleet-ssh"], { hostname, osType });
	expect(result.exitCode, result.output).toBe(1);
	expect(result.output).toContain("Arch fleet host");
	expect(result.output).not.toContain("FLEET_PROBE:");
	expect(fs.readdirSync(home)).toEqual([]);
});
it("rejects combined modes before running any fleet commands", () => {
	const result = run(["--fleet-ssh", "--claude"]);
	expect(result.exitCode, result.output).toBe(2);
	expect(result.output).toContain("mutually exclusive");
	expect(result.output).not.toContain("FLEET_PROBE:");
});
it("does not allow --os arch to bypass the Debian guard", () => {
	const result = run(["--fleet-ssh", "--os", "arch"], {
		osType: "debian-server",
	});
	expect(result.exitCode, result.output).toBe(1);
	expect(result.output).toContain("Arch fleet host");
	expect(result.output).not.toContain("FLEET_PROBE:");
});
it("exits non-zero and reports the named Tailscale SSH failure", () => {
	const result = run(["--fleet-ssh"], { fails: true });
	expect(result.exitCode, result.output).toBe(1);
	expect(result.output).toContain("Tailscale SSH failed");
	expect(fs.existsSync(path.join(home, ".ssh"))).toBe(false);
});

it("exits full iobox setup non-zero naming Tailscale SSH and stops sudo", () => {
	const result = run(["--os", "arch"], {
		hostname: "iobox",
		fails: true,
		fullSetup: true,
	});
	expect(result.exitCode, result.output).toBe(1);
	expect(result.output).toContain("Tailscale SSH failed");
	expect(result.output).toContain("SUDO_STOPPED");
	expect(result.output).not.toContain("Arch setup finished");
	expect(fs.existsSync(path.join(home, ".ssh"))).toBe(false);
});

it.each([
	{ BackendState: "Running", MagicDNSSuffix: "other.ts.net", Peer: {} },
	{ BackendState: "NeedsLogin", MagicDNSSuffix: "tail140c22.ts.net", Peer: {} },
])("refuses unverified fleet identity before even writing run logs (%#)", (status) => {
	const result = run(["--fleet-ssh"], { status });
	expect(result.exitCode, result.output).toBe(1);
	expect(result.output).toContain("tail140c22.ts.net");
	expect(result.output).not.toContain("FLEET_PROBE:tailscale debug prefs");
	expect(fs.readdirSync(home)).toEqual([]);
});
