import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
	commandExists,
	copyDirRecursive,
	log,
	runCommand,
} from "../common/utils.js";

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
 * KDE action ID → Hyprland dispatcher + args.
 * Each entry returns a string that becomes the RHS of a `bind = MODS, KEY, ...` line.
 *
 * Real KDE action IDs verified against the user's live configs/kde_shortcuts.kksrc:
 * kmix uses snake_case (increase_volume, mic_mute, …); powerdevil uses Title Case
 * with the word "Screen" (Increase Screen Brightness); mediacontrol uses lowercase
 * (nextmedia, playpausemedia, …). Don't confuse them with their friendly-name
 * "Increase Volume" — that's the localized description after the second comma.
 *
 * NOTE on launcher: KRunner / "Run Command" / "Show Application Launcher" are
 * INTENTIONALLY OMITTED. Caelestia's Quickshell ships its own launcher on
 * `Super` by default. Custom `[services][X.desktop]` launchers ARE handled
 * specially by `serviceLauncherDispatcher` below — they emit `gtk-launch X`.
 */
const KDE_TO_HYPRLAND_ACTIONS = {
	// kwin — window management
	"Window Close": "killactive",
	"Window Maximize": "fullscreen, 1",
	"Window Fullscreen": "fullscreen, 0",
	"Window Minimize": "movetoworkspacesilent, special",
	"Window Move": "movewindow",
	"Window Resize": "resizewindow",
	"Switch Window Up": "movefocus, u",
	"Switch Window Down": "movefocus, d",
	"Switch Window Left": "movefocus, l",
	"Switch Window Right": "movefocus, r",
	"Switch to Desktop 1": "workspace, 1",
	"Switch to Desktop 2": "workspace, 2",
	"Switch to Desktop 3": "workspace, 3",
	"Switch to Desktop 4": "workspace, 4",
	"Switch to Desktop 5": "workspace, 5",
	"Switch to Desktop 6": "workspace, 6",
	"Switch to Desktop 7": "workspace, 7",
	"Switch to Desktop 8": "workspace, 8",
	"Switch to Desktop 9": "workspace, 9",
	"Window to Desktop 1": "movetoworkspace, 1",
	"Window to Desktop 2": "movetoworkspace, 2",
	"Window to Desktop 3": "movetoworkspace, 3",
	"Window to Desktop 4": "movetoworkspace, 4",
	"Window to Desktop 5": "movetoworkspace, 5",
	"Window to Desktop 6": "movetoworkspace, 6",
	"Window to Desktop 7": "movetoworkspace, 7",
	"Window to Desktop 8": "movetoworkspace, 8",
	"Window to Desktop 9": "movetoworkspace, 9",
	"Show Desktop": "exec, hyprctl dispatch togglespecialworkspace",
	"Window to Next Screen": "movewindow, mon:+1",
	"Window to Previous Screen": "movewindow, mon:-1",
	"Kill Window": "exec, hyprctl kill",
	// Quick Tile — KDE-specific snap; Hyprland approximation via splitratio
	// adjustments. Not pixel-identical but close in feel.
	"Window Quick Tile Left": "movewindow, l",
	"Window Quick Tile Right": "movewindow, r",
	"Window Quick Tile Top": "movewindow, u",
	"Window Quick Tile Bottom": "movewindow, d",
	// Window to Desktop directional — map to adjacent workspace numbers
	"Window One Desktop Up": "movetoworkspace, -1",
	"Window One Desktop Down": "movetoworkspace, +1",
	"Window One Desktop to the Left": "movetoworkspace, -1",
	"Window One Desktop to the Right": "movetoworkspace, +1",
	// Switch (focus) One Desktop directional — same workspace nav without moving window
	"Switch One Desktop Up": "workspace, -1",
	"Switch One Desktop Down": "workspace, +1",
	"Switch One Desktop to the Left": "workspace, -1",
	"Switch One Desktop to the Right": "workspace, +1",
	// Walk Through Windows of Current Application — Hyprland's group cycle
	"Walk Through Windows of Current Application": "cyclenext, sameclass",
	"Walk Through Windows of Current Application (Reverse)":
		"cyclenext, prev sameclass",
	// kwin Activate Window Demanding Attention — Hyprland focuses urgent
	"Activate Window Demanding Attention": "focusurgentorlast",
	// Switch Activity — Hyprland doesn't have activities; map to special
	// workspaces 1..3 as the closest behavioral match (isolated workspace).
	"Walk Through Windows": "cyclenext",
	"Walk Through Windows (Reverse)": "cyclenext, prev",

	// Krohnkite focus directions — Hyprland is itself a tiling WM, so these
	// map to the same movefocus dispatch as kwin's Switch Window equivalents.
	KrohnkiteFocusUp: "movefocus, u",
	KrohnkiteFocusDown: "movefocus, d",
	KrohnkiteFocusLeft: "movefocus, l",
	KrohnkiteFocusRight: "movefocus, r",
	KrohnkiteFocusNext: "cyclenext",
	KrohnkiteFocusPrev: "cyclenext, prev",
	// Krohnkite shuffle/shift — Hyprland's swapwindow
	KrohnkiteShuffleUp: "swapwindow, u",
	KrohnkiteShuffleDown: "swapwindow, d",
	KrohnkiteShuffleLeft: "swapwindow, l",
	KrohnkiteShuffleRight: "swapwindow, r",
	KrohnkiteShiftUp: "swapwindow, u",
	KrohnkiteShiftDown: "swapwindow, d",
	KrohnkiteShiftLeft: "swapwindow, l",
	KrohnkiteShiftRight: "swapwindow, r",
	KrohnkiteToggleFloat: "togglefloating",
	// Real kksrc has a lowercase typo: KrohnkitegrowWidth (single 'g')
	KrohnkitegrowWidth: "resizeactive, 50 0",
	// Krohnkite resize — Hyprland resizeactive
	KrohnkiteIncrease: "resizeactive, 50 0",
	KrohnkiteDecrease: "resizeactive, -50 0",
	KrohnkiteGrowHeight: "resizeactive, 0 50",
	KrohnkiteShrinkHeight: "resizeactive, 0 -50",
	KrohnkiteGrowWidth: "resizeactive, 50 0",
	KrohnkiteShrinkWidth: "resizeactive, -50 0",
	// Krohnkite layout — Hyprland layout cycling
	KrohnkiteNextLayout: "layoutmsg, cyclenext",
	KrohnkitePreviousLayout: "layoutmsg, cycleprev",
	KrohnkiteMonocleLayout: "fullscreen, 1",
	KrohnkiteFloatAll: "togglefloating",
	KrohnkiteFloat: "togglefloating",

	// ksmserver — session lifecycle
	"Lock Session": "exec, hyprlock --config ~/.config/hypr-ocean/hyprlock.conf",
	"Log Out": "exec, hyprctl dispatch exit",

	// spectacle — screenshots
	RectangularRegionScreenShot: "exec, hyprshot -m region",
	FullScreenScreenShot: "exec, hyprshot -m output",
	ActiveWindowScreenShot: "exec, hyprshot -m window",

	// kmix — REAL action IDs (snake_case). Emit Hyprland exec via wpctl.
	increase_volume: "exec, wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+",
	decrease_volume: "exec, wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-",
	increase_volume_small: "exec, wpctl set-volume @DEFAULT_AUDIO_SINK@ 1%+",
	decrease_volume_small: "exec, wpctl set-volume @DEFAULT_AUDIO_SINK@ 1%-",
	mute: "exec, wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle",
	mic_mute: "exec, wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle",
	increase_microphone_volume:
		"exec, wpctl set-volume @DEFAULT_AUDIO_SOURCE@ 5%+",
	decrease_microphone_volume:
		"exec, wpctl set-volume @DEFAULT_AUDIO_SOURCE@ 5%-",

	// org_kde_powerdevil — REAL action IDs (include "Screen").
	"Increase Screen Brightness": "exec, brightnessctl set +5%",
	"Decrease Screen Brightness": "exec, brightnessctl set 5%-",
	"Increase Screen Brightness Small": "exec, brightnessctl set +1%",
	"Decrease Screen Brightness Small": "exec, brightnessctl set 1%-",
	"Increase Keyboard Brightness":
		"exec, brightnessctl --device='*kbd_backlight*' set +5%",
	"Decrease Keyboard Brightness":
		"exec, brightnessctl --device='*kbd_backlight*' set 5%-",
	"Toggle Keyboard Backlight":
		"exec, brightnessctl --device='*kbd_backlight*' set 50%",
	Sleep: "exec, systemctl suspend",
	Hibernate: "exec, systemctl hibernate",
	PowerOff: "exec, systemctl poweroff",
	PowerDown: "exec, systemctl poweroff",

	// mediacontrol — REAL action IDs (lowercase concatenated).
	playpausemedia: "exec, playerctl play-pause",
	playmedia: "exec, playerctl play",
	pausemedia: "exec, playerctl pause",
	stopmedia: "exec, playerctl stop",
	nextmedia: "exec, playerctl next",
	previousmedia: "exec, playerctl previous",
};

