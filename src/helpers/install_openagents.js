import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand } from "../common/utils.js";

const HOME = homedir();
const OPENCODE_CONFIG_DIR = path.join(HOME, ".config", "opencode");
const PROJECT_ROOT = process.cwd();
const CUSTOM_OPENCODE_DIR = path.join(PROJECT_ROOT, "configs", "opencode");

function copyDirSync(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

async function syncOpenCodeConfig() {
	log.info("Syncing OpenCode config...");

	// Sync themes
	const customThemesDir = path.join(CUSTOM_OPENCODE_DIR, "themes");
	const targetThemesDir = path.join(OPENCODE_CONFIG_DIR, "themes");

	if (fs.existsSync(customThemesDir)) {
		try {
			copyDirSync(customThemesDir, targetThemesDir);
			log.info("Synced OpenCode themes.");
		} catch (error) {
			log.error(`Failed to sync themes: ${error.message}`);
		}
	}
}

export async function installOpenAgents() {
	log.info("Installing OpenAgents Control (Advanced Profile)...");

	const installCmd =
		"curl -fsSL https://raw.githubusercontent.com/darrenhinde/OpenAgentsControl/main/install.sh | bash -s advanced";

	const success = await runCommand(installCmd);

	if (success) {
		log.success("OpenAgents Control installed successfully.");
		await syncOpenCodeConfig();
	} else {
		log.error(
			"Failed to install OpenAgents Control. Please check your internet connection or try manually.",
		);
	}
}
