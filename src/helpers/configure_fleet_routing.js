import { createHash } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PROJECT_ROOT } from "../common/paths.js";
import { validatePolicy } from "./fleet_routing_policy.js";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Refuse redirects through symlinks before creating directories or replacing files.
function inspectPath(target) {
	const parts = path.resolve(target).split(path.sep);
	let current = path.parse(path.resolve(target)).root;
	for (const part of parts.filter(Boolean)) {
		current = path.join(current, part);
		try {
			if (fs.lstatSync(current).isSymbolicLink())
				throw new Error("fleet-config-symlink");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
}

function replace(target, bytes, mode) {
	const staging = `${target}.staging-${crypto.randomUUID()}`;
	try {
		fs.writeFileSync(staging, bytes, { flag: "wx", mode });
		fs.chmodSync(staging, mode);
		fs.renameSync(staging, target);
	} finally {
		if (fs.existsSync(staging)) fs.unlinkSync(staging);
	}
}

/** Deploy reviewed bytes, or roll back this exact account's unchanged receipt. */
export function deployFleetRouting({
	home = homedir(),
	source = path.join(PROJECT_ROOT, "configs/fleet-routing.json"),
	expectedDigest,
	expectedPreviousDigest,
	rollback,
} = {}) {
	const target = path.join(home, ".config/haoshoku/fleet-routing.json");
	inspectPath(target);
	if (rollback) {
		if (rollback.path !== target)
			throw new Error("fleet-config-rollback-account");
		if (!rollback.changed) return { ok: true, changed: false };
		if (digest(fs.readFileSync(target)) !== rollback.sha256)
			throw new Error("fleet-config-rollback-changed");
		if (rollback.backup) {
			if (
				path.dirname(rollback.backup) !== path.dirname(target) ||
				!path.basename(rollback.backup).startsWith("fleet-routing.json.before-")
			)
				throw new Error("fleet-config-rollback-backup");
			inspectPath(rollback.backup);
			const bytes = fs.readFileSync(rollback.backup);
			if (digest(bytes) !== rollback.previousDigest)
				throw new Error("fleet-config-rollback-backup-changed");
			replace(target, bytes, rollback.previousMode);
		} else fs.unlinkSync(target);
		return { ok: true, changed: true };
	}
	const bytes = fs.readFileSync(source);
	const sha256 = digest(bytes);
	if (expectedDigest !== undefined && expectedDigest !== sha256)
		throw new Error("fleet-config-digest-mismatch");
	validatePolicy(bytes);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	let previous = null;
	try {
		previous = fs.readFileSync(target);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (previous?.equals(bytes))
		return { ok: true, changed: false, path: target, sha256 };
	if (previous && digest(previous) !== expectedPreviousDigest)
		throw new Error(
			"fleet-config-local-conflict: inspect and pin existing policy before replacement",
		);
	const previousMode = previous ? fs.statSync(target).mode & 0o777 : null;
	const backup = previous ? `${target}.before-${crypto.randomUUID()}` : null;
	if (backup) fs.writeFileSync(backup, previous, { flag: "wx", mode: 0o600 });
	replace(target, bytes, 0o600);
	return {
		ok: true,
		changed: true,
		path: target,
		sha256,
		backup,
		previousMode,
		previousDigest: previous ? digest(previous) : null,
	};
}