/**
 * Translate KDE key names to Hyprland key names. KDE uses human-readable
 * multimedia key names with spaces; Hyprland uses XF86<Foo> standard names.
 * Anything not in this map falls back to .toUpperCase().
 */
const KDE_KEY_TO_HYPRLAND_KEY = {
	"Volume Up": "XF86AudioRaiseVolume",
	"Volume Down": "XF86AudioLowerVolume",
	"Volume Mute": "XF86AudioMute",
	"Microphone Mute": "XF86AudioMicMute",
	// "Microphone Volume Up/Down" — no real keysym exists; intentionally NOT
	// aliased to XF86AudioMicMute (doing so would shadow the real mic-mute
	// binding via dedupe). Let the translator emit UNTRANSLATED for those.
	"Monitor Brightness Up": "XF86MonBrightnessUp",
	"Monitor Brightness Down": "XF86MonBrightnessDown",
	"Keyboard Brightness Up": "XF86KbdBrightnessUp",
	"Keyboard Brightness Down": "XF86KbdBrightnessDown",
	"Keyboard Light On/Off": "XF86KbdLightOnOff",
	"Media Next": "XF86AudioNext",
	"Media Previous": "XF86AudioPrev",
	"Media Play": "XF86AudioPlay",
	"Media Pause": "XF86AudioPause",
	"Media Stop": "XF86AudioStop",
	Sleep: "XF86Sleep",
	Hibernate: "XF86Hibernate",
	"Power Off": "XF86PowerOff",
	"Power Down": "XF86PowerDown",
};

