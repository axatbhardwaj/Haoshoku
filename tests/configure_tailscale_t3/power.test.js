import { describe, expect, it } from "bun:test";

import { log } from "../../src/common/utils.js";
import { runCachyOSSetup } from "../../src/os_scripts/cachyos.js";
import { configureTailscaleT3 } from "../../src/helpers/configure_tailscale_t3.js";

import {
	lidDropIn,
	lidContent,
	fixture,
	sleepTargets,
	maskProbe,
} from "./fixture.js";
const lingerProbe = "loginctl show-user 'test' -p Linger";
const lingerEnable = "sudo -n loginctl enable-linger 'test'";

describe("Arch T3 linger", () => {
	it.each([
		"pc",
		"laptop",
		"iobox",
		"iosatellite",
	])("enables and verifies linger on %s, then leaves it unchanged", async (deviceType) => {
		const f = fixture();
		f.options.deviceType = deviceType;
		f.files.set(lidDropIn, lidContent);
		f.overrides.set(lingerProbe, { stdout: "Linger=no", exitCode: 0 });
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command, options) => {
			const result = await run(command, options);
			if (command === lingerEnable)
				f.overrides.set(lingerProbe, { stdout: "Linger=yes", exitCode: 0 });
			return result;
		};
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([lingerEnable]);
		expect(f.events.filter((command) => command === lingerProbe)).toHaveLength(
			2,
		);
		f.mutations.length = 0;
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([]);
	});

	it("uses SUDO_USER and never enables linger for root", async () => {
		const f = fixture();
		f.options.user = "root";
		f.options.env = { SUDO_USER: "desktop" };
		f.overrides.set("loginctl show-user 'desktop' -p Linger", {
			stdout: "Linger=no",
			exitCode: 0,
		});
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command, options) => {
			const result = await run(command, options);
			if (command === "sudo -n loginctl enable-linger 'desktop'")
				f.overrides.set("loginctl show-user 'desktop' -p Linger", {
					stdout: "Linger=yes",
					exitCode: 0,
				});
			return result;
		};
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toContain("sudo -n loginctl enable-linger 'desktop'");
		expect(f.events).not.toContain("loginctl show-user 'root' -p Linger");
	});

	it.each([
		"denied",
		"throws",
		"not-enabled",
	])("reports linger %s without claiming readiness", async (mode) => {
		const f = fixture();
		f.overrides.set(lingerProbe, {
			stdout: "Linger=no",
			exitCode: 0,
		});
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command, options) => {
			if (command === lingerEnable) {
				if (mode === "throws") throw new Error("sudo denied");
				return mode !== "denied";
			}
			return run(command, options);
		};
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.warnings.join(" ")).toContain("linger");
		expect(f.messages.join(" ")).not.toContain("are ready");
	});
});

describe("Arch linger without an existing logind user", () => {
	it.each([
		{ stdout: "", exitCode: 1 },
		{ stdout: "unexpected", exitCode: 0 },
		{ stdout: "", exitCode: 0 },
	])("enables then verifies after initial state %j", async (initial) => {
		const f = fixture();
		f.options.deviceType = "iobox";
		f.overrides.set(lingerProbe, initial);
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command, options) => {
			const result = await run(command, options);
			if (command === lingerEnable)
				f.overrides.set(lingerProbe, { stdout: "Linger=yes", exitCode: 0 });
			return result;
		};
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([lingerEnable]);
		expect(f.events.filter((command) => command === lingerProbe)).toHaveLength(
			2,
		);
		f.mutations.length = 0;
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([]);
	});
});

describe("Arch root linger policy", () => {
	it("names the missing non-root user as a linger failure on iobox", async () => {
		const f = fixture();
		f.options.user = "root";
		f.options.deviceType = "iobox";
		await expect(configureTailscaleT3(f.options)).rejects.toThrow(
			/^linger failed:/,
		);
		expect(f.events).toContain("t3 --version");
		expect(f.events.some((command) => command.startsWith("loginctl "))).toBe(
			false,
		);
		expect(f.messages.join(" ")).not.toContain("are ready");
	});

	it.each([
		"pc",
		"laptop",
	])("warns about root linger and still installs the %s T3 service", async (deviceType) => {
		const f = fixture({ fresh: true, loggedOut: false });
		f.options.user = "root";
		f.options.deviceType = deviceType;
		f.files.set(lidDropIn, lidContent);
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.warnings.join(" ")).toContain(
			"linger requires a non-root setup user",
		);
		expect(f.mutations).toContain(
			"t3 service install --base-dir '/home/test/.t3'",
		);
		expect(f.events.some((command) => command.includes("loginctl"))).toBe(
			false,
		);
		expect(f.messages.join(" ")).toContain("are ready");
	});
});

