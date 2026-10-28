import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRunLog } from "../src/common/run_log.js";
import { runCommand, runCommandCapture } from "../src/common/utils.js";
import { runCachyOSSetup } from "../src/os_scripts/cachyos.js";
import { configureTailscaleT3 } from "../src/helpers/configure_tailscale_t3.js";

import {
	fixture,
	seedManagedNpm,
	url,
	dropIn,
	content,
	pathDropIn,
	pathContent,
	loopbackDropIn,
	loopbackContent,
} from "./configure_tailscale_t3/fixture.js";
describe("Arch T3 over Tailscale", () => {
	it.each([
		["io", "pc", ["iobook"]],
		["iobook", "laptop", ["io"]],
		["iobox", "iobox", ["io", "iobook"]],
		["iosatellite", "iosatellite", ["io", "iobook"]],
	])("provisions fresh %s without opening desktop and mints other client links", async (hostname, deviceType, clients) => {
		const f = fixture({ fresh: true, loggedOut: false });
		Object.assign(f.options, { hostname, deviceType });
		f.overrides.set("command -v t3code t3code-nightly", {
			exitCode: 0,
			stdout: "/usr/bin/t3code-nightly",
		});
		f.overrides.set("tailscale status --json", {
			exitCode: 0,
			stdout: JSON.stringify({
				BackendState: "Running",
				MagicDNSSuffix: "tail140c22.ts.net",
			}),
		});
		for (const client of clients) {
			f.overrides.set(
				`t3 pair --tailscale --base-dir '/home/test/.t3' --ttl 15m --label '${client}'`,
				{
					exitCode: 0,
					stdout: `QR output\nPairing URL: https://${hostname}.tail140c22.ts.net/pair#token=${client}\nExpires soon`,
				},
			);
		}
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(
			JSON.parse(f.files.get("/home/test/.t3/userdata/desktop-settings.json")),
		).toEqual({ localEnvironmentEnabled: false });
		expect(f.events).toContain(
			"t3 service install --base-dir '/home/test/.t3'",
		);
		expect(f.events).toContain("loginctl show-user 'test' -p Linger");
		expect(f.messages.join(" ")).toContain("Pair your phone");
		expect(
			f.events.filter((event) => event.startsWith("t3 pair ")),
		).toHaveLength(clients.length);
		for (const client of clients)
			expect(
				f.messages.filter((message) =>
					message.includes(
						`${client}: https://${hostname}.tail140c22.ts.net/pair#token=${client}`,
					),
				),
			).toHaveLength(1);
	});

	it.each([
		"wrong tailnet",
		"stopped",
		"malformed",
	])("skips fleet pairing with a warning for %s", async (kind) => {
		const f = fixture();
		f.options.hostname = "iobox";
		const capture = f.options.captureCommandImpl;
		let statuses = 0;
		f.options.captureCommandImpl = async (command, options) => {
			if (command === "tailscale status --json" && ++statuses > 1)
				return {
					exitCode: 0,
					stdout:
						kind === "malformed"
							? "bad json"
							: JSON.stringify({
									BackendState: kind === "stopped" ? "Stopped" : "Running",
									MagicDNSSuffix:
										kind === "wrong tailnet"
											? "other.ts.net"
											: "tail140c22.ts.net",
								}),
				};
			return capture(command, options);
		};
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.events.some((event) => event.startsWith("t3 pair "))).toBe(false);
		expect(f.warnings.join(" ")).toContain("Skipping fleet pairing");
	});

	it.each([
		"failed",
		"malformed",
		"throws",
	])("warns on a %s mint and continues with the next client", async (kind) => {
		const f = fixture();
		f.options.hostname = "iobox";
		f.overrides.set("tailscale status --json", {
			exitCode: 0,
			stdout: '{"BackendState":"Running","MagicDNSSuffix":"tail140c22.ts.net"}',
		});
		f.overrides.set(
			"t3 pair --tailscale --base-dir '/home/test/.t3' --ttl 15m --label 'io'",
			kind === "throws"
				? new Error("mint unavailable")
				: { exitCode: kind === "failed" ? 1 : 0, stdout: "no link" },
		);
		f.overrides.set(
			"t3 pair --tailscale --base-dir '/home/test/.t3' --ttl 15m --label 'iobook'",
			{
				exitCode: 0,
				stdout: "Pairing URL: https://iobox.tail140c22.ts.net/pair#token=book",
			},
		);
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.warnings.join(" ")).toContain("io");
		expect(f.messages.join(" ")).toContain(
			"iobook: https://iobox.tail140c22.ts.net/pair#token=book",
		);
	});

	it("installs and enables a fresh laptop in order, then prints HTTPS and pairing", async () => {
		const f = fixture({ fresh: true });
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command, options) => {
			if (command.includes(" service install"))
				expect(f.files.get(loopbackDropIn)).toBe(loopbackContent);
			return run(command, options);
		};
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			"sudo -n pacman -S --needed --noconfirm tailscale",
			"sudo -n systemctl enable --now tailscaled.service",
			"sudo -n tailscale up",
			"sudo -n tailscale set --operator='test'",
			`write ${dropIn}`,
			`write ${loopbackDropIn}`,
			`write ${pathDropIn}`,
			"t3 service install --base-dir '/home/test/.t3'",
		]);
		expect(f.files.get(dropIn)).toBe(content);
		expect(f.files.get(pathDropIn)).toBe(pathContent);
		expect(f.events).toContain(url);
		expect(f.messages.join(" ")).toContain(url);
		expect(f.messages.join(" ")).toContain("t3 pair --tailscale");
	});

	it("leaves a configured machine unchanged, without login or file writes", async () => {
		const f = fixture();
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([]);
		expect(f.messages.join(" ")).toContain(url);
	});

	it("announces browser login and waits only when logged out", async () => {
		const f = fixture({ loggedOut: true });
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual(["sudo -n tailscale up"]);
		expect(f.messages.join(" ")).toContain("login URL");
		expect(f.messages.join(" ")).toContain("waiting");
		expect(
			f.events.filter((event) => event === "tailscale status --json"),
		).toHaveLength(2);
	});

	it("reloads and restarts an existing service only when the drop-in changes", async () => {
		const f = fixture();
		f.files.set(dropIn, "old");
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			`write ${dropIn}`,
			"systemctl --user daemon-reload",
			"t3 service restart --base-dir '/home/test/.t3'",
		]);
	});

	it("warns and returns on a command failure or exception", async () => {
		for (const throws of [false, true]) {
			const f = fixture({ fresh: true });
			f.options.runCommandImpl = async () => {
				if (throws) throw new Error("denied");
				return false;
			};
			expect(await configureTailscaleT3(f.options)).toBe(false);
			expect(f.warnings.join(" ")).toContain("continuing");
			expect(f.warnings.join(" ")).toContain("--tailscale-t3");
			expect(f.files.has(dropIn)).toBe(false);
		}
	});

	it.each([
		"NoState",
		"Stopped",
		"unknown",
	])("does not request login for unverified backend state %s", async (BackendState) => {
		const f = fixture();
		f.overrides.set("tailscale status --json", {
			stdout: JSON.stringify({ BackendState }),
			exitCode: 0,
		});
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.mutations).toEqual([]);
		expect(f.warnings.join(" ")).toContain("Tailscale");
	});

	it("warns if HTTPS is unavailable without claiming pairing readiness", async () => {
		const f = fixture();
		f.options.fetchImpl = async () => new Response("starting", { status: 503 });
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.warnings.join(" ")).toContain("HTTPS");
		expect(f.messages.join(" ")).not.toContain("pair --tailscale");
	});
});

