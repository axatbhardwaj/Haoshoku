import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

export const DEFAULT_GAMING_CONFIG = Object.freeze({
	steamAutostart: true,
	omakadeAutostart: false,
});

export const STEAM_AUTOSTART_LINE =
	'o.exec_on_start("haoshoku-special-workspace numbered-login 2 steam")';
export const OMAKADE_AUTOSTART_LINE =
	'o.exec_on_start("haoshoku-special-workspace numbered-login 2 omakade")';

const AUTOSTART_ANCHOR_COMMENT = "-- Steam stays in the background";
const KDECONNECT_LINE = 'o.exec_on_start("/usr/bin/kdeconnectd")';

function configPath(home) {
	return path.join(home, ".config", "haoshoku", "gaming.json");
}

function validateConfig(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new TypeError("root must be an object");
	}
	if (
		value.steamAutostart !== undefined &&
		typeof value.steamAutostart !== "boolean"
	) {
		throw new TypeError("steamAutostart must be a boolean");
	}
	if (
		value.omakadeAutostart !== undefined &&
		typeof value.omakadeAutostart !== "boolean"
	) {
		throw new TypeError("omakadeAutostart must be a boolean");
	}
}

function readConfig(file, fsImpl, logger) {
	if (!fsImpl.existsSync(file)) return { exists: false, value: {} };
	try {
		const value = JSON.parse(fsImpl.readFileSync(file, "utf8"));
		validateConfig(value);
		return { exists: true, value };
	} catch (error) {
		logger.error(`Invalid ${file}; leaving it untouched (${error.message}).`);
		return null;
	}
}

function writeConfig(file, value, fsImpl, logger) {
	const directory = path.dirname(file);
	const stage = path.join(directory, `.gaming.json.stage-${process.pid}`);
	try {
		fsImpl.mkdirSync(directory, { recursive: true });
		fsImpl.writeFileSync(stage, `${JSON.stringify(value, null, 2)}\n`, {
			mode: 0o600,
		});
		fsImpl.renameSync(stage, file);
		return true;
	} catch (error) {
		logger.error(`Could not update ${file} (${error.message}).`);
		return false;
	} finally {
		if (fsImpl.existsSync(stage)) fsImpl.rmSync(stage, { force: true });
	}
}

export function readGamingConfig({
	home = homedir(),
	fsImpl = fs,
	logger = log,
} = {}) {
	const current = readConfig(configPath(home), fsImpl, logger);
	if (!current) return null;
	return { ...DEFAULT_GAMING_CONFIG, ...current.value };
}

export function ensureGamingConfig({
	home = homedir(),
	fsImpl = fs,
	logger = log,
} = {}) {
	const file = configPath(home);
	const current = readConfig(file, fsImpl, logger);
	if (!current) return false;
	const complete = Object.keys(DEFAULT_GAMING_CONFIG).every((key) =>
		Object.hasOwn(current.value, key),
	);
	if (current.exists && complete) return true;
	if (
		!writeConfig(
			file,
			{ ...DEFAULT_GAMING_CONFIG, ...current.value },
			fsImpl,
			logger,
		)
	) {
		return false;
	}
	logger.success("Gaming autostart defaults configured.");
	return true;
}

export function setGamingConfig(
	updates,
	{ home = homedir(), fsImpl = fs, logger = log } = {},
) {
	const file = configPath(home);
	const current = readConfig(file, fsImpl, logger);
	if (!current) return false;
	const next = {
		...DEFAULT_GAMING_CONFIG,
		...current.value,
		...updates,
	};
	try {
		validateConfig(next);
	} catch (error) {
		logger.error(`Invalid gaming autostart setting (${error.message}).`);
		return false;
	}
	if (!writeConfig(file, next, fsImpl, logger)) return false;
	logger.success("Gaming autostart policy updated.");
	return true;
}

/**
 * Reconcile the two workspace-2 login lines in a workspaces.lua text with the
 * gaming autostart policy. Steam is inserted before Omakade when both are
 * enabled. Returns { changed, text } and never touches window rules or binds.
 */
export function applyGamingAutostartToText(
	text,
	config = DEFAULT_GAMING_CONFIG,
) {
	const steam = config.steamAutostart ?? DEFAULT_GAMING_CONFIG.steamAutostart;
	const omakade =
		config.omakadeAutostart ?? DEFAULT_GAMING_CONFIG.omakadeAutostart;
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const hadTrailingNewline = text.endsWith("\n") || text.endsWith("\r");
	const lines = text.split(/\r\n|\n|\r/);
	if (lines.length > 0 && lines.at(-1) === "") lines.pop();

	const kept = lines.filter(
		(line) =>
			line.trim() !== STEAM_AUTOSTART_LINE &&
			line.trim() !== OMAKADE_AUTOSTART_LINE,
	);

	const desired = [];
	if (steam) desired.push(STEAM_AUTOSTART_LINE);
	if (omakade) desired.push(OMAKADE_AUTOSTART_LINE);

	let anchor = kept.findIndex((line) =>
		line.startsWith(AUTOSTART_ANCHOR_COMMENT),
	);
	if (anchor === -1) {
		anchor = kept.findIndex((line) => line.trim() === KDECONNECT_LINE);
	}
	let next;
	if (anchor === -1) {
		next = [...kept, ...desired];
	} else {
		next = [
			...kept.slice(0, anchor + 1),
			...desired,
			...kept.slice(anchor + 1),
		];
	}

	let result = next.join(newline);
	if (hadTrailingNewline) result += newline;
	if (result === text) return { changed: false, text };
	return { changed: true, text: result };
}

/**
 * Patch a deployed workspaces.lua to match the persisted gaming policy.
 * Skips when the policy is invalid or no overlay is deployed. Uses
 * collision-safe atomic backups like the workspace deploy.
 */
export function syncDeployedGamingAutostart({
	home = homedir(),
	fsImpl = fs,
	logger = log,
	now = Date.now,
} = {}) {
	const gaming = readGamingConfig({ home, fsImpl, logger });
	if (!gaming) return { changed: false, skipped: true };
	const destination = path.join(
		home,
		".config",
		"hypr",
		"haoshoku",
		"workspaces.lua",
	);
	if (!fsImpl.existsSync(destination)) return { changed: false, skipped: true };
	const live = fsImpl.readFileSync(destination, "utf8");
	const patched = applyGamingAutostartToText(live, gaming);
	if (!patched.changed) return { changed: false, skipped: false };

	const base = `${destination}.bak.${now()}`;
	let backup = base;
	let collision = 1;
	while (fsImpl.existsSync(backup)) {
		backup = `${base}.${collision}`;
		collision += 1;
	}
	const stage = path.join(
		path.dirname(destination),
		`.${path.basename(destination)}.tmp.${process.pid}`,
	);
	fsImpl.writeFileSync(backup, fsImpl.readFileSync(destination));
	fsImpl.writeFileSync(stage, patched.text);
	fsImpl.renameSync(stage, destination);
	return { changed: true, skipped: false };
}
