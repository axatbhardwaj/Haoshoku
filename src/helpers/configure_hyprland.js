import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, runCommand, commandExists } from "../common/utils.js";

const HOME = homedir();
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

/** Bundle directory in the haoshoku repo. Exported so tests can override via injectable opts. */
export const HYPR_BUNDLE_DIR = path.join(PROJECT_ROOT, "configs", "hypr");

export const CAELESTIA_REPO = "https://github.com/caelestia-dots/caelestia.git";

/** Where Caelestia clones itself; its installer symlinks this into ~/.config/hypr/. */
export const CAELESTIA_CLONE_DIR = path.join(
	HOME,
	".local",
	"share",
	"caelestia",
);

export const CAELESTIA_INSTALLER = path.join(
	CAELESTIA_CLONE_DIR,
	"install.fish",
);

/**
 * USER-OWNED include file Caelestia sources from its hyprland.conf.
 * OUTSIDE the symlinked git repo, so writing to it does NOT dirty Caelestia's
 * working tree. This is our hook for the Ocean overlay.
 */
export const CAELESTIA_USER_INCLUDE = path.join(
	HOME,
	".config",
	"caelestia",
	"hypr-user.conf",
);

/** Root of the Ocean overlay on the user's machine. */
export const OCEAN_OVERLAY_DIR = path.join(HOME, ".config", "hypr-ocean");

/** The single line we write into CAELESTIA_USER_INCLUDE to wire up our overlay. */
export const OVERLAY_SOURCE_LINE =
	"source = ~/.config/hypr-ocean/conf.d/*.conf";

/**
 * Packages we install ourselves before Caelestia. walker is intentionally absent —
 * Caelestia ships its own launcher (Quickshell-based). Adding walker would conflict.
 */
export const HYPRLAND_PACKAGES = [
	"hyprland",
	"hyprlock",
	"hypridle",
	"hyprpaper",
	"hyprshot",
	"mako",
	"cliphist",
	"wl-clipboard",
	"polkit-gnome",
	"xdg-desktop-portal-hyprland",
	"qt5-wayland",
	"qt6-wayland",
	"fish",
];

/**
 * Upstream Caelestia commit SHA tested against. Update when bumping.
 * Pin keeps reproducibility: changes in Caelestia's user-include path or
 * installer behavior won't silently break us.
 */
export const CAELESTIA_PINNED_SHA = "main"; // TODO Task 1.6: replace with the SHA you tested

/** Append a single line to a file if it isn't already present (exact-match check). */
export function ensureLineInFile(filePath, line) {
	if (!fs.existsSync(filePath)) {
		throw new Error(`ensureLineInFile: ${filePath} does not exist`);
	}
	const contents = fs.readFileSync(filePath, "utf8");
	const lines = contents.split("\n");
	if (lines.some((l) => l.trim() === line.trim())) {
		return false;
	}
	const needsNewline = contents.length > 0 && !contents.endsWith("\n");
	fs.writeFileSync(
		filePath,
		contents + (needsNewline ? "\n" : "") + line + "\n",
	);
	return true;
}

/** Phase 1 stub. Implemented in Phase 2. */
export async function syncHyprlandOverlay({ home = HOME } = {}) {
	const overlayDir = path.join(home, ".config", "hypr-ocean", "conf.d");
	fs.mkdirSync(overlayDir, { recursive: true });
	log.info(`Overlay directory ensured at ${overlayDir}`);
}

/** Stub. Implemented in Task 1.3 (this same phase). */
// biome-ignore lint/correctness/noUnusedVariables: signature established for Phase 1; impl in Task 1.3
export async function installCaelestia({ home = HOME } = {}) {
	throw new Error("installCaelestia: not yet implemented (Task 1.3)");
}

/** Stub. Implemented in Phase 5. */
// biome-ignore lint/correctness/noUnusedVariables: signature established for Phase 1; impl in Phase 5
export async function backupHyprland({ home = HOME, projectRoot = PROJECT_ROOT } = {}) {
	throw new Error("backupHyprland: not yet implemented (Phase 5)");
}