describe("Arch T3 installation diagnostics", () => {
	it("warns about a shadowing CLI with both paths and versions, without removing it", async () => {
		const f = fixture();
		f.files.set("/usr/bin/t3", "packaged CLI");
		seedManagedNpm(f);
		f.overrides.set("command -v t3", {
			stdout: "/home/test/.local/bin/t3",
			exitCode: 0,
		});
		f.overrides.set("/usr/bin/t3 --version", {
			stdout: "t3 v0.1.0+package",
			exitCode: 0,
		});
		expect(await configureTailscaleT3(f.options)).toBe(true);
		for (const text of [
			"/home/test/.local/bin/t3",
			"/usr/bin/t3",
			"0.1.0",
			"0.1.0+package",
		]) {
			expect(f.warnings.join(" ")).toContain(text);
		}
		expect(f.mutations).toEqual([]);
	});

	it("does not probe or warn about an absent packaged CLI", async () => {
		const f = fixture();
		seedManagedNpm(f);
		f.overrides.set("command -v t3", {
			stdout: "/home/test/.local/bin/t3",
			exitCode: 0,
		});
		f.overrides.set("/usr/bin/t3 --version", { stdout: "", exitCode: 127 });
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.events).not.toContain("/usr/bin/t3 --version");
		expect(f.warnings).toEqual([]);
	});

	it("warns when stable and nightly packages coexist without uninstalling them", async () => {
		const f = fixture();
		f.overrides.set("pacman -Q t3code-bin", {
			stdout: "t3code-bin 0.0.45",
			exitCode: 0,
		});
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.warnings.join(" ")).toContain("t3code-bin");
		expect(f.warnings.join(" ")).toContain("t3code-nightly-bin");
		expect(f.mutations).toEqual([]);
	});
});