/**
 * After applying the key-name map, a fallback `.toUpperCase()` can leave a key
 * with spaces (e.g. "MICROPHONE VOLUME UP") — Hyprland can't parse those.
 * Empty keys (e.g. trailing-`+` bindings like "Meta+") are also invalid; without
 * this guard they would emit `bind = SUPER, , dispatcher` — malformed syntax.
 */
function isValidHyprlandKey(key) {
	return key.length > 0 && !/\s/.test(key);
}

/**
 * Translate KDE modifier syntax (Ctrl+Alt+Shift+Meta+Key) to Hyprland's
 * (CTRL_ALT_SHIFT_META, KEY). Hyprland concatenates mods with underscores in
 * its `bind = MODS, KEY, ...` form.
 */
function translateModifiers(kdeBinding) {
	const tokens = kdeBinding.split("+");
	const rawKey = tokens.pop();
	// Hyprland accepts both META and SUPER for the Windows/Command key; SUPER
	// is the community-idiomatic spelling, so we emit that.
	const map = { Ctrl: "CTRL", Alt: "ALT", Shift: "SHIFT", Meta: "SUPER" };
	// Dedupe modifier tokens — e.g. "Ctrl+Alt+Ctrl+X" would otherwise emit
	// "CTRL_ALT_CTRL" which Hyprland rejects as an unknown modifier string.
	const seen = new Set();
	const mods = tokens
		.map((t) => map[t] || t.toUpperCase())
		.filter((m) => {
			if (seen.has(m)) return false;
			seen.add(m);
			return true;
		})
		.join("_");
	const key = KDE_KEY_TO_HYPRLAND_KEY[rawKey] || rawKey.toUpperCase();
	return { mods, key };
}

/**
 * If a section name matches `[services][X.desktop]` (KDE's custom-launcher
 * pattern from kglobalshortcutsrc / kksrc), return the launcher dispatcher.
 * Otherwise null. Picks gtk-launch since it's part of GTK and ships on all
 * desktop distros — works for both regular .desktop files and Chrome PWAs.
 */
function serviceLauncherDispatcher(section, actionName) {
	if (actionName !== "_launch") return null;
	const match = section.match(/^services\]\[(.+?)\.desktop$/);
	if (!match) return null;
	return `exec, gtk-launch ${match[1]}`;
}

/**
 * Translate a KDE kksrc string into a Hyprland conf.d/20-keybinds.conf body.
 * Pure: string in → string out. Unmapped KDE actions become `# UNTRANSLATED`
 * comment lines so the user can hand-fill if needed.
 */
