import { expect, it } from "bun:test";
import { configureTailscaleT3 } from "../../src/helpers/configure_tailscale_t3.js";
import {
	fixture,
	lidDropIn,
	lidContent,
	lidConfigProbe,
	inhibitorProbe,
} from "./fixture.js";

function satellite() {
	const f = fixture();
	f.options.deviceType = "iosatellite";
	return f;
}

it("installs iosatellite lid ignores without restarting logind, then verifies a no-op rerun", async () => {
	const f = satellite();
	expect(await configureTailscaleT3(f.options)).toBe(true);
	expect(f.files.get(lidDropIn)).toBe(lidContent);
	expect(
		f.mutations.some(
			(command) => command.includes("install") && command.includes(lidDropIn),
		),
	).toBe(true);
	expect(
		f.events.some((command) => /(?:restart|reload).*logind/.test(command)),
	).toBe(false);
	expect(f.messages.join(" ")).toContain("real closed-lid AC");
	f.mutations.length = 0;
	expect(await configureTailscaleT3(f.options)).toBe(true);
	expect(f.mutations).toEqual([]);
});

it("requires a reboot when running logind still suspends, even if the drop-in already exists", async () => {
	const f = satellite();
	f.files.set(lidDropIn, lidContent);
	f.overrides.set(
		"busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager HandleLidSwitchExternalPower",
		{ exitCode: 0, stdout: 's "suspend"' },
	);
	expect(await configureTailscaleT3(f.options)).toBe(true);
	expect(f.warnings.join(" ")).toContain("Reboot required");
	expect(f.warnings.join(" ")).toContain("not active");
	expect(f.warnings.join(" ")).toContain("Keep the lid open");
	expect(f.messages.join(" ")).not.toContain("lid ignores are active");
	expect(f.mutations).toEqual([]);
});

it("reports desktop ownership of lid handling", async () => {
	const f = satellite();
	f.overrides.set(inhibitorProbe, {
		exitCode: 0,
		stdout: "hypridle xzat 123 handle-lid-switch desktop block",
	});
	expect(await configureTailscaleT3(f.options)).toBe(true);
	expect(f.warnings.join(" ")).toContain("desktop inhibitor");
});

it.each([
	"general",
	"AC",
	"docked",
	"section",
	"probe",
	"runtime",
	"inhibitors",
	"write",
	"unverified",
])("surfaces lid %s failure before claiming readiness", async (mode) => {
	const f = satellite();
	const key = {
		general: "HandleLidSwitch",
		AC: "HandleLidSwitchExternalPower",
		docked: "HandleLidSwitchDocked",
	}[mode];
	if (key)
		f.overrides.set(lidConfigProbe, {
			exitCode: 0,
			stdout: `${lidContent}\n# /etc/systemd/logind.conf.d/99-other.conf\n[Login]\n${key}=suspend\n`,
		});
	if (mode === "section")
		f.overrides.set(lidConfigProbe, {
			exitCode: 0,
			stdout: lidContent.replace("[Login]", "[Other]"),
		});
	if (mode === "probe")
		f.overrides.set(lidConfigProbe, { exitCode: 1, stdout: "" });
	if (mode === "runtime")
		f.overrides.set(
			"busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager HandleLidSwitch",
			{ exitCode: 1, stdout: "" },
		);
	if (mode === "inhibitors")
		f.overrides.set(inhibitorProbe, { exitCode: 1, stdout: "" });
	const run = f.options.runCommandImpl;
	if (["write", "unverified"].includes(mode))
		f.options.runCommandImpl = (command, options) =>
			command.startsWith("sudo -n install -o root")
				? mode === "unverified"
				: run(command, options);
	await expect(configureTailscaleT3(f.options)).rejects.toThrow(
		"lid policy failed",
	);
	expect(f.messages.join(" ")).not.toContain("are ready");
});

it.each([
	"pc",
	"laptop",
	"iobox",
])("leaves %s lid policy alone", async (deviceType) => {
	const f = fixture();
	f.options.deviceType = deviceType;
	expect(await configureTailscaleT3(f.options)).toBe(true);
	expect(f.files.has(lidDropIn)).toBe(false);
	expect(f.events).not.toContain(lidConfigProbe);
	expect(f.events).not.toContain(inhibitorProbe);
});

it("refuses a successful but malformed logind runtime probe", async () => {
	const f = satellite();
	f.overrides.set(
		"busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager HandleLidSwitch",
		{ exitCode: 0, stdout: "" },
	);
	await expect(configureTailscaleT3(f.options)).rejects.toThrow(
		"Cannot read running logind",
	);
	expect(f.messages.join(" ")).not.toContain("are ready");
});
