import { afterEach, beforeEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureFleetSsh } from "../src/helpers/configure_fleet_ssh.js";

let home, calls, warnings, options;
beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-ssh-"));
	calls = [];
	warnings = [];
	options = {
		home,
		hostname: "io",
		osType: "arch",
		logger: { warning: (message) => warnings.push(message) },
		captureCommandImpl: async (command) => {
			calls.push(command);
			return {
				exitCode: 0,
				stdout: JSON.stringify(
					command === "tailscale debug prefs"
						? { RunSSH: true }
						: {
								BackendState: "Running",
								Peer: {
									book: {
										DNSName: "iobook.tail140c22.ts.net.",
										Online: true,
										sshHostKeys: ["ssh-ed25519 Qk9PSw=="],
									},
									box: {
										DNSName: "iobox.tail140c22.ts.net.",
										Online: true,
										sshHostKeys: ["ssh-ed25519 Qk9Y"],
									},
								},
							},
				),
			};
		},
		runCommandImpl: async (command) => {
			calls.push(command);
			return true;
		},
	};
});
afterEach(() => fs.rmSync(home, { recursive: true }));

// Guard must block all side effects even if a fleet manifest names a Debian host.
it.each([
	["unknown", "arch"],
	["axat-vps", "debian-server"],
	["io", "debian-server"],
])("refuses standalone fleet SSH on %s / %s without writes or commands", async (hostname, osType) => {
	expect(
		await configureFleetSsh({ ...options, hostname, osType, standalone: true }),
	).toBe(false);
	expect(warnings.join(" ")).toContain("Arch fleet host");
	expect(calls).toEqual([]);
	expect(fs.readdirSync(home)).toEqual([]);
});
it("skips non-fleet full setup without side effects", async () => {
	expect(await configureFleetSsh({ ...options, hostname: "unknown" })).toBe(
		true,
	);
	expect(calls).toEqual([]);
	expect(fs.readdirSync(home)).toEqual([]);
});
it("validates the fleet before any commands or writes", async () => {
	await expect(
		configureFleetSsh({ ...options, manifest: { tailnet: "bad" } }),
	).rejects.toThrow("Invalid fleet manifest");
	expect(calls).toEqual([]);
	expect(fs.readdirSync(home)).toEqual([]);
});

it.each([
	true,
	false,
])("verifies RunSSH and enables it only when needed (%s)", async (enabled) => {
	let runSSH = enabled;
	options.captureCommandImpl = async (command) => {
		calls.push(command);
		return {
			exitCode: 0,
			stdout: JSON.stringify(
				command === "tailscale debug prefs"
					? { RunSSH: runSSH }
					: {
							BackendState: "Running",
							Peer: {
								book: {
									DNSName: "iobook.tail140c22.ts.net.",
									Online: true,
									sshHostKeys: ["ssh-ed25519 Qk9PSw=="],
								},
								box: {
									DNSName: "iobox.tail140c22.ts.net.",
									Online: true,
									sshHostKeys: ["ssh-ed25519 Qk9Y"],
								},
							},
						},
			),
		};
	};
	options.runCommandImpl = async (command) => {
		calls.push(command);
		runSSH = true;
		return true;
	};
	expect(await configureFleetSsh(options)).toBe(true);
	expect(calls).toEqual([
		"tailscale status --json",
		"tailscale debug prefs",
		...(enabled ? [] : ["tailscale set --ssh", "tailscale debug prefs"]),
	]);
	expect(warnings).toEqual([]);
});

it.each([
	"stopped",
	"logged-out",
	"prefs-failed",
	"prefs-invalid",
	"set-failed",
	"unverified",
])("reports Tailscale SSH failure: %s", async (failure) => {
	options.captureCommandImpl = async (command) => {
		calls.push(command);
		if (command === "tailscale debug prefs") {
			return {
				exitCode: failure === "prefs-failed" ? 1 : 0,
				stdout: failure === "prefs-invalid" ? "{}" : '{"RunSSH":false}',
			};
		}
		return {
			exitCode: failure === "stopped" ? 1 : 0,
			stdout: JSON.stringify({
				BackendState: failure === "logged-out" ? "NeedsLogin" : "Running",
				Peer: {},
			}),
		};
	};
	options.runCommandImpl = async (command) => {
		calls.push(command);
		return failure !== "set-failed";
	};
	expect(await configureFleetSsh(options)).toBe(false);
	expect(warnings.join(" ")).toContain("Tailscale SSH");
	expect(fs.readdirSync(home)).toEqual([]);
	if (
		["stopped", "logged-out", "prefs-failed", "prefs-invalid"].includes(failure)
	)
		expect(calls).not.toContain("tailscale set --ssh");
	await expect(
		configureFleetSsh({ ...options, hostname: "iobox" }),
	).rejects.toThrow("Tailscale SSH");
});

