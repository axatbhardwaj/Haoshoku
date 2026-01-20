import fs from "fs";
import { homedir } from "os";
import path from "path";
import { log } from "../common/utils.js";

const HOME = homedir();
const OPENCODE_CONFIG_DIR = path.join(HOME, ".config", "opencode");
const OPENCODE_AGENTS_DIR = path.join(OPENCODE_CONFIG_DIR, "agents");

const PROJECT_ROOT = process.cwd();
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const CUSTOM_OPENCODE_DIR = path.join(CONFIGS_DIR, "opencode");

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

export async function syncOpencodeConfig() {
	log.info("Syncing OpenCode config...");

	fs.mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });
	fs.mkdirSync(OPENCODE_AGENTS_DIR, { recursive: true });

	// ~/.config/opencode/AGENTS.md
	const customAgentsMd = path.join(CUSTOM_OPENCODE_DIR, "AGENTS.md");
	if (fs.existsSync(customAgentsMd)) {
		fs.copyFileSync(customAgentsMd, path.join(OPENCODE_CONFIG_DIR, "AGENTS.md"));
		log.info("Synced ~/.config/opencode/AGENTS.md");
	}

	// ~/.config/opencode/agents/
	const customAgentsDir = path.join(CUSTOM_OPENCODE_DIR, "agents");
	if (fs.existsSync(customAgentsDir)) {
		copyDirSync(customAgentsDir, OPENCODE_AGENTS_DIR);
		log.info("Synced ~/.config/opencode/agents/");
	}

	log.success("OpenCode config synced.");
}
