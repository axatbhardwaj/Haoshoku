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

const dns = (host) => `${host}.tail140c22.ts.net.`;
const keyLine = (host, key) => `${host},${host}.tail140c22.ts.net ${key}\n`;
function setPeers(peers) {
	options.captureCommandImpl = async (command) => {
		calls.push(command);
		return {
			exitCode: 0,
			stdout: JSON.stringify(
				command === "tailscale debug prefs"
					? { RunSSH: true }
					: { BackendState: "Running", Peer: peers },
			),
		};
	};
}
function seedFleetKeys(content) {
	fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
	const file = path.join(home, ".ssh/known_hosts_fleet");
	fs.writeFileSync(file, content);
	return file;
}

// Protects advertised key rotation, exact DNS matching, and transport isolation.
it("rebuilds fleet keys from sshHostKeys and leaves user known_hosts untouched", async () => {
	const file = seedFleetKeys(
		keyLine("iobook", "ssh-ed25519 T0xE") +
			keyLine("removed", "ssh-ed25519 U1RBTEU="),
	);
	const userFile = path.join(home, ".ssh/known_hosts");
	fs.writeFileSync(userFile, "private host keys\n");
	setPeers({
		a: {
			DNSName: dns("iobook"),
			Online: true,
			sshHostKeys: ["ssh-ed25519 TkVX", "ssh-rsa UlNB"],
		},
		b: {
			DNSName: dns("iobox"),
			Online: true,
			sshHostKeys: ["ssh-ed25519 Qk9Y"],
		},
		self: {
			DNSName: dns("io"),
			Online: true,
			sshHostKeys: ["ssh-ed25519 U0VMRg=="],
		},
		vps: {
			DNSName: dns("axat-vps"),
			Online: true,
			sshHostKeys: ["ssh-ed25519 VlBT"],
		},
	});
	expect(await configureFleetSsh(options)).toBe(true);
	expect(fs.readFileSync(file, "utf8")).toBe(
		keyLine("iobook", "ssh-ed25519 TkVX") +
			keyLine("iobook", "ssh-rsa UlNB") +
			keyLine("iobox", "ssh-ed25519 Qk9Y"),
	);
	expect(fs.statSync(file).mode & 0o777).toBe(0o600);
	expect(fs.readFileSync(userFile, "utf8")).toBe("private host keys\n");
	const before = fs.statSync(file, { bigint: true }).mtimeNs;
	expect(await configureFleetSsh(options)).toBe(true);
	expect(fs.statSync(file, { bigint: true }).mtimeNs).toBe(before);
});

it.each([
	"offline",
	"no-keys",
	"missing",
	"ambiguous",
])("retains safe previous keys or skips unmatched host (%s)", async (state) => {
	const old = keyLine("iobook", "ssh-ed25519 T0xE");
	const file = seedFleetKeys(old);
	const peer = {
		DNSName: dns("iobook"),
		Online: state !== "offline",
		sshHostKeys: state === "no-keys" ? [] : ["ssh-ed25519 TkVX"],
	};
	setPeers({
		...(state === "missing"
			? { wrong: { ...peer, DNSName: "iobook.other.ts.net." } }
			: { one: peer }),
		...(state === "ambiguous" ? { two: peer } : {}),
		box: {
			DNSName: dns("iobox"),
			Online: true,
			sshHostKeys: ["ssh-ed25519 Qk9Y"],
		},
	});
	expect(await configureFleetSsh(options)).toBe(true);
	expect(fs.readFileSync(file, "utf8")).toBe(
		(["offline", "no-keys"].includes(state) ? old : "") +
			keyLine("iobox", "ssh-ed25519 Qk9Y"),
	);
	if (["missing", "ambiguous"].includes(state))
		expect(warnings.join(" ")).toContain("iobook");
});

it.each([
	"command",
	"json",
	"peers",
	"keys",
])("leaves previous key file byte-for-byte unchanged on failed refresh (%s)", async (failure) => {
	const old = keyLine("iobook", "ssh-ed25519 T0xE");
	const file = seedFleetKeys(old);
	options.captureCommandImpl = async (command) => {
		calls.push(command);
		if (command === "tailscale debug prefs")
			return { exitCode: 0, stdout: '{"RunSSH":true}' };
		return {
			exitCode: failure === "command" ? 1 : 0,
			stdout:
				failure === "json"
					? "not-json"
					: JSON.stringify({
							BackendState: "Running",
							Peer:
								failure === "peers"
									? []
									: {
											one: {
												DNSName: dns("iobook"),
												Online: true,
												sshHostKeys: ["ssh-ed25519 TkVX\nHost injected"],
											},
										},
						}),
		};
	};
	expect(await configureFleetSsh(options)).toBe(false);
	expect(fs.readFileSync(file, "utf8")).toBe(old);
	expect(warnings.join(" ")).toContain(
		failure === "command" || failure === "json"
			? "Tailscale SSH"
			: "key refresh",
	);
});
it("preserves previous keys if publishing the rebuilt file fails", async () => {
	const old = keyLine("iobook", "ssh-ed25519 T0xE");
	const file = seedFleetKeys(old);
	setPeers({
		one: {
			DNSName: dns("iobook"),
			Online: true,
			sshHostKeys: ["ssh-ed25519 TkVX"],
		},
	});
	options.fsImpl = {
		...fs,
		renameSync: (source, destination) => {
			if (destination === file) throw new Error("publish denied");
			return fs.renameSync(source, destination);
		},
	};
	expect(await configureFleetSsh(options)).toBe(false);
	expect(fs.readFileSync(file, "utf8")).toBe(old);
	expect(fs.readdirSync(path.dirname(file)).sort()).toEqual([
		"config",
		"config.d",
		"known_hosts_fleet",
	]);
});
