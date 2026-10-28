import { describe, expect, it } from "bun:test";

import { configureTailscaleT3 } from "../../src/helpers/configure_tailscale_t3.js";

import {
	serve,
	fixture,
	listenerCommand,
	url,
	dropIn,
	pathDropIn,
	pathContent,
	loopbackDropIn,
	loopbackContent,
} from "./fixture.js";
describe("T3 exposure and service guards", () => {
	it("does not claim readiness when a newly installed service is inactive", async () => {
		const f = fixture({ fresh: true });
		f.overrides.set("systemctl --user is-active --quiet t3code.service", {
			stdout: "",
			exitCode: 1,
		});
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.events).not.toContain(url);
		expect(f.warnings.join(" ")).toContain("service");
	});

	it("does not report a public Funnel endpoint as tailnet-only access", async () => {
		const f = fixture();
		f.overrides.set("tailscale serve status --json", {
			stdout: JSON.stringify({
				...serve,
				AllowFunnel: { "laptop.tail123.ts.net:443": true },
			}),
			exitCode: 0,
		});
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.events).not.toContain(url);
		expect(f.warnings.join(" ")).toContain("tailnet");
	});
});

describe("existing T3 service reconciliation", () => {
	it("enables a disabled but running service and restarts it when the drop-in changed", async () => {
		const f = fixture();
		f.files.set(dropIn, "old");
		f.overrides.set("systemctl --user is-enabled --quiet t3code.service", {
			stdout: "",
			exitCode: 1,
		});
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			`write ${dropIn}`,
			"systemctl --user daemon-reload",
			"systemctl --user enable --now t3code.service",
			"t3 service restart --base-dir '/home/test/.t3'",
		]);
	});
});

describe("Tailscale operator reconciliation", () => {
	it("selects the invoking desktop user under sudo", async () => {
		const f = fixture();
		f.options.user = "root";
		f.options.env = { SUDO_USER: "desktop" };
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toContain("sudo -n tailscale set --operator='desktop'");
		expect(f.mutations).not.toContain(
			"sudo -n tailscale set --operator='root'",
		);
	});

	it("warns before replacing an existing different operator", async () => {
		const f = fixture();
		f.overrides.set("tailscale debug prefs", {
			stdout: '{"OperatorUser":"previous"}',
			exitCode: 0,
		});
		f.options.runCommandImpl = async (command) => {
			expect(f.warnings.join(" ")).toContain("previous");
			expect(f.warnings.join(" ")).toContain("test");
			f.mutations.push(command);
			f.overrides.set("tailscale debug prefs", {
				stdout: '{"OperatorUser":"test"}',
				exitCode: 0,
			});
			return true;
		};
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toContain("sudo -n tailscale set --operator='test'");
	});

	it("reports operator command failures without readiness success", async () => {
		for (const throws of [false, true]) {
			const f = fixture();
			f.overrides.set("tailscale debug prefs", {
				stdout: '{"OperatorUser":""}',
				exitCode: 0,
			});
			f.options.runCommandImpl = async () => {
				if (throws) throw new Error("operator denied");
				return false;
			};
			expect(await configureTailscaleT3(f.options)).toBe(false);
			expect(f.warnings.join(" ")).toContain("operator");
			expect(f.warnings).toHaveLength(1);
			expect(f.warnings[0]).toContain("haoshoku --tailscale-t3");
			expect(f.messages.join(" ")).not.toContain("are ready");
		}
	});
});

describe("Arch Tailscale operator remediation", () => {
	it("names the invoking user's exact manual command on failure", async () => {
		const f = fixture();
		f.options.user = "root";
		f.options.env = { SUDO_USER: "desktop" };
		f.overrides.set("tailscale debug prefs", {
			stdout: '{"OperatorUser":""}',
			exitCode: 0,
		});
		f.options.runCommandImpl = async () => false;
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.warnings.join(" ")).toContain(
			"sudo tailscale set --operator='desktop'",
		);
		expect(f.messages.join(" ")).not.toContain("are ready");
	});
});

describe("Arch T3 agent PATH drop-in", () => {
	it.each([
		null,
		"stale",
	])("reconciles missing or stale PATH content %s and restarts", async (value) => {
		const f = fixture();
		if (value === null) f.files.delete(pathDropIn);
		else f.files.set(pathDropIn, value);
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.files.get(pathDropIn)).toBe(pathContent);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			`write ${pathDropIn}`,
			"systemctl --user daemon-reload",
			"t3 service restart --base-dir '/home/test/.t3'",
		]);
		f.mutations.length = 0;
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([]);
	});
});

describe("Arch T3 listener verification", () => {
	it.each([
		"0.0.0.0",
		"100.65.100.23",
		"[::]",
		"*",
	])("rejects a non-loopback listener at %s after HTTPS readiness", async (address) => {
		const f = fixture();
		f.overrides.set(listenerCommand, {
			stdout: `LISTEN 0 128 127.0.0.1:3773 0.0.0.0:*\nLISTEN 0 128 ${address}:3773 *:*`,
			exitCode: 0,
		});
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.events).toContain(url);
		expect(f.warnings.join(" ")).toContain(
			address.replaceAll("[", "").replaceAll("]", ""),
		);
		expect(f.warnings.join(" ")).toContain("127.0.0.1");
		expect(f.warnings.join(" ")).toContain("only via Tailscale Serve");
		expect(f.messages.join(" ")).not.toContain("are ready");
	});

	it.each([
		"127.0.0.1",
		"127.0.0.2",
		"[::1]",
	])("accepts loopback listener %s", async (address) => {
		const f = fixture();
		f.overrides.set(listenerCommand, {
			stdout: `LISTEN 0 128 ${address}:3773 *:*`,
			exitCode: 0,
		});
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.events).toContain(listenerCommand);
		expect(f.warnings).toEqual([]);
	});

	it.each([
		"empty",
		"missing",
		"throws",
	])("warns without failing when ss is %s", async (mode) => {
		const f = fixture();
		f.overrides.set(
			listenerCommand,
			mode === "throws"
				? new Error("ss missing")
				: {
						stdout: "",
						exitCode: mode === "missing" ? 127 : 0,
					},
		);
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.warnings.join(" ")).toContain("bind could not be verified");
	});
});

it("immediately reports a non-loopback iobox listener without retrying HTTPS", async () => {
	const f = fixture();
	f.options.deviceType = "iobox";
	f.options.maxReadinessAttempts = 3;
	const sleeps = [];
	f.options.sleepImpl = async (ms) => sleeps.push(ms);
	f.overrides.set(listenerCommand, {
		stdout: "LISTEN 0 128 0.0.0.0:3773 0.0.0.0:*",
		exitCode: 0,
	});
	await expect(configureTailscaleT3(f.options)).rejects.toThrow("not loopback");
	expect(sleeps).toEqual([]);
	expect(f.events.filter((event) => event === url)).toHaveLength(1);
	expect(f.messages.join(" ")).not.toContain("are ready");
});

describe("Arch T3 loopback reconciliation", () => {
	it.each([
		null,
		"stale",
	])("repairs %s binding before restart and leaves a rerun unchanged", async (value) => {
		const f = fixture();
		if (value === null) f.files.delete(loopbackDropIn);
		else f.files.set(loopbackDropIn, value);
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command, options) => {
			if (command.includes(" service restart"))
				expect(f.files.get(loopbackDropIn)).toBe(loopbackContent);
			return run(command, options);
		};
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			`write ${loopbackDropIn}`,
			"systemctl --user daemon-reload",
			"t3 service restart --base-dir '/home/test/.t3'",
		]);
		f.mutations.length = 0;
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([]);
	});
});
