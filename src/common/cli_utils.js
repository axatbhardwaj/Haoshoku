import fs from "node:fs";

/**
 * Full set of mutually-exclusive mode flags (commander camelCase keys).
 *
 * `--os` is intentionally NOT in this set: it selects the OS target for the
 * default full-setup path and composes with that path rather than picking a
 * one-shot mode. Every other documented `.option(...)` flag is a mode flag and
 * exactly one may be passed per invocation.
 */
export const MODE_FLAGS = [
	"claude",
	"claudeBackup",
	"claudeRemoteControl",
	"claudeRemoteControlBackup",
	"claudeUpdate",
	"codex",
	"codexBackup",
	"serverT3Code",
	"skills",
	"skillsUpdate",
	"skillsList",
	"ghStack",
	"tailscale",
	"audio",
	"audioBackup",
	"mimeapps",
	"mimeappsBackup",
	"worktreeCleanup",
	"worktreeCleanupBackup",
	"claudeStayAwake",
	"claudeStayAwakeBackup",
	"prWatch",
	"prWatchBackup",
	"deviceType",
	"scripts",
	"workspaces",
	"monitors",
	"hyprmoncfgBackup",
	"omarchyPlugins",
	"kdeConnectCommands",
	"omarchyBar",
	"omarchyBarBackup",
	"omarchyAppearance",
	"34Migrate",
	"braveManagedPolicies",
];

/**
 * Detect the target OS family from an os-release file.
 *
 * Arch family (CachyOS, vanilla Arch, and Arch derivatives) all map to
 * "cachyos"; Debian family (Debian, Ubuntu, and derivatives) maps to
 * "debian-server". Vanilla Arch publishes `ID=arch` with NO `ID_LIKE`, so we
 * must match `id` itself — checking only `ID_LIKE` left vanilla Arch undetected
 * and made `--hyprland` refuse to run.
 *
 * @param {string} [osReleasePath="/etc/os-release"] path to an os-release file
 * @returns {"arch" | "debian-server" | null}
 */
export function detectOS(osReleasePath = "/etc/os-release") {
	try {
		const osRelease = fs.readFileSync(osReleasePath, "utf-8");
		const lines = osRelease.split("\n");
		const info = {};
		for (const line of lines) {
			const [key, value] = line.split("=");
			if (key && value) {
				info[key] = value.replace(/"/g, "");
			}
		}

		const id = info.ID ? info.ID.toLowerCase() : "";
		const idLike = info.ID_LIKE ? info.ID_LIKE.toLowerCase() : "";

		if (
			id.includes("cachyos") ||
			id.includes("arch") ||
			idLike.includes("arch")
		) {
			return "arch";
		}
		if (id.includes("debian") || idLike.includes("debian")) {
			return "debian-server";
		}
	} catch (_e) {
		// Ignore error if file doesn't exist or is unreadable.
	}
	return null;
}

/**
 * Given commander's parsed options object, return the names of every set
 * mode flag (truthy value). Used to reject invocations that pass 2+ mutually
 * exclusive mode flags instead of silently honoring only the first.
 *
 * @param {Record<string, unknown>} options commander options object
 * @returns {string[]} set mode-flag names, in MODE_FLAGS order
 */
export function findActiveModeFlags(options = {}) {
	return MODE_FLAGS.filter(
		(flag) => options[flag] !== undefined && options[flag] !== false,
	);
}