export function translateKdeShortcutsToHyprland(kksrcText) {
	const lines = [
		"# Translated from kde_shortcuts.kksrc — DO NOT EDIT BY HAND",
		"# Regenerate with: bun haoshoku.js --hyprland-keybinds",
		"",
	];
	const untranslated = [];
	const seenBindings = new Set();

	let section = null;
	for (const rawLine of kksrcText.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const secMatch = line.match(/^\[(.+)\]$/);
		if (secMatch) {
			section = secMatch[1];
			continue;
		}
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const actionName = line.slice(0, eq).trim();
		if (actionName === "_k_friendly_name") continue;
		const valueParts = line.slice(eq + 1).split(",");
		// KDE separates alternative bindings with a LITERAL "\t" (backslash+t),
		// not a real tab character. Split on the two-character sequence.
		const primaryBinding = (valueParts[0] || "").split("\\t")[0].trim();
		if (!primaryBinding || primaryBinding.toLowerCase() === "none") continue;

		const dispatcher =
			KDE_TO_HYPRLAND_ACTIONS[actionName] ||
			serviceLauncherDispatcher(section, actionName);
		if (!dispatcher) {
			untranslated.push(
				`# UNTRANSLATED: ${actionName} (section=[${section}], binding=${primaryBinding})`,
			);
			continue;
		}

		const { mods, key } = translateModifiers(primaryBinding);

		// Reject keys that fall through .toUpperCase() with spaces — those are
		// not real xkb/XF86 keysyms and Hyprland won't match them.
		if (!isValidHyprlandKey(key)) {
			untranslated.push(
				`# UNTRANSLATED: ${actionName} (section=[${section}], binding=${primaryBinding} — no Hyprland key for "${primaryBinding.split("+").pop()}")`,
			);
			continue;
		}

		const prefix = mods ? `${mods}, ${key}` : `, ${key}`;
		const bindLine = `bind = ${prefix}, ${dispatcher}`;
		// Dedupe: if this exact (mods, key) was already bound, comment the dupe.
		const sigKey = `${mods}|${key}`;
		if (seenBindings.has(sigKey)) {
			lines.push(`# DUPLICATE BINDING (${prefix} already bound): ${bindLine}`);
		} else {
			seenBindings.add(sigKey);
			lines.push(bindLine);
		}
	}

	if (untranslated.length > 0) {
		lines.push("");
		lines.push(
			"# === Actions with no Hyprland equivalent — translate manually ===",
		);
		for (const ut of untranslated) lines.push(ut);
	}

	return `${lines.join("\n")}\n`;
}

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
	// Each component must fit one byte. Out-of-range values would otherwise
	// produce wrong-length hex segments (e.g. 256 → "100", -1 → "-1") and
	// corrupt the rgba() token, which Hyprland silently rejects file-wide.
	if (parts.some((n) => n < 0 || n > 255)) {
		throw new Error(
			`kdeRgbToHyprlandRgba: component out of 0-255 range in "${rgb}"`,
		);
	}
	// alphaHex is interpolated verbatim — must be exactly 2 hex chars.
	if (!/^[0-9a-fA-F]{2}$/.test(alphaHex)) {
		throw new Error(
			`kdeRgbToHyprlandRgba: alphaHex must be 2 hex chars, got "${alphaHex}"`,
		);
	}
	const hex = parts.map((n) => n.toString(16).padStart(2, "0")).join("");
	return `rgba(${hex}${alphaHex})`;
}