it.each([
	undefined,
	"Host vps\n  HostName private.example\n  User custom\nMatch originalhost vps\n  Port 2222\n",
	"# user config\nInclude config.d/haoshoku-fleet\nHost private\n  User owner\n",
])("writes fleet blocks and preserves existing user configuration", async (existing) => {
	const sshDir = path.join(home, ".ssh");
	fs.mkdirSync(sshDir);
	const config = path.join(sshDir, "config");
	if (existing !== undefined)
		fs.writeFileSync(config, existing, { mode: 0o644 });
	const knownHosts = path.join(sshDir, "known_hosts");
	fs.writeFileSync(knownHosts, "user keys stay here\n");
	expect(await configureFleetSsh(options)).toBe(true);
	const fragment = path.join(sshDir, "config.d/haoshoku-fleet");
	const blocks = fs.readFileSync(fragment, "utf8");
	expect(blocks).toBe(
		[
			"Host iobook",
			"  HostName iobook.tail140c22.ts.net",
			"  User xzat",
			"  UserKnownHostsFile ~/.ssh/known_hosts_fleet",
			"  StrictHostKeyChecking yes",
			"",
			"Host iobox",
			"  HostName iobox.tail140c22.ts.net",
			"  User xzat",
			"  UserKnownHostsFile ~/.ssh/known_hosts_fleet",
			"  StrictHostKeyChecking yes",
			"",
			"Host axat-vps",
			"  HostName axat-vps.tail140c22.ts.net",
			"  User root",
			"  IdentityFile ~/.ssh/id_ed25519_vps",
			"  StrictHostKeyChecking accept-new",
			"",
		].join("\n"),
	);
	const expected = `Include config.d/haoshoku-fleet\n${(existing ?? "").replace("Include config.d/haoshoku-fleet\n", "")}`;
	expect(fs.readFileSync(config, "utf8")).toBe(expected);
	for (const file of [config, fragment])
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
	for (const dir of [sshDir, path.dirname(fragment)])
		expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
	expect(fs.readFileSync(knownHosts, "utf8")).toBe("user keys stay here\n");
	const before = [config, fragment].map(
		(file) => fs.statSync(file, { bigint: true }).mtimeNs,
	);
	expect(await configureFleetSsh(options)).toBe(true);
	expect(
		[config, fragment].map(
			(file) => fs.statSync(file, { bigint: true }).mtimeNs,
		),
	).toEqual(before);
	// Resolve the Include to this isolated fixture; ssh uses passwd HOME rather than env HOME.
	const resolvedConfig = path.join(home, "ssh-test-config");
	fs.writeFileSync(
		resolvedConfig,
		expected.replace("config.d/haoshoku-fleet", fragment),
	);
	const ssh = Bun.spawnSync(["ssh", "-G", "-F", resolvedConfig, "iobook"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(ssh.exitCode).toBe(0);
	const output = new TextDecoder().decode(ssh.stdout);
	expect(output).toContain("hostname iobook.tail140c22.ts.net\n");
	expect(output).toContain("user xzat\n");
	expect(output).toContain("stricthostkeychecking true\n");
	if (existing?.includes("Host vps")) {
		const vps = Bun.spawnSync(["ssh", "-G", "-F", resolvedConfig, "vps"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(vps.exitCode).toBe(0);
		const alias = new TextDecoder().decode(vps.stdout);
		expect(alias).toContain("hostname private.example\n");
		expect(alias).toContain("user custom\n");
		expect(alias).toContain("port 2222\n");
	}
});

it("moves an Include without a trailing newline while preserving surrounding blank lines", async () => {
	fs.mkdirSync(path.join(home, ".ssh"));
	const file = path.join(home, ".ssh/config");
	fs.writeFileSync(
		file,
		"\n# user settings\n\nHost vps\n  User custom\n\n  Include config.d/haoshoku-fleet",
	);
	expect(await configureFleetSsh(options)).toBe(true);
	expect(fs.readFileSync(file, "utf8")).toBe(
		"Include config.d/haoshoku-fleet\n\n# user settings\n\nHost vps\n  User custom\n\n",
	);
});
