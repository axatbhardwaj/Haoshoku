import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRunLog } from "../src/common/run_log.js";
import { log, runCommand, runCommandCapture } from "../src/common/utils.js";
import { runCachyOSSetup } from "../src/os_scripts/cachyos.js";
import { configureTailscaleT3 } from "../src/helpers/configure_tailscale_t3.js";

const dropIn =
	"/home/test/.config/systemd/user/t3code.service.d/axstack-tailscale.conf";
const content = '[Service]\nEnvironment="T3CODE_TAILSCALE_SERVE=true"\n';
const pathDropIn =
	"/home/test/.config/systemd/user/t3code.service.d/axstack-path.conf";
const pathContent =
	'[Service]\nEnvironment="PATH=%h/.local/bin:%h/.bun/bin:%h/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin"\n';
const sleepTargets = [
	"sleep.target",
	"suspend.target",
	"hibernate.target",
	"hybrid-sleep.target",
	"suspend-then-hibernate.target",
];
const maskProbe = (target) =>
	`systemctl show ${target} --property=UnitFileState --value`;
const listenerCommand = "ss -Hltn 'sport = :3773'";
const url = "https://laptop.tail123.ts.net";
const serve = {
	TCP: { 443: { HTTPS: true } },
	Web: {
		"laptop.tail123.ts.net:443": {
			Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } },
		},
	},
};

function fixture({ fresh = false, loggedOut = fresh } = {}) {
	let serviceActive = !fresh;
	let operator = fresh ? "" : "test";
	const events = [];
	const warnings = [];
	const messages = [];
	const files = new Map(
		fresh
			? []
			: [
					[dropIn, content],
					[pathDropIn, pathContent],
					[
						"/home/test/.config/systemd/user/t3code.service",
						"[Service]\nEnvironment=T3CODE_HOME=/home/test/.t3\n",
					],
				],
	);
	const masks = new Map(sleepTargets.map((target) => [target, "masked"]));
	const mutations = [];
	const overrides = new Map();
	const options = {
		home: "/home/test",
		hostname: "fixture",
		user: "test",
		deviceType: "pc",
		env: {},
		fsImpl: {
			existsSync: (file) => files.has(file),
			readdirSync: () => [],
			statSync: () => {
				throw Object.assign(new Error("absent fixture"), { code: "ENOENT" });
			},
			readFileSync: (file) => {
				if (!files.has(file))
					throw Object.assign(new Error("missing"), { code: "ENOENT" });
				return files.get(file);
			},
			mkdirSync: (file) => mutations.push(`mkdir ${file}`),
			writeFileSync: (file, value) => {
				mutations.push(`write ${file}`);
				files.set(file, value);
			},
		},
		captureCommandImpl: async (command) => {
			events.push(command);
			if (overrides.has(command)) {
				const value = overrides.get(command);
				if (value instanceof Error) throw value;
				return value;
			}
			let stdout = "";
			let exitCode = 0;
			if (command.startsWith("systemctl --user show "))
				stdout = fresh
					? "LoadState=not-found\nEnvironment=\n"
					: "LoadState=loaded\nExecStart={ path=/home/test/.t3/runtime/versions/1/t3 ; argv[]=/home/test/.t3/runtime/versions/1/t3 __service-launcher ; }\nEnvironment=T3CODE_HOME=/home/test/.t3\n";
			else if (
				command.startsWith("systemctl --user list-") ||
				command === "ps -eo pid=,comm=,args="
			)
				stdout = "";
			else if (command === "command -v t3code t3code-nightly") exitCode = 1;
			else if (command.startsWith("systemctl show "))
				stdout = masks.get(command.split(" ")[2]);
			else if (command.startsWith("loginctl show-user ")) stdout = "Linger=yes";
			else if (command === listenerCommand)
				stdout = "LISTEN 0 128 127.0.0.1:3773 0.0.0.0:*";
			else if (command === "command -v t3") stdout = "/usr/bin/t3";
			else if (command === "/usr/bin/t3 --version")
				stdout = "t3 v0.0.46-nightly.20261004.2644";
			else if (command === "pacman -Q t3code-bin") exitCode = 1;
			else if (command === "pacman -Q t3code-nightly-bin")
				stdout = "t3code-nightly-bin 0.0.46";
			else if (command === "pacman -Q tailscale") exitCode = fresh ? 1 : 0;
			else if (command.includes("--user is-active"))
				exitCode = serviceActive ? 0 : 1;
			else if (command.includes("is-enabled") || command.includes("is-active"))
				exitCode = fresh ? 1 : 0;
			else if (command === "tailscale status --json")
				stdout = JSON.stringify({
					BackendState: loggedOut ? "NeedsLogin" : "Running",
				});
			else if (command === "tailscale debug prefs")
				stdout = JSON.stringify({ OperatorUser: operator });
			else if (command === "t3 --version")
				stdout = "t3 v0.0.46-nightly.20261004.2644";
			else if (command === "tailscale serve status --json")
				stdout = JSON.stringify(serve);
			else throw new Error(`Unexpected probe: ${command}`);
			return { stdout, exitCode };
		},
		runCommandImpl: async (command, init) => {
			events.push(command);
			mutations.push(command);
			if (command.startsWith("sudo -n tailscale set --operator=")) {
				operator = options.env.SUDO_USER || options.user;
				overrides.delete("tailscale debug prefs");
			}
			if (command.startsWith("sudo -n systemctl mask "))
				for (const target of command.split(" ").slice(4))
					masks.set(target, "masked");
			if (command.startsWith("t3 service install")) serviceActive = true;
			if (command === "sudo -n tailscale up") {
				expect(init).toMatchObject({ stdout: "inherit", stderr: "inherit" });
				loggedOut = false;
			}
			return true;
		},
		fetchImpl: async (target, init) => {
			events.push(target);
			expect(init.redirect).toBe("error");
			return new Response("ready");
		},
		sleepImpl: async () => {},
		maxReadinessAttempts: 1,
		logger: {
			warning: (message) => warnings.push(message),
			info: (message) => messages.push(message),
			success: (message) => messages.push(message),
		},
	};
	return {
		options,
		events,
		mutations,
		warnings,
		messages,
		files,
		overrides,
		masks,
	};
}

