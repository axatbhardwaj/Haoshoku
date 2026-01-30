import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log } from "../common/utils.js";

const HOME = homedir();
const ZED_CONFIG_DIR = path.join(HOME, ".config", "zed");

const PROJECT_ROOT = process.cwd();
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const ZED_BACKUP_DIR = path.join(CONFIGS_DIR, "zed");

const SENSITIVE_KEYS = ["ssh_connections"];

/** Strip single-line comments from JSONC content. */
function stripJsonComments(jsonc) {
	return jsonc
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n");
}

/** Remove sensitive keys from settings object. */
function sanitizeSettings(settings) {
	const sanitized = { ...settings };
	for (const key of SENSITIVE_KEYS) {
		delete sanitized[key];
	}
	return sanitized;
}

/** Backup Zed config from ~/.config/zed to configs/zed (sanitized). */
export async function backupZedConfig() {
	log.info("Backing up Zed config...");

	fs.mkdirSync(ZED_BACKUP_DIR, { recursive: true });
	fs.mkdirSync(path.join(ZED_BACKUP_DIR, "themes"), { recursive: true });

	const settingsPath = path.join(ZED_CONFIG_DIR, "settings.json");
	if (fs.existsSync(settingsPath)) {
		const raw = fs.readFileSync(settingsPath, "utf-8");
		const stripped = stripJsonComments(raw);
		const settings = JSON.parse(stripped);
		const sanitized = sanitizeSettings(settings);
		const output = JSON.stringify(sanitized, null, 2);
		fs.writeFileSync(path.join(ZED_BACKUP_DIR, "settings.json"), output);
		log.info("Backed up settings.json (sanitized)");
	}

	const keymapPath = path.join(ZED_CONFIG_DIR, "keymap.json");
	if (fs.existsSync(keymapPath)) {
		fs.copyFileSync(keymapPath, path.join(ZED_BACKUP_DIR, "keymap.json"));
		log.info("Backed up keymap.json");
	}

	const themesDir = path.join(ZED_CONFIG_DIR, "themes");
	if (fs.existsSync(themesDir)) {
		const themes = fs.readdirSync(themesDir);
		for (const theme of themes) {
			const src = path.join(themesDir, theme);
			const dest = path.join(ZED_BACKUP_DIR, "themes", theme);
			fs.copyFileSync(src, dest);
			log.info(`Backed up themes/${theme}`);
		}
	}

	log.success("Zed config backed up to configs/zed/");
}

/** Deploy Zed config from configs/zed to ~/.config/zed. */
export async function syncZedConfig() {
	log.info("Syncing Zed config...");

	fs.mkdirSync(ZED_CONFIG_DIR, { recursive: true });
	fs.mkdirSync(path.join(ZED_CONFIG_DIR, "themes"), { recursive: true });

	const settingsPath = path.join(ZED_BACKUP_DIR, "settings.json");
	if (fs.existsSync(settingsPath)) {
		fs.copyFileSync(settingsPath, path.join(ZED_CONFIG_DIR, "settings.json"));
		log.info("Synced settings.json");
	}

	const keymapPath = path.join(ZED_BACKUP_DIR, "keymap.json");
	if (fs.existsSync(keymapPath)) {
		fs.copyFileSync(keymapPath, path.join(ZED_CONFIG_DIR, "keymap.json"));
		log.info("Synced keymap.json");
	}

	const themesDir = path.join(ZED_BACKUP_DIR, "themes");
	if (fs.existsSync(themesDir)) {
		const themes = fs.readdirSync(themesDir);
		for (const theme of themes) {
			const src = path.join(themesDir, theme);
			const dest = path.join(ZED_CONFIG_DIR, "themes", theme);
			fs.copyFileSync(src, dest);
			log.info(`Synced themes/${theme}`);
		}
	}

	log.success("Zed config synced to ~/.config/zed/");
}

/** Copy Zed themes only (used by OS setup scripts). */
export async function configureZed() {
	log.info("Configuring Zed editor...");

	const themesDestDir = path.join(ZED_CONFIG_DIR, "themes");
	fs.mkdirSync(themesDestDir, { recursive: true });

	const themesSrcDir = path.join(ZED_BACKUP_DIR, "themes");
	if (fs.existsSync(themesSrcDir)) {
		const themes = fs.readdirSync(themesSrcDir);
		for (const theme of themes) {
			const src = path.join(themesSrcDir, theme);
			const dest = path.join(themesDestDir, theme);
			fs.copyFileSync(src, dest);
			log.info(`Copied theme: ${theme}`);
		}
	}

	log.success("Zed themes configured.");
}
