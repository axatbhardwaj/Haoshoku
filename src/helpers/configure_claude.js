import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand } from "../common/utils.js";

const HOME = homedir();
const CLAUDE_CONFIG_DIR = path.join(HOME, ".claude");
const CLAUDE_JSON_PATH = path.join(HOME, ".claude.json");

const PROJECT_ROOT = process.cwd();
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const CUSTOM_CLAUDE_DIR = path.join(CONFIGS_DIR, "claude");
const CLAUDE_CONFIG_SUBMODULE = path.join(CONFIGS_DIR, "claude-config");

const CLAUDE_INSTALL_URL = "https://claude.ai/install.sh";

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

function commandExists(cmd) {
	try {
		const result = Bun.spawnSync(["which", cmd]);
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

export async function installClaude() {
	if (commandExists("claude")) {
		log.info("Claude Code already installed.");
		return;
	}

	log.info("Installing Claude Code...");
	await runCommand(`curl -fsSL ${CLAUDE_INSTALL_URL} | bash`);
}

export async function syncClaudeConfig() {
	log.info("Syncing Claude Code config...");

	fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });

	// ~/.claude.json
	const customClaudeJson = path.join(CUSTOM_CLAUDE_DIR, "claude.json");
	if (fs.existsSync(customClaudeJson)) {
		fs.copyFileSync(customClaudeJson, CLAUDE_JSON_PATH);
		log.info("Synced ~/.claude.json");
	}

	// ~/.claude/settings.json
	const customSettingsJson = path.join(CUSTOM_CLAUDE_DIR, "settings.json");
	if (fs.existsSync(customSettingsJson)) {
		fs.copyFileSync(
			customSettingsJson,
			path.join(CLAUDE_CONFIG_DIR, "settings.json"),
		);
		log.info("Synced ~/.claude/settings.json");
	}

	// ~/.claude/CLAUDE.md
	const customClaudeMd = path.join(CUSTOM_CLAUDE_DIR, "CLAUDE.md");
	if (fs.existsSync(customClaudeMd)) {
		fs.copyFileSync(customClaudeMd, path.join(CLAUDE_CONFIG_DIR, "CLAUDE.md"));
		log.info("Synced ~/.claude/CLAUDE.md");
	}

	// Copy workflow directories from submodule
	const workflowDirs = ["agents", "skills", "output-styles"];
	for (const dir of workflowDirs) {
		const srcDir = path.join(CLAUDE_CONFIG_SUBMODULE, dir);
		const destDir = path.join(CLAUDE_CONFIG_DIR, dir);
		if (fs.existsSync(srcDir)) {
			copyDirSync(srcDir, destDir);
			log.info(`Synced ${dir}/`);
		}
	}

	log.success("Claude Code config synced.");
}

export async function configureClaude() {
	await installClaude();
	await syncClaudeConfig();
}
