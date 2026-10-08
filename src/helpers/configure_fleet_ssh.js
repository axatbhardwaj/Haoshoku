import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, hostname as getHostname } from "node:os";
import path from "node:path";
import { detectOS } from "../common/cli_utils.js";
import { loadFleet } from "../common/fleet.js";
import { log, runCommand, runCommandCapture } from "../common/utils.js";

function readOptional(file, fsImpl) {
	try {
		return fsImpl.readFileSync(file, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		return "";
	}
}

function writePrivate(file, content, fsImpl) {
	if (!fsImpl.existsSync(file) || readOptional(file, fsImpl) !== content) {
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			fsImpl.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
			fsImpl.renameSync(temporary, file);
		} finally {
			if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
		}
	}
	if ((fsImpl.statSync(file).mode & 0o777) !== 0o600)
		fsImpl.chmodSync(file, 0o600);
}

function refreshFleetKeys(home, fleet, self, status, fsImpl, logger) {
	const peers = status.Peer ?? {};
	if (typeof peers !== "object" || Array.isArray(peers))
		throw new Error("Invalid peer report");
	const file = path.join(home, ".ssh/known_hosts_fleet");
	const previous = readOptional(file, fsImpl).split("\n");
	const lines = [];
	for (const host of fleet.hosts) {
		if (host === self || host.transport !== "tailscale") continue;
		const dnsName = `${host.hostname}.${fleet.tailnet}`;
		const matches = Object.values(peers).filter(
			(peer) => peer?.DNSName === `${dnsName}.`,
		);
		if (matches.length !== 1) {
			logger.warning(
				`Skipping fleet keys for ${host.hostname}: ${matches.length} matching peers.`,
			);
			continue;
		}
		const peer = matches[0];
		const prefix = `${host.hostname},${dnsName} `;
		if (
			peer.Online !== true ||
			peer.sshHostKeys == null ||
			peer.sshHostKeys.length === 0
		) {
			lines.push(...previous.filter((line) => line.startsWith(prefix)));
			continue;
		}
		if (!Array.isArray(peer.sshHostKeys))
			throw new Error(`Invalid keys for ${host.hostname}`);
		for (const key of peer.sshHostKeys) {
			if (
				typeof key !== "string" ||
				!/^[a-zA-Z0-9][a-zA-Z0-9@._+-]* [a-zA-Z0-9+/]+={0,2}(?: [^\r\n]*)?$/.test(
					key.trim(),
				)
			) {
				throw new Error(`Invalid host key for ${host.hostname}`);
			}
			lines.push(prefix + key.trim());
		}
	}
	writePrivate(file, lines.length ? `${lines.join("\n")}\n` : "", fsImpl);
}

function writeSshConfig(home, fleet, self, fsImpl) {
	const sshDir = path.join(home, ".ssh");
	const fragmentDir = path.join(sshDir, "config.d");
	for (const dir of [sshDir, fragmentDir]) {
		fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
		if ((fsImpl.statSync(dir).mode & 0o777) !== 0o700)
			fsImpl.chmodSync(dir, 0o700);
	}
	const blocks = fleet.hosts
		.filter((host) => host !== self)
		.map((host) => {
			const lines = [
				`Host ${host.hostname}`,
				`  HostName ${host.hostname}.${fleet.tailnet}`,
				`  User ${host.sshUser}`,
			];
			if (host.transport === "openssh") {
				if (host.identityFile)
					lines.push(`  IdentityFile ~/.ssh/${host.identityFile}`);
				lines.push("  StrictHostKeyChecking accept-new");
			} else {
				lines.push(
					"  UserKnownHostsFile ~/.ssh/known_hosts_fleet",
					"  StrictHostKeyChecking yes",
				);
			}
			return `${lines.join("\n")}\n`;
		});
	writePrivate(
		path.join(fragmentDir, "haoshoku-fleet"),
		blocks.join("\n"),
		fsImpl,
	);
	const config = path.join(sshDir, "config");
	const include = "Include config.d/haoshoku-fleet\n";
	const existing = readOptional(config, fsImpl).replace(
		/^[\t ]*Include[\t ]+config\.d\/haoshoku-fleet[\t ]*(?:\r?\n|$)/gim,
		"",
	);
	writePrivate(config, include + existing, fsImpl);
}

export function getArchFleetHost({
	hostname = getHostname(),
	osType = detectOS(),
	fleet = loadFleet(),
} = {}) {
	const self = fleet.hosts.find((host) => host.hostname === hostname);
	return self?.os === "arch" && osType === "arch" ? self : null;
}

export async function configureFleetSsh({
	home = homedir(),
	fsImpl = fs,
	hostname = getHostname(),
	osType = detectOS(),
	manifest,
	standalone = false,
	deviceType,
	captureCommandImpl = runCommandCapture,
	runCommandImpl = runCommand,
	logger = log,
} = {}) {
	const fleet = loadFleet({ manifest });
	const self = getArchFleetHost({ hostname, osType, fleet });
	if (!self) {
		if (standalone) logger.warning("--fleet-ssh requires an Arch fleet host.");
		return !standalone;
	}
	const fail = (message) => {
		if ((deviceType ?? self.deviceType) === "iobox") throw new Error(message);
		logger.warning(message);
		return false;
	};
	const inspect = async (command) => {
		const result = await captureCommandImpl(command);
		if (result?.exitCode !== 0) throw new Error(`Cannot inspect ${command}`);
		return JSON.parse(result.stdout);
	};
	let step = "Tailscale SSH";
	try {
		const status = await inspect("tailscale status --json");
		if (status?.BackendState !== "Running")
			throw new Error("Tailscale is not running/logged in");
		let prefs = await inspect("tailscale debug prefs");
		if (prefs?.RunSSH === false) {
			if (!(await runCommandImpl("tailscale set --ssh")))
				throw new Error("tailscale set --ssh failed");
			prefs = await inspect("tailscale debug prefs");
		}
		if (prefs?.RunSSH !== true)
			throw new Error("RunSSH: true was not verified");
		step = "Fleet SSH config";
		writeSshConfig(home, fleet, self, fsImpl);
		step = "Fleet SSH key refresh";
		refreshFleetKeys(home, fleet, self, status, fsImpl, logger);
		return true;
	} catch (error) {
		return fail(
			`${step} failed: ${error.message}. Retry haoshoku --fleet-ssh.`,
		);
	}
}