const logRoots = [];
afterEach(() => {
	for (const root of logRoots.splice(0)) fs.rmSync(root, { recursive: true });
});

it.each([
	true,
	false,
])("summarizes only actual setup failures after expected probes (enable succeeds=%s)", async (succeeds) => {
	const f = fixture({ fresh: true, loggedOut: false });
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "t3-probe-log-"));
	logRoots.push(root);
	const run = startRunLog({ version: "test", env: { HOME: root } });
	const capture = f.options.captureCommandImpl;
	f.options.captureCommandImpl = async (command, options) => {
		const result = await capture(command);
		return runCommandCapture(command, {
			...options,
			log: false,
			spawnImpl: () => ({
				exited: Promise.resolve(result.exitCode),
				stdout: new Response(result.stdout).body,
				stderr: new Response("").body,
			}),
		});
	};
	const execute = f.options.runCommandImpl;
	f.options.runCommandImpl = async (command, options) => {
		const result = succeeds && (await execute(command, options));
		return runCommand(command, {
			log: false,
			spawnImpl: () => ({
				exited: Promise.resolve(result ? 0 : 1),
				stdout: new Response("").body,
				stderr: new Response("").body,
			}),
		});
	};
	seedManagedNpm(f);
	f.overrides.set("command -v t3", {
		stdout: "/home/test/.local/bin/t3",
		exitCode: 0,
	});
	f.overrides.set("/usr/bin/t3 --version", { stdout: "", exitCode: 127 });
	expect(await configureTailscaleT3(f.options)).toBe(succeeds);
	const summary = [];
	run.finish(0, (message) => summary.push(message));
	expect(summary).toHaveLength(1);
	const text = fs.readFileSync(run.path, "utf8");
	if (succeeds) {
		expect(summary[0]).not.toContain("failed command");
		expect(text).toContain("Probe: pacman -Q t3code-bin\nExit: 1");
		expect(text).toContain(
			"Probe: systemctl is-enabled --quiet tailscaled.service\nExit: 1",
		);
		expect(text).not.toContain("/usr/bin/t3 --version");
	} else {
		expect(summary[0]).toContain("1 failed command/step:");
		expect(summary[0]).toContain(
			"sudo -n pacman -S --needed --noconfirm tailscale",
		);
		expect(summary[0]).not.toContain("pacman -Q tailscale");
	}
});