describe("iobox sleep targets", () => {
	it.each([
		"iobox",
		"iosatellite",
	])("%s masks only unmasked system targets, verifies each, and is a no-op on rerun", async (deviceType) => {
		const f = fixture();
		f.options.deviceType = deviceType;
		f.files.set(lidDropIn, lidContent);
		for (const target of sleepTargets.slice(1)) f.masks.set(target, "static");
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([
			"sudo -n systemctl mask suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target",
		]);
		for (const target of sleepTargets.slice(1)) {
			expect(f.masks.get(target)).toBe("masked");
			expect(
				f.events.filter((command) => command === maskProbe(target)),
			).toHaveLength(2);
		}
		f.mutations.length = 0;
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([]);
	});

	it.each([
		"pc",
		"laptop",
	])("leaves %s sleep targets alone", async (deviceType) => {
		const f = fixture();
		f.options.deviceType = deviceType;
		f.files.set(lidDropIn, lidContent);
		for (const target of sleepTargets) f.masks.set(target, "static");
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([]);
		expect(
			f.events.some((command) => command.startsWith("systemctl show ")),
		).toBe(false);
	});

	it.each([
		"denied",
		"throws",
		"unverified",
		"probe-failed",
	])("reports a sleep mask %s without claiming readiness", async (mode) => {
		const f = fixture();
		f.options.deviceType = "iobox";
		for (const target of sleepTargets) f.masks.set(target, "static");
		if (mode === "probe-failed")
			f.overrides.set(maskProbe("sleep.target"), { stdout: "", exitCode: 1 });
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command, options) => {
			if (command.startsWith("sudo -n systemctl mask ")) {
				if (mode === "throws") throw new Error("denied");
				return mode !== "denied";
			}
			return run(command, options);
		};
		await expect(configureTailscaleT3(f.options)).rejects.toThrow("sleep mask");
		expect(f.messages.join(" ")).not.toContain("are ready");
	});
});

describe("Arch full setup always-on failures", () => {
	it.each(
		["Tailscale", "T3 service", "linger", "sleep mask", "Tailscale/T3"].flatMap(
			(step) => [
				[step, "iobox"],
				[step, "iosatellite"],
			],
		),
	)("fails setup naming %s on %s and stops later steps", async (step, deviceType) => {
		const f = fixture();
		const errors = [];
		const events = [];
		if (step === "Tailscale")
			f.overrides.set("tailscale status --json", {
				stdout: '{"BackendState":"Stopped"}',
				exitCode: 0,
			});
		if (step === "T3 service")
			f.overrides.set("systemctl --user is-active --quiet t3code.service", {
				stdout: "",
				exitCode: 1,
			});
		if (step === "linger") {
			f.overrides.set(lingerProbe, { stdout: "Linger=no", exitCode: 0 });
			f.options.runCommandImpl = async () => false;
		}
		if (step === "sleep mask")
			f.overrides.set(maskProbe("sleep.target"), { stdout: "", exitCode: 1 });
		const original = log.error;
		log.error = (message) => errors.push(message);
		try {
			const result = await runCachyOSSetup({
				promptDeviceTypeImpl: async () => {},
				readDeviceTypeImpl: () => deviceType,
				startSudoSessionImpl: async () => () => events.push("sudo-stop"),
				commandExistsImpl: async () => true,
				prepareArchPackageManagerImpl: async () => true,
				ensureRustToolchainImpl: async () => {},
				ensureAurHelperImpl: async () => "paru",
				installDevToolsImpl: async () => {},
				installSystemPackagesImpl: async () => {},
				configureUserAppsImpl: async () => {},
				installFlatpakAppsImpl: async () => {},
				configureBraveManagedPoliciesImpl: async () => {},
				configureHyprmoncfgImpl: async () => {},
				configureOmarchyWorkspacesImpl: async () => {},
				configureOmarchyPluginsImpl: async () => {},
				configureVoxtypeOsdImpl: async () => {},
				configureKdeConnectCommandsImpl: async () => {},
				configureOmarchyBarImpl: async () => {},
				configureFleetSshImpl: async () => true,
				configureTailscaleT3Impl: (options) =>
					step === "Tailscale/T3"
						? false
						: configureTailscaleT3({ ...f.options, ...options }),
				configureOmazedImpl: async () => events.push("omazed"),
				configureOmarchyAppearanceImpl: async () => events.push("appearance"),
			});
			expect(result).toBe(false);
			expect(errors.join(" ")).toContain(step);
			expect(events).toEqual(["sudo-stop"]);
			expect(f.messages.join(" ")).not.toContain("are ready");
		} finally {
			log.error = original;
		}
	});
});
