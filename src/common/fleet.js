import defaultManifest from "../../configs/fleet.json";
import { DEVICE_TYPES } from "./utils.js";

const HOST_FIELDS = new Set([
	"hostname",
	"role",
	"os",
	"deviceType",
	"sshUser",
	"transport",
	"identityFile",
]);
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function requireValid(condition, message) {
	if (!condition) throw new Error(`Invalid fleet manifest: ${message}`);
}

function requireObject(value, fields, label) {
	requireValid(
		value && typeof value === "object" && !Array.isArray(value),
		`${label} must be an object`,
	);
	for (const key of Object.keys(value)) {
		requireValid(fields.has(key), `${label} has unsupported field ${key}`);
	}
}

export function loadFleet({ manifest = defaultManifest } = {}) {
	requireObject(manifest, new Set(["tailnet", "hosts"]), "fleet");
	requireValid(
		typeof manifest.tailnet === "string" &&
			manifest.tailnet.includes(".") &&
			/[a-z]/i.test(manifest.tailnet.split(".").at(-1)) &&
			manifest.tailnet.split(".").every((label) => DNS_LABEL.test(label)),
		"tailnet must be a DNS suffix",
	);
	requireValid(Array.isArray(manifest.hosts), "hosts must be an array");
	const hostnames = new Set();
	for (const host of manifest.hosts) {
		requireObject(host, HOST_FIELDS, "host");
		requireValid(
			typeof host.hostname === "string" && DNS_LABEL.test(host.hostname),
			"hostname must be a DNS label",
		);
		const hostname = host.hostname.toLowerCase();
		requireValid(
			!hostnames.has(hostname),
			`duplicate hostname ${host.hostname}`,
		);
		hostnames.add(hostname);
		requireValid(
			["pc", "laptop", "agent box", "vps"].includes(host.role),
			`${host.hostname}: invalid role`,
		);
		requireValid(
			["arch", "debian"].includes(host.os),
			`${host.hostname}: invalid os`,
		);
		requireValid(
			host.os === "arch"
				? DEVICE_TYPES.includes(host.deviceType)
				: !("deviceType" in host),
			`${host.hostname}: deviceType must be valid for Arch and absent for Debian`,
		);
		requireValid(
			typeof host.sshUser === "string" &&
				/^[a-z_][a-z0-9_-]*\$?$/i.test(host.sshUser),
			`${host.hostname}: invalid sshUser`,
		);
		requireValid(
			["tailscale", "openssh"].includes(host.transport),
			`${host.hostname}: invalid transport`,
		);
		if ("identityFile" in host) {
			requireValid(
				host.transport === "openssh" &&
					typeof host.identityFile === "string" &&
					/^[a-z0-9_.-]+$/i.test(host.identityFile) &&
					![".", ".."].includes(host.identityFile),
				`${host.hostname}: identityFile must be a plain filename for openssh only`,
			);
		}
	}
	return manifest;
}

export function lookupHost(hostname, options) {
	return (
		loadFleet(options).hosts.find((host) => host.hostname === hostname) ?? null
	);
}