/** Append a single line to a file if it isn't already present (exact-match check). */
export function ensureLineInFile(filePath, line) {
	if (!fs.existsSync(filePath)) {
		throw new Error(`ensureLineInFile: ${filePath} does not exist`);
	}
	// Reject embedded newlines — the function name says "line" (singular). Without
	// this guard, a caller passing "source = a\nexec-once = evil" would append
	// arbitrary extra Hyprland directives, AND the trim-based dedupe would always
	// miss (single-line entries in the file never equal the multi-line blob).
	if (line.includes("\n")) {
		throw new Error("ensureLineInFile: line must not contain a newline");
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

/**
 * Deploy Ocean overlay from configs/hypr/ to ~/.config/hypr-ocean/ (and ~/.config/mako/).
 * Idempotent: re-running converges to the bundle's state, overwriting per file.
 *
 * `home` and `projectRoot` are injectable so tests run against tmp dirs.
 */
export async function syncHyprlandOverlay({
	home = HOME,
	projectRoot = PROJECT_ROOT,
} = {}) {
	const overlayDir = path.join(home, ".config", "hypr-ocean");
	const overlayConfDDir = path.join(overlayDir, "conf.d");
	const overlayWallpaperDir = path.join(overlayDir, "wallpapers");
	const makoDir = path.join(home, ".config", "mako");

	const bundleDir = path.join(projectRoot, "configs", "hypr");
	const bundleConfDDir = path.join(bundleDir, "conf.d");
	const bundleMakoDir = path.join(bundleDir, "mako");
	const wallpaperBundleDir = path.join(projectRoot, "deskback");

	fs.mkdirSync(overlayConfDDir, { recursive: true });
	fs.mkdirSync(overlayWallpaperDir, { recursive: true });

	if (fs.existsSync(bundleConfDDir)) {
		copyDirRecursive(bundleConfDDir, overlayConfDDir);
		log.info("Synced conf.d/ overlays");
	}

	for (const file of ["hyprpaper.conf", "hyprlock.conf", "hypridle.conf"]) {
		const src = path.join(bundleDir, file);
		if (fs.existsSync(src)) {
			fs.copyFileSync(src, path.join(overlayDir, file));
			log.info(`Synced ${file}`);
		}
	}

	if (fs.existsSync(bundleMakoDir)) {
		copyDirRecursive(bundleMakoDir, makoDir);
		log.info("Synced mako config");
	}

	if (fs.existsSync(wallpaperBundleDir)) {
		for (const entry of fs.readdirSync(wallpaperBundleDir)) {
			if (/\.(jpe?g|png|webp)$/i.test(entry)) {
				fs.copyFileSync(
					path.join(wallpaperBundleDir, entry),
					path.join(overlayWallpaperDir, entry),
				);
			}
		}
		log.info("Synced wallpapers");
	}

	log.success(`Ocean overlay synced to ${overlayDir}`);
}

export async function checkoutPinnedCaelestia({
	cloneDir,
	pinnedSha = CAELESTIA_PINNED_SHA,
	run = runCommand,
} = {}) {
	if (pinnedSha === "main") return false;

	// pinnedSha flows into a shell-interpolated command in runCommand (utils.js
	// auto-detects shell metacharacters and routes via `sh -c`). Reject anything
	// that isn't a plain hex SHA before constructing the command — a value like
	// "abc; rm -rf $HOME" would otherwise execute as `sh -c "git checkout abc; rm -rf $HOME"`.
	if (!/^[a-f0-9]{7,40}$/i.test(pinnedSha)) {
		throw new Error(
			`checkoutPinnedCaelestia: pinnedSha "${pinnedSha}" is not a valid hex SHA (7-40 chars)`,
		);
	}

	log.info(`Checking out pinned Caelestia commit ${pinnedSha}`);
	const checkedOut = await run(`git checkout ${pinnedSha}`, { cwd: cloneDir });
	if (!checkedOut) {
		throw new Error(`Failed to checkout pinned Caelestia commit ${pinnedSha}`);
	}
	return true;
}

const CAELESTIA_LEAF_INSTALL_COMMAND =
	"paru -S --needed --noconfirm caelestia-cli caelestia-shell";

export async function recoverCaelestiaPackages({
	run = runCommand,
	exists = commandExists,
} = {}) {
	await run(CAELESTIA_LEAF_INSTALL_COMMAND);
	if (await exists("caelestia")) return true;

	log.warning(
		"Explicit Caelestia package install failed. Refreshing CachyOS mirrors/package databases once before retrying...",
	);

	if (await exists("cachyos-rate-mirrors")) {
		const mirrorsRefreshed = await run("sudo cachyos-rate-mirrors");
		if (!mirrorsRefreshed) {
			log.warning(
				"cachyos-rate-mirrors failed; continuing with pacman database refresh.",
			);
		}
	}

	const databasesRefreshed = await run("sudo pacman -Syy --noconfirm");
	if (!databasesRefreshed) {
		log.warning(
			"pacman database refresh failed; retrying Caelestia packages once anyway.",
		);
	}

	const secondAttempt = await run(CAELESTIA_LEAF_INSTALL_COMMAND);
	return secondAttempt && (await exists("caelestia"));
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

	// install.fish invokes `paru -Ui` on the local PKGBUILD to install the
	// caelestia-meta umbrella (which pulls in caelestia-cli + caelestia-shell).
	// If a transitive dep (e.g. python-uv) fails to fetch from an AUR mirror,
	// install.fish silently continues to the config-copy phase but the
	// `caelestia` CLI never lands. Without it, `exec-once = caelestia shell -d`
	// in execs.conf is a no-op and the user boots into a bare Hyprland session.
	// Detect-and-recover: try paru -S explicitly for the two leaf packages.
	if (!(await commandExists("caelestia"))) {
		log.warning(
			"caelestia CLI missing after install.fish (likely an AUR mirror failure during paru -Ui). " +
				"Retrying with explicit `paru -S caelestia-cli caelestia-shell`...",
		);
		const recovered = await recoverCaelestiaPackages();
		if (!recovered || !(await commandExists("caelestia"))) {
			throw new Error(
				"caelestia CLI still missing after mirror/database refresh and retry. " +
					"Try `sudo cachyos-rate-mirrors && sudo pacman -Syyu` to refresh mirrors and upgrade, then re-run `bun haoshoku.js --hyprland`. " +
					"If that fails, install caelestia-cli + caelestia-shell manually and re-run.",
			);
		}
	}

	// Caelestia creates ~/.config/caelestia/hypr-user.conf LAZILY on first
	// Hyprland boot via the configs.fish exec hook in hyprland.conf. Since
	// haoshoku --hyprland runs from your KDE session, that boot hasn't
	// happened yet. Pre-create the file ourselves (same touch-empty behavior
	// configs.fish would do), so our `source = ` line lands somewhere Caelestia
	// will read on first boot. Also pre-create hypr-vars.conf for symmetry.
	fs.mkdirSync(path.dirname(userInclude), { recursive: true });
	for (const f of ["hypr-vars.conf", "hypr-user.conf"]) {
		const target = path.join(path.dirname(userInclude), f);
		if (!fs.existsSync(target)) {
			fs.writeFileSync(target, "");
			log.info(
				`Pre-created empty ${target} (Caelestia would create lazily on first boot)`,
			);
		}
	}

	fs.mkdirSync(oceanOverlayDir, { recursive: true });

	const appended = ensureLineInFile(userInclude, OVERLAY_SOURCE_LINE);
	if (appended) {
		log.success(`Wired ${OVERLAY_SOURCE_LINE} into ${userInclude}`);
	} else {
		log.info("Overlay source line already present; skipping.");
	}
}

/**
 * Parse INI sections from text into { sectionName: { key: value, … } }.
 * Used by both window-rule and (later) other section-based KDE configs.
 */
function parseIniSections(text) {
	const result = {};
	let current = null;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const sec = line.match(/^\[(.+)\]$/);
		if (sec) {
			current = sec[1];
			result[current] = {};
			continue;
		}
		if (!current) continue;
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		result[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
	}
	return result;
}

/**
 * Translate ~/.config/kwinrulesrc → Hyprland `windowrule =` lines
 * (unified syntax, Hyprland 0.45+: `windowrule = RULE_VALUE, match:KEY VALUE`).
 * Pure: string in → string out.
 *
 * KDE rules group properties by [UUID] sections. We extract the subset that
 * has Hyprland equivalents: wmclass (class selector), desktops (workspace
 * pin), above (float), opacityactive (window opacity). Activity-only rules
 * are skipped — KDE Activities don't exist in Hyprland.
 */
export function translateKdeWindowRulesToHyprland(kwinrulesrcText) {
	const lines = [
		"# Translated from ~/.config/kwinrulesrc — DO NOT EDIT BY HAND",
		"# Regenerate with: bun haoshoku.js --hyprland-rules",
		"",
	];
	const sections = parseIniSections(kwinrulesrcText);

	for (const [name, props] of Object.entries(sections)) {
		if (name === "General") continue;
		const wmclass = props.wmclass;
		if (!wmclass) continue;
		// `wmclasscomplete=true` indicates the class string is "instance class"
		// (two tokens per KDE spec). Class is always the SECOND token regardless of
		// extra whitespace tokens — `.pop()` was wrong for 3-token inputs from Qt
		// apps with names like "org.kde.foo bar baz".
		const cls =
			props.wmclasscomplete === "true" && wmclass.includes(" ")
				? wmclass.split(" ")[1]
				: wmclass;
		// Escape regex metacharacters — Hyprland's PCRE matcher would otherwise
		// reject `match:class foo(bar` and silently drop the entire rule.
		// `^...$` anchors preserve exact-class semantics from the v2 selector.
		const escapedCls = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const selector = `match:class ^${escapedCls}$`;

		let emitted = 0;
		if (props.desktops) {
			lines.push(`windowrule = workspace ${props.desktops}, ${selector}`);
			emitted++;
		}
		if (props.above === "true") {
			// Hyprland 0.45+: `float` is a boolean, requires explicit value.
			lines.push(`windowrule = float true, ${selector}`);
			emitted++;
		}
		if (props.opacityactive) {
			const pct = Number.parseInt(props.opacityactive, 10);
			// Skip out-of-range percentages — KDE stores 0-100 but malformed
			// configs can carry negatives or >100, producing invalid opacity.
			if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) {
				const opacity = (pct / 100).toFixed(2);
				lines.push(`windowrule = opacity ${opacity}, ${selector}`);
				emitted++;
			}
		}
		if (emitted === 0 && (props.activity || props.title)) {
			// Activity-only or title-only KDE rules have no Hyprland equivalent;
			// don't emit a no-op windowrule.
		}
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Exec binaries that should NOT be carried over from KDE autostart into
 * Hyprland — KDE-specific services with no place in a Wayland tiling session.
 */
export const AUTOSTART_DENYLIST = [
	"kdeconnectd",
	"kded5",
	"kded6",
	"kaccess",
	"polkit-kde-authentication-agent-1",
	"plasmashell",
	"plasma-discover-notifier",
	"baloo_file",
	"baloorunner",
	"krunner",
];

/**
 * Shim/wrapper binaries that prefix the real command in `.desktop` Exec lines.
 * We peel these off before checking the binary name against AUTOSTART_DENYLIST,
 * otherwise an entry like `Exec=env DISPLAY=:0 kdeconnectd` would silently
 * bypass the denylist (basename of the first token is `env`, not `kdeconnectd`).
 */
const AUTOSTART_WRAPPER_BINS = new Set([
	"env",
	"dbus-run-session",
	"dbus-launch",
	"nohup",
	"setsid",
	"stdbuf",
]);

/**
 * Walk past wrapper binaries (env, dbus-run-session, …) and any KEY=VALUE
 * arguments they take, returning the basename of the first REAL binary in the
 * command. Pure — no IO.
 */
function realBinName(exec) {
	const tokens = exec.split(/\s+/).filter(Boolean);
	let i = 0;
	while (i < tokens.length) {
		const bn = path.basename(tokens[i]);
		if (!AUTOSTART_WRAPPER_BINS.has(bn)) return bn;
		i++;
		// env(1) and friends accept flag args (e.g. `env -i`, `env -u VAR`) and
		// any number of NAME=VALUE assignments before the actual command. Skip
		// both forms so the denylist check sees the real binary.
		while (
			i < tokens.length &&
			(tokens[i].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))
		) {
			i++;
		}
	}
	return path.basename(tokens[0] || "");
}

/**
 * Strip freedesktop Exec field codes (%f %F %u %U %d %D %n %N %v %m %i %c %k)
 * and Flatpak file-forwarding wrappers (@@u … @@ / @@ … @@) so the resulting
 * string is safe to pass to Hyprland's `exec-once`, which runs via direct
 * process spawn with no field-code expansion. Pure.
 *
 * Behavior:
 * - Removes @@u/@@U/@@f/@@F-bracketed blocks first (Flatpak's file forwarding)
 * - Removes single-token field codes (%f %F %u %U %d %D %n %N %v %m %k %c %i)
 * - Collapses resulting double spaces and trims edges
 */
export function sanitizeDesktopExec(exec) {
	let s = exec;
	// Flatpak file-forwarding: matches "@@<letter> ... @@" and bare "@@ ... @@".
	// Previously hardcoded [uUfF]? — broader [a-zA-Z]? catches future Flatpak
	// variants and unknown prefixes that would otherwise leak `@@x @@` tokens.
	s = s.replace(/\s*@@[a-zA-Z]?\s+[^@]*?\s+@@/g, "");
	// Field codes — strip %X tokens whose `%` is NOT preceded by another `%`.
	// The negative lookbehind keeps `%%` (freedesktop literal-`%`) intact while
	// removing real field codes. Iterate until stable so adjacent codes like
	// "%f%u" are both removed (the previous /(^|\s)%X(?=\s|$)/ regex required
	// whitespace boundaries and silently leaked concatenated codes).
	const codeRe = /(?<!%)%[fFuUdDnNvmkci]/g;
	let prev;
	do {
		prev = s;
		s = s.replace(codeRe, "");
	} while (s !== prev);
	// Collapse repeated whitespace and trim.
	return s.replace(/\s+/g, " ").trim();
}

/**
 * Read all *.desktop files in `dir`, parse Exec=, denylist KDE-only services,
 * sanitize desktop field codes, return Hyprland exec-once lines. Idempotent:
 * re-running yields the same output for the same input directory.
 *
 * Side effect: reads from the filesystem. Caller passes the path; pure with
 * respect to the directory's contents.
 */
export function translateKdeAutostartToHyprland(dir) {
	const lines = [
		"# Translated from autostart .desktop files — DO NOT EDIT BY HAND",
		"# Regenerate with: bun haoshoku.js --hyprland-rules",
		"",
	];
	if (!fs.existsSync(dir)) return `${lines.join("\n")}\n`;

	const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".desktop"));
	for (const entry of entries) {
		const text = fs.readFileSync(path.join(dir, entry), "utf8");
		const execMatch = text.match(/^Exec=(.+)$/m);
		if (!execMatch) continue;
		const exec = sanitizeDesktopExec(execMatch[1]);
		if (!exec) continue;
		const binName = realBinName(exec);
		if (AUTOSTART_DENYLIST.includes(binName)) continue;
		lines.push(`exec-once = ${exec}`);
	}

	return `${lines.join("\n")}\n`;
}

