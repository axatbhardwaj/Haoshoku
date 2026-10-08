import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log } from "../common/utils.js";

const PRIVATE_ENTRIES = {
	".claude": new Set([
		".credentials.json",
		".claude.json",
		"history.jsonl",
		"sessions",
		"session-env",
		"shell-snapshots",
		"cache",
		"backups",
		"security",
		"mcp-needs-auth-cache.json",
		".last-cleanup",
	]),
	".codex": new Set([
		"auth.json",
		"config.toml",
		"models_cache.json",
		"log",
		"memories",
		"tmp",
	]),
};

function optionalStat(file) {
	try {
		return fs.lstatSync(file);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

/** Keep credentials separate while sharing the rest of each harness home. */
export function configureAgentAccounts({ home = homedir() } = {}) {
	let ok = true;
	for (const [name, privateEntries] of Object.entries(PRIVATE_ENTRIES)) {
		const primary = path.join(home, name);
		const alt = `${primary}-alt`;
		try {
			const altStat = optionalStat(alt);
			if (altStat && !altStat.isDirectory()) {
				log.warning(
					`Agent accounts incomplete: ${alt} must be a real directory; left unchanged.`,
				);
				ok = false;
				continue;
			}
			// Check the denylist even when an entry is absent from the primary home.
			for (const entry of privateEntries) {
				const dest = path.join(alt, entry);
				const existing = optionalStat(dest);
				if (existing?.isSymbolicLink()) {
					log.warning(
						`Agent accounts incomplete: private entry ${dest} is a symlink; accounts are not isolated. Left unchanged.`,
					);
					ok = false;
				} else if (existing) {
					log.info(`Kept private entry ${dest}.`);
				}
			}
			const primaryStat = optionalStat(primary);
			if (!primaryStat) {
				log.info(`Missing primary home ${primary} — skipped.`);
				continue;
			}
			if (!primaryStat.isDirectory()) {
				log.warning(
					`Agent accounts incomplete: ${primary} must be a real directory; left unchanged.`,
				);
				ok = false;
				continue;
			}
			fs.mkdirSync(alt, { recursive: true, mode: 0o700 });
			for (const entry of fs.readdirSync(primary)) {
				const source = path.join(primary, entry);
				const dest = path.join(alt, entry);
				const existing = optionalStat(dest);
				if (privateEntries.has(entry)) {
					if (name === ".codex" && entry === "config.toml" && !existing) {
						fs.writeFileSync(dest, fs.readFileSync(source), {
							flag: "wx",
							mode: 0o600,
						});
					}
					continue;
				}
				if (
					existing?.isSymbolicLink() &&
					fs.existsSync(dest) &&
					fs.realpathSync(dest) === fs.realpathSync(source)
				)
					continue;
				if (existing || !fs.existsSync(source)) {
					log.warning(
						`Agent accounts incomplete: cannot share ${dest} (existing entry or dangling link); left unchanged.`,
					);
					ok = false;
					continue;
				}
				fs.symlinkSync(source, dest);
			}
		} catch {
			log.warning(
				`Agent accounts incomplete at ${alt}; check paths and permissions, then retry. Existing entries left unchanged.`,
			);
			ok = false;
		}
	}
	if (ok)
		log.success("Agent account overlays configured; logins remain manual.");
	return ok;
}
