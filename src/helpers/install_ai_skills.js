import fs from "fs";
import path from "path";
import { homedir } from "os";
import prompts from "prompts";
import { commandExists, log } from "../common/utils.js";

const HOME = homedir();
const AI_SKILLS_PATH = path.join(HOME, "personal", "ai-skills");
const GEMINI_SKILLS_DIR = path.join(HOME, ".gemini", "skills");
const OPENCODE_SKILLS_DIR = path.join(HOME, ".config", "opencode", "skills");
// Gemini CLI stores settings at ~/.gemini/settings.json
const GEMINI_SETTINGS_PATH = path.join(HOME, ".gemini", "settings.json");

function getSkills() {
	const skillsDir = path.join(AI_SKILLS_PATH, "skill");
	if (!fs.existsSync(skillsDir)) {
		return [];
	}
	return fs
		.readdirSync(skillsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

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

function installSkillsToDirectory(targetDir, label) {
	const skills = getSkills();
	if (skills.length === 0) {
		log.warning(`No skills found in ${AI_SKILLS_PATH}/skill`);
		return;
	}

	fs.mkdirSync(targetDir, { recursive: true });
	const skillsSourceDir = path.join(AI_SKILLS_PATH, "skill");

	for (const skill of skills) {
		const srcPath = path.join(skillsSourceDir, skill);
		const destPath = path.join(targetDir, skill);
		copyDirSync(srcPath, destPath);
		log.info(`Installed ${skill} to ${label}`);
	}

	log.success(`Installed ${skills.length} skills to ${label}`);
}

function enableExperimentalSkills() {
	let settings = {};
	if (fs.existsSync(GEMINI_SETTINGS_PATH)) {
		const content = fs.readFileSync(GEMINI_SETTINGS_PATH, "utf-8");
		settings = JSON.parse(content);
	}

	if (!settings.experimental) {
		settings.experimental = {};
	}
	settings.experimental.skills = true;

	// Atomic write: temp file + rename
	const tempPath = GEMINI_SETTINGS_PATH + ".tmp";
	fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2));
	fs.renameSync(tempPath, GEMINI_SETTINGS_PATH);

	log.info("Enabled experimental.skills in Gemini CLI settings");
}

async function installGeminiSkills() {
	if (!(await commandExists("gemini"))) {
		log.info("Gemini CLI not installed, skipping skills installation");
		return;
	}

	const response = await prompts({
		type: "confirm",
		name: "value",
		message: "Install Gemini CLI skills from ai-skills?",
		initial: true,
	});

	if (!response.value) {
		return;
	}

	installSkillsToDirectory(GEMINI_SKILLS_DIR, "Gemini CLI");
	enableExperimentalSkills();
}

async function installOpenCodeSkills() {
	const response = await prompts({
		type: "confirm",
		name: "value",
		message: "Install OpenCode skills from ai-skills?",
		initial: true,
	});

	if (!response.value) {
		return;
	}

	installSkillsToDirectory(OPENCODE_SKILLS_DIR, "OpenCode");
}

export async function installAiSkills() {
	if (!fs.existsSync(AI_SKILLS_PATH)) {
		log.warning(`AI skills repo not found at ${AI_SKILLS_PATH}`);
		return;
	}

	await installGeminiSkills();
	await installOpenCodeSkills();
}

export { getSkills, enableExperimentalSkills, installGeminiSkills, installOpenCodeSkills };