describe("Arch T3 over Tailscale", () => {
	it.each([
		["io", "pc", ["iobook"]],
		["iobook", "laptop", ["io"]],
		["iobox", "iobox", ["io", "iobook"]],
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
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			"sudo -n pacman -S --needed --noconfirm tailscale",
			"sudo -n systemctl enable --now tailscaled.service",
			"sudo -n tailscale up",
			"sudo -n tailscale set --operator='test'",
			`write ${dropIn}`,
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

describe("Arch T3 installation diagnostics", () => {
	it("warns about a shadowing CLI with both paths and versions, without removing it", async () => {
		const f = fixture();
		f.files.set("/usr/bin/t3", "packaged CLI");
		f.overrides.set("command -v t3", {
			stdout: "/home/test/.local/bin/t3",
			exitCode: 0,
		});
		f.overrides.set("/usr/bin/t3 --version", {
			stdout: "t3 v0.0.46-nightly.20261006.2735",
			exitCode: 0,
		});
		expect(await configureTailscaleT3(f.options)).toBe(true);
		for (const text of [
			"/home/test/.local/bin/t3",
			"/usr/bin/t3",
			"20261004.2644",
			"20261006.2735",
		]) {
			expect(f.warnings.join(" ")).toContain(text);
		}
		expect(f.mutations).toEqual([]);
	});

	it("does not probe or warn about an absent packaged CLI", async () => {
		const f = fixture();
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

const lingerProbe = "loginctl show-user 'test' -p Linger";
const lingerEnable = "sudo -n loginctl enable-linger 'test'";

describe("Arch T3 linger", () => {
	it.each([
		"pc",
		"laptop",
		"iobox",
	])("enables and verifies linger on %s, then leaves it unchanged", async (deviceType) => {
		const f = fixture();
		f.options.deviceType = deviceType;
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
	it("masks only unmasked system targets, verifies each, and is a no-op on rerun", async () => {
		const f = fixture();
		f.options.deviceType = "iobox";
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
	it.each([
		"Tailscale",
		"T3 service",
		"linger",
		"sleep mask",
		"Tailscale/T3",
	])("fails iobox setup naming %s and stops later steps", async (step) => {
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
				readDeviceTypeImpl: () => "iobox",
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