/** Path to user's KDE shortcuts kksrc in the haoshoku repo. */
export const KDE_SHORTCUTS_PATH = path.join(
	PROJECT_ROOT,
	"configs",
	"kde_shortcuts.kksrc",
);

/**
 * Read configs/kde_shortcuts.kksrc, translate, write
 * configs/hypr/conf.d/20-keybinds.conf. Intended as a one-shot --hyprland-keybinds
 * CLI command users invoke whenever they update their KDE shortcuts.
 */
export async function regenerateHyprlandKeybinds() {
	if (!fs.existsSync(KDE_SHORTCUTS_PATH)) {
		log.warning(
			`${KDE_SHORTCUTS_PATH} not found — skipping keybind generation.`,
		);
		return;
	}
	const kksrc = fs.readFileSync(KDE_SHORTCUTS_PATH, "utf8");
	const out = translateKdeShortcutsToHyprland(kksrc);
	const target = path.join(HYPR_BUNDLE_DIR, "conf.d", "20-keybinds.conf");
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, out);
	log.success(`Wrote ${target}`);
}

/** Path to user's live KDE window rules file. */
export const KWIN_RULES_PATH = path.join(HOME, ".config", "kwinrulesrc");

/** Path to user's live KDE autostart directory. */
export const AUTOSTART_DIR = path.join(HOME, ".config", "autostart");

