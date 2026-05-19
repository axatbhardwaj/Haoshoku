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

/**
 * Parse a KDE color scheme INI string. Returns a flat map of "Section.Key" → "r,g,b".
 * Pure function — no IO. Ignores comments, blank lines, non-triplet values.
 */
export function parseOceanPalette(iniText) {
	const result = {};
	let section = null;
	for (const rawLine of iniText.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || line.startsWith(";")) continue;
		const sectionMatch = line.match(/^\[(.+)\]$/);
		if (sectionMatch) {
			section = sectionMatch[1];
			continue;
		}
		if (!section) continue;
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const key = line.slice(0, eq).trim();
		const value = line.slice(eq + 1).trim();
		if (/^\d+,\d+,\d+$/.test(value)) {
			result[`${section}.${key}`] = value;
		}
	}
	return result;
}

/** Convert a KDE "r,g,b" string to Hyprland's "rgba(rrggbbaa)" hex form. Pure. */
export function kdeRgbToHyprlandRgba(rgb, alphaHex = "ff") {
	const parts = rgb.split(",").map((n) => Number.parseInt(n.trim(), 10));
	if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
		throw new Error(`kdeRgbToHyprlandRgba: invalid input "${rgb}"`);
	}
	const hex = parts.map((n) => n.toString(16).padStart(2, "0")).join("");
	return `rgba(${hex}${alphaHex})`;
}

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
	fs.writeFileSync(filePath, `${contents}${needsNewline ? "\n" : ""}${line}\n`);
	return true;
}

/** Phase 1 stub. Implemented in Phase 2. */
export async function syncHyprlandOverlay({ home = HOME } = {}) {
	const overlayDir = path.join(home, ".config", "hypr-ocean", "conf.d");
	fs.mkdirSync(overlayDir, { recursive: true });
	log.info(`Overlay directory ensured at ${overlayDir}`);
}

export async function checkoutPinnedCaelestia({
	cloneDir,
	pinnedSha = CAELESTIA_PINNED_SHA,
	run = runCommand,
} = {}) {
	if (pinnedSha === "main") return false;

	log.info(`Checking out pinned Caelestia commit ${pinnedSha}`);
	const checkedOut = await run(`git checkout ${pinnedSha}`, { cwd: cloneDir });
	if (!checkedOut) {
		throw new Error(`Failed to checkout pinned Caelestia commit ${pinnedSha}`);
	}
	return true;
}

/**
 * Clone or update Caelestia and run its installer. Idempotent: re-run safe.
 * After install, ensure the user-owned hypr-user.conf sources our Ocean overlay
 * directory. We never write to Caelestia's tracked hyprland.conf.
 */
export async function installCaelestia({ home = HOME } = {}) {
	const caelestiaCloneDir = path.join(home, ".local", "share", "caelestia");
	const caelestiaInstaller = path.join(caelestiaCloneDir, "install.fish");
	const userInclude = path.join(home, ".config", "caelestia", "hypr-user.conf");
	const oceanOverlayDir = path.join(home, ".config", "hypr-ocean", "conf.d");

	if (!(await commandExists("fish"))) {
		log.error(
			"fish is required by Caelestia's install.fish — installing fish first.",
		);
		const ok = await runCommand("sudo pacman -S --needed --noconfirm fish");
		if (!ok) throw new Error("Failed to install fish");
	}

	log.info("Installing Hyprland package set via pacman...");
	const pkgInstall = await runCommand(
		`sudo pacman -S --needed --noconfirm ${HYPRLAND_PACKAGES.join(" ")}`,
	);
	if (!pkgInstall) {
		log.warning(
			"Hyprland package install had issues; Caelestia installer may catch the rest.",
		);
	}

	if (fs.existsSync(path.join(caelestiaCloneDir, ".git"))) {
		log.info(
			`Caelestia already cloned at ${caelestiaCloneDir}; pulling updates.`,
		);
		const pulled = await runCommand("git pull --ff-only", {
			cwd: caelestiaCloneDir,
		});
		if (!pulled) {
			log.warning("git pull failed; continuing with existing clone.");
		}
	} else {
		log.info(`Cloning Caelestia into ${caelestiaCloneDir}...`);
		fs.mkdirSync(path.dirname(caelestiaCloneDir), { recursive: true });
		const cloned = await runCommand(
			`git clone ${CAELESTIA_REPO} ${caelestiaCloneDir}`,
		);
		if (!cloned) throw new Error("Caelestia clone failed");
	}

	await checkoutPinnedCaelestia({ cloneDir: caelestiaCloneDir });

	log.info(
		"Running Caelestia install.fish (may prompt for sudo + package confirmations)...",
	);
	const installed = await runCommand(`fish ${caelestiaInstaller}`);
	if (!installed) throw new Error("Caelestia install.fish exited non-zero");

	// Caelestia's installer must create ~/.config/caelestia/hypr-user.conf as a
	// user-owned include. Missing = upstream layout drift — hand back loudly
	// rather than silently masking the breakage.
	if (!fs.existsSync(userInclude)) {
		throw new Error(
			`Expected Caelestia user-include at ${userInclude} but it does not exist after install.fish. ` +
				`Caelestia's upstream layout may have changed. Investigate the new include path and update CAELESTIA_USER_INCLUDE.`,
		);
	}

	fs.mkdirSync(oceanOverlayDir, { recursive: true });

	const appended = ensureLineInFile(userInclude, OVERLAY_SOURCE_LINE);
	if (appended) {
		log.success(`Wired ${OVERLAY_SOURCE_LINE} into ${userInclude}`);
	} else {
		log.info("Overlay source line already present; skipping.");
	}
}

/** Stub. Implemented in Phase 5. */
export async function backupHyprland({
	home: _home = HOME,
	projectRoot: _projectRoot = PROJECT_ROOT,
} = {}) {
	throw new Error("backupHyprland: not yet implemented (Phase 5)");
}