describe("Arch full setup T3 failure summary", () => {
	it.each([
		["pc", "ready"],
		["pc", "missing"],
		["pc", "throws"],
		["laptop", "missing"],
		["laptop", "throws"],
	])("continues %s setup and counts the T3 %s outcome once", async (deviceType, outcome) => {
		const f = fixture({ fresh: true, loggedOut: false });
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "arch-t3-step-log-"));
		logRoots.push(root);
		const run = startRunLog({ version: "test", env: { HOME: root } });
		const events = [];
		seedManagedNpm(f);
		f.overrides.set("command -v t3", {
			stdout: "/home/test/.local/bin/t3",
			exitCode: 0,
		});
		if (outcome === "missing")
			f.overrides.set("t3 --version", { stdout: "", exitCode: 127 });
		const capture = f.options.captureCommandImpl;
		f.options.captureCommandImpl = async (command, options) => {
			const result = await capture(command);
			return runCommandCapture(command, {
				...options,
				log: false,
				spawnImpl: () => ({
					exited: Promise.resolve(result.exitCode),
					stdout: new Response(result.stdout).body,
					stderr: new Response("").body,
				}),
			});
		};
		expect(
			await runCachyOSSetup({
				promptDeviceTypeImpl: async () => {},
				readDeviceTypeImpl: () => deviceType,
				startSudoSessionImpl: async () => () => events.push("sudo-stop"),
				commandExistsImpl: async () => false,
				prepareArchPackageManagerImpl: async () => true,
				ensureRustToolchainImpl: async () => {},
				ensureAurHelperImpl: async () => "paru",
				installDevToolsImpl: async () => {},
				installSystemPackagesImpl: async () => {},
				installFlatpakAppsImpl: async () => {},
				configureUserAppsImpl: async () => {},
				configureTailscaleT3Impl: (options) => {
					if (outcome === "throws") throw new Error("T3 probe unavailable");
					return configureTailscaleT3({ ...f.options, ...options });
				},
				configureBraveManagedPoliciesImpl: async () => {},
				configureHyprmoncfgImpl: async () => {},
				configureOmarchyWorkspacesImpl: async () => {},
				configureOmarchyPluginsImpl: async () => {},
				configureVoxtypeOsdImpl: async () => {},
				configureKdeConnectCommandsImpl: async () => {},
				configureOmarchyBarImpl: async () => {},
				configureOmazedImpl: async () => {},
				configureOmarchyAppearanceImpl: async () => {},
				configureFleetSshImpl: async () => {
					events.push("fleet-ssh");
					return true;
				},
			}),
		).toBe(true);
		expect(events).toEqual(["fleet-ssh", "sudo-stop"]);
		const summary = [];
		run.finish(0, (message) => summary.push(message));
		expect(summary).toHaveLength(1);
		const text = fs.readFileSync(run.path, "utf8");
		if (outcome === "ready") {
			expect(summary[0]).not.toContain("failed command");
			expect(text).toContain("Probe: pacman -Q t3code-bin\nExit: 1");
			expect(text).toContain(
				"Probe: systemctl is-enabled --quiet tailscaled.service\nExit: 1",
			);
		} else {
			expect(summary[0]).toContain("1 failed command/step:");
			expect(summary[0]).toContain("Tailscale/T3");
			expect(summary[0]).toContain("haoshoku --tailscale-t3");
			if (outcome === "missing")
				expect(text).toContain("Probe: t3 --version\nExit: 127");
		}
	});
});

it.each([
	"t3 v0.1.0-nightly.20261016.1",
	"t3 v0.2.0",
	"unknown",
])("holds wrong or newer Arch CLI %s before service mutations", async (version) => {
	const f = fixture();
	f.overrides.set("t3 --version", { stdout: version, exitCode: 0 });
	expect(await configureTailscaleT3(f.options)).toBe(false);
	expect(f.mutations).toEqual([]);
});

it("holds an unmanaged Arch executable even when it reports a stable version", async () => {
	const f = fixture();
	f.overrides.set("pacman -Qqo '/usr/bin/t3'", { exitCode: 1, stdout: "" });
	expect(await configureTailscaleT3(f.options)).toBe(false);
	expect(f.mutations).toEqual([]);
	expect(f.warnings.join(" ")).toContain("origin");
});

it.each([
	"unavailable",
	"invalid",
	"below floor",
	"prerelease",
])("holds Arch setup when the stable registry is %s", async (kind) => {
	const f = fixture();
	f.options.latestStableImpl = async () => {
		if (kind === "unavailable") throw new Error("stable registry unavailable");
		return {
			invalid: "invalid",
			"below floor": "0.0.99",
			prerelease: "0.1.0-nightly.20261016.1",
		}[kind];
	};
	expect(await configureTailscaleT3(f.options)).toBe(false);
	expect(f.mutations).toEqual([]);
	expect(f.events).not.toContain("pacman -Qqo '/usr/bin/t3'");
	expect(f.warnings.join(" ")).toContain(
		kind === "unavailable"
			? "stable registry unavailable"
			: "stable release unknown",
	);
});