/**
 * Read live KDE config + autostart, translate, write to configs/hypr/conf.d/.
 * One-shot regeneration command. Designed to be re-run whenever the user
 * changes their KDE rules/autostart on a still-KDE machine.
 */
export async function regenerateHyprlandRules() {
	const wrTarget = path.join(HYPR_BUNDLE_DIR, "conf.d", "30-windowrules.conf");
	if (fs.existsSync(KWIN_RULES_PATH)) {
		const rules = translateKdeWindowRulesToHyprland(
			fs.readFileSync(KWIN_RULES_PATH, "utf8"),
		);
		fs.mkdirSync(path.dirname(wrTarget), { recursive: true });
		fs.writeFileSync(wrTarget, rules);
		log.success(`Wrote ${wrTarget}`);
	} else {
		log.warning(
			`${KWIN_RULES_PATH} not found — skipping window-rule generation.`,
		);
	}

	const asTarget = path.join(HYPR_BUNDLE_DIR, "conf.d", "40-autostart.conf");
	const autostart = translateKdeAutostartToHyprland(AUTOSTART_DIR);
	fs.mkdirSync(path.dirname(asTarget), { recursive: true });
	fs.writeFileSync(asTarget, autostart);
	log.success(`Wrote ${asTarget}`);
}

/**
 * Backup live ~/.config/hypr-ocean/* overlay-managed files plus ~/.config/mako/
 * back into configs/hypr/. `home` and `projectRoot` are injectable for tests.
 */
