import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

export const DEFAULT_CHROMIUM_PROFILES = Object.freeze([
	Object.freeze({
		id: "flux",
		class: "chromium-flux",
		monitor: "DP-1",
		default: true,
	}),
	Object.freeze({
		id: "defi",
		class: "chromium-defi",
		monitor: "DP-1",
	}),
]);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidProfile(profile) {
	return (
		isObject(profile) &&
		typeof profile.id === "string" &&
		SAFE_ID.test(profile.id) &&
		typeof profile.class === "string" &&
		SAFE_VALUE.test(profile.class) &&
		typeof profile.monitor === "string" &&
		SAFE_VALUE.test(profile.monitor) &&
		(profile.default === undefined || typeof profile.default === "boolean")
	);
}

export function isValidChromiumProfileRegistry(profiles) {
	if (!Array.isArray(profiles) || profiles.length === 0) return false;
	if (!profiles.every(isValidProfile)) return false;

	const ids = new Set(profiles.map((profile) => profile.id));
	const classes = new Set(profiles.map((profile) => profile.class));
	const defaultCount = profiles.filter((profile) => profile.default === true).length;
	return (
		ids.size === profiles.length &&
		classes.size === profiles.length &&
		defaultCount === 1
	);
}

function defaultProfiles() {
	return DEFAULT_CHROMIUM_PROFILES.map((profile) => ({ ...profile }));
}

/**
 * Seed the Chromium profile registry used by the managed browser scripts.
 * Valid user registries are left byte-for-byte unchanged; malformed JSON is
 * left untouched so the runtime scripts can safely use their shipped fallback.
 *
 * @param {{ home?: string, fsImpl?: typeof fs }} opts
 */
export function configureChromiumProfiles({
	home = homedir(),
	fsImpl = fs,
} = {}) {
	const configFile = path.join(home, ".haoshoku.json");
	let config = {};

	if (fsImpl.existsSync(configFile)) {
		try {
			config = JSON.parse(fsImpl.readFileSync(configFile, "utf8"));
		} catch {
			log.warning("Malformed ~/.haoshoku.json; leaving it unchanged.");
			return { changed: false, skipped: true };
		}
		if (!isObject(config)) {
			log.warning("~/.haoshoku.json must be an object; leaving it unchanged.");
			return { changed: false, skipped: true };
		}
	}

	if (isValidChromiumProfileRegistry(config.chromiumProfiles)) {
		return { changed: false, skipped: false };
	}

	config.chromiumProfiles = defaultProfiles();
	fsImpl.writeFileSync(configFile, `${JSON.stringify(config, null, "\t")}\n`);
	log.info("Seeded Haoshoku Chromium profile registry.");
	return { changed: true, skipped: false };
}
