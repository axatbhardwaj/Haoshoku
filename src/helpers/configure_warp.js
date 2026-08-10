import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, safeCopyFile } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");
const THEME_NAME = "Elysian";
const THEME_FILE = "elysian.yaml";
const THEME_OPACITY = 77;
const XDG_TERMINAL_PREFERENCE =
	"# Terminal emulator preference order for xdg-terminal-exec\n" +
	"# The first found and valid terminal will be used\n" +
	"dev.warp.Warp.desktop\n";

/**
 * Resolve Warp's Linux file locations, honoring XDG_CONFIG_HOME / XDG_DATA_HOME
 * with the standard `~/.config` and `~/.local/share` fallbacks. `env` is
 * injectable so tests can exercise both default and overridden roots.
 */
export function resolveWarpPaths({
	home = HOME_DEFAULT,
	env = process.env,
} = {}) {
	const cfg = env.XDG_CONFIG_HOME || path.join(home, ".config");
	const data = env.XDG_DATA_HOME || path.join(home, ".local", "share");
	return {
		settings: path.join(cfg, "warp-terminal", "settings.toml"),
		xdgTerminalPreference: path.join(cfg, "xdg-terminals.list"),
		themePath: path.join(data, "warp-terminal", "themes", THEME_FILE),
		tabConfigDir: path.join(data, "warp-terminal", "tab_configs"),
	};
}

function configureXdgTerminalPreference(preferencePath) {
	const preferenceExists = fs.existsSync(preferencePath);
	const original = preferenceExists
		? fs.readFileSync(preferencePath, "utf8")
		: "";
	fs.mkdirSync(path.dirname(preferencePath), { recursive: true });
	const firstCapture = `${preferencePath}.haoshoku-first-capture`;
	if (!fs.existsSync(firstCapture)) {
		if (preferenceExists) {
			fs.copyFileSync(preferencePath, firstCapture, fs.constants.COPYFILE_EXCL);
		} else {
			fs.writeFileSync(firstCapture, "", { flag: "wx" });
		}
	}
	if (original === XDG_TERMINAL_PREFERENCE) return;

	const tmp = `${preferencePath}.tmp`;
	fs.writeFileSync(tmp, XDG_TERMINAL_PREFERENCE);
	fs.renameSync(tmp, preferencePath);
	log.success("Set Warp as the XDG terminal default.");
}

function patchTomlTable(content, header, entries) {
	const lines = content.split("\n");
	const hi = lines.findIndex((line) => line.trim() === header);
	if (hi === -1) {
		const section = `${header}\n${entries.map(({ line }) => line).join("\n")}\n`;
		if (content.trim() === "") return section;
		return `${content.replace(/\n*$/, "\n")}\n${section}`;
	}

	let end = lines.length;
	for (let i = hi + 1; i < lines.length; i++) {
		if (/^\s*\[/.test(lines[i])) {
			end = i;
			break;
		}
	}

	let insertAt = hi + 1;
	for (const entry of entries) {
		let found = false;
		for (let i = hi + 1; i < end; i++) {
			if (entry.pattern.test(lines[i])) {
				lines[i] = entry.line;
				found = true;
				break;
			}
		}
		if (!found) {
			lines.splice(insertAt, 0, entry.line);
			insertAt++;
			end++;
		}
	}
	return lines.join("\n");
}

/**
 * Pure, idempotent edit of a Warp `settings.toml` string: ensure the
 * `[appearance.themes]` table sets `system_theme = false` and points `theme`
 * at the custom Elysian theme object, then set Kitty's 77% background opacity
 * in `[appearance.window]`. Custom themes require the object form; a bare
 * string selects a built-in.
 *
 * Each table can already exist, be absent beside other config, or be absent in
 * an empty file. Unrelated tables and sibling keys are preserved.
 */
export function patchWarpSettings(
	content,
	{ name, path: themePath, opacity = THEME_OPACITY },
) {
	const themeLine = `theme = { custom = { name = "${name}", path = "${themePath}" } }`;
	const themed = patchTomlTable(content, "[appearance.themes]", [
		{ pattern: /^\s*system_theme\s*=/, line: "system_theme = false" },
		{ pattern: /^\s*theme\s*=/, line: themeLine },
	]);
	return patchTomlTable(themed, "[appearance.window]", [
		{
			pattern: /^\s*override_opacity\s*=/,
			line: `override_opacity = ${opacity}`,
		},
	]);
}

/**
 * Configure Warp: deploy all shipped top-level Tab Configs and the Elysian theme, then
 * activate the theme and Kitty-matched opacity in `settings.toml`. Creates a
 * minimal settings file when absent. Mutates settings safely: skips unchanged
 * writes, keeps a one-time `.bak`, and writes atomically via temp + rename.
 */
export async function configureWarp({
	home = HOME_DEFAULT,
	env = process.env,
	projectRoot = PROJECT_ROOT_DEFAULT,
} = {}) {
	const { settings, xdgTerminalPreference, themePath, tabConfigDir } =
		resolveWarpPaths({ home, env });

	// Deploy all shipped Tab Configs (independent of theme state, so the theme
	// early-return below can never skip it).
	const tabConfigSrcDir = path.join(
		projectRoot,
		"configs",
		"warp",
		"tab_configs",
	);
	if (fs.existsSync(tabConfigSrcDir)) {
		fs.mkdirSync(tabConfigDir, { recursive: true });
		for (const entry of fs.readdirSync(tabConfigSrcDir, {
			withFileTypes: true,
		})) {
			if (entry.isFile() && path.extname(entry.name) === ".toml") {
				safeCopyFile(
					path.join(tabConfigSrcDir, entry.name),
					path.join(tabConfigDir, entry.name),
				);
			}
		}
		log.info("Deployed Warp tab configs.");
	}

	configureXdgTerminalPreference(xdgTerminalPreference);

	// Deploy the exact Elysian palette used by the active Omarchy kitty theme.
	const themeSrc = path.join(
		projectRoot,
		"configs",
		"warp",
		"themes",
		THEME_FILE,
	);
	if (fs.existsSync(themeSrc)) {
		fs.mkdirSync(path.dirname(themePath), { recursive: true });
		safeCopyFile(themeSrc, themePath);
		log.info("Deployed Warp Elysian theme.");
	} else {
		log.warning(
			`Warp Elysian theme source not found at ${themeSrc} — activating the expected destination anyway.`,
		);
	}

	const original = fs.existsSync(settings)
		? fs.readFileSync(settings, "utf8")
		: "";
	const patched = patchWarpSettings(original, {
		name: THEME_NAME,
		path: themePath,
		opacity: THEME_OPACITY,
	});
	if (patched === original) {
		log.info("Warp theme already active — no change.");
		return;
	}

	fs.mkdirSync(path.dirname(settings), { recursive: true });
	if (original !== "" && !fs.existsSync(`${settings}.bak`)) {
		fs.copyFileSync(settings, `${settings}.bak`); // one-time backup of user state
	}
	const tmp = `${settings}.tmp`; // atomic write: temp + rename
	fs.writeFileSync(tmp, patched);
	fs.renameSync(tmp, settings);

	log.success(
		original === ""
			? "Created Warp settings.toml with Elysian theme."
			: "Activated Elysian Warp theme in settings.toml.",
	);
}