export async function backupHyprland({
	home = HOME,
	projectRoot = PROJECT_ROOT,
} = {}) {
	const overlayDir = path.join(home, ".config", "hypr-ocean");
	const liveConfDDir = path.join(overlayDir, "conf.d");
	const liveMakoDir = path.join(home, ".config", "mako");
	const bundleDir = path.join(projectRoot, "configs", "hypr");

	log.info(`Backing up Hyprland overlay from ${overlayDir} to ${bundleDir}...`);
	fs.mkdirSync(bundleDir, { recursive: true });

	if (fs.existsSync(liveConfDDir)) {
		copyDirRecursive(liveConfDDir, path.join(bundleDir, "conf.d"));
		log.info("Backed up conf.d/");
	}

	for (const file of ["hyprpaper.conf", "hyprlock.conf", "hypridle.conf"]) {
		const src = path.join(overlayDir, file);
		if (fs.existsSync(src)) {
			fs.copyFileSync(src, path.join(bundleDir, file));
			log.info(`Backed up ${file}`);
		}
	}

	if (fs.existsSync(liveMakoDir)) {
		copyDirRecursive(liveMakoDir, path.join(bundleDir, "mako"));
		log.info("Backed up mako/");
	}

	log.success(`Hyprland overlay backed up to ${bundleDir}`);
}
