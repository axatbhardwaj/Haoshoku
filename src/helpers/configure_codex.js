import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand, safeCopyFile } from "../common/utils.js";

const HOME = homedir();
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CUSTOM_CODEX_DIR = path.join(PROJECT_ROOT, "configs", "codex");
const CODEX_NPM_PACKAGE = "@openai/codex";
const SUPERPOWERS_SKILLS_COMMAND =
	"npx -y skills@latest add obra/superpowers -a codex -g -y";

// ~/.codex also holds runtime state (auth.json, *.sqlite, history.jsonl) —
// only AGENTS.md and the three bundled HTML Explainer skill files are reproducible config.
// Exported for the manifest test.
export const CODEX_PERSONAL_FILES = [
	{ src: "AGENTS.md" },
	{ src: "skills/html-explainer/SKILL.md" },
	{ src: "skills/html-explainer/agents/openai.yaml" },
	{ src: "skills/html-explainer/template.html" },
];

/** Resolve where a CODEX_PERSONAL_FILES entry lives on a given $HOME (inside ~/.codex/). */
function codexFilePath(src, home = HOME) {
	return path.join(home, ".codex", src);
}

function defaultCommandExists(cmd) {
	return Bun.which(cmd) !== null;
}

/** Install Codex CLI if not already present. */
export async function installCodex({
	commandExists = defaultCommandExists,
	run = runCommand,
} = {}) {
	if (commandExists("codex")) {
		log.info("Codex CLI already installed.");
		return;
	}

	log.info("Installing Codex CLI...");
	await run(`bun install -g ${CODEX_NPM_PACKAGE}`);
}

/**
 * Install obra/superpowers skills for Codex.
 *
 * The skills CLI writes to the shared ~/.agents/skills/ directory and registers
 * the skills for Codex (among other agents); Codex's own ~/.codex/skills/ holds
 * only the bundled html-explainer format source. The install is idempotent, so
 * re-running setup re-syncs rather than duplicating. A failure here is never
 * fatal: it costs process skills, not the Codex configuration itself.
 */
export async function installCodexSuperpowers({ run = runCommand } = {}) {
	log.info("Installing superpowers skills for Codex...");
	try {
		await run(SUPERPOWERS_SKILLS_COMMAND);
		log.success("Superpowers skills installed for Codex.");
	} catch (err) {
		log.warning(
			`superpowers skill install failed (${err?.message ?? err}) — continuing. Retry with: ${SUPERPOWERS_SKILLS_COMMAND}`,
		);
	}
}

/** Deploy personal config from the Haoshoku template to ~/.codex/. */
export async function syncCodexConfig(options = {}) {
	const { srcDir = CUSTOM_CODEX_DIR, codexHome = HOME } = options;
	const codexDir = path.join(codexHome, ".codex");

	log.info("Syncing Codex config...");
	fs.mkdirSync(codexDir, { recursive: true });

	for (const file of CODEX_PERSONAL_FILES) {
		const srcPath = path.join(srcDir, file.src);
		const destPath = codexFilePath(file.src, codexHome);
		if (fs.existsSync(srcPath)) {
			fs.mkdirSync(path.dirname(destPath), { recursive: true });
			safeCopyFile(srcPath, destPath);
			log.info(`Copied ${file.src}`);
		} else {
			log.warning(
				`Missing ${file.src} in source bundle (${srcPath}) — skipped`,
			);
		}
	}

	log.success("Codex config synced.");
}

/** Copy personal files from ~/.codex/ to configs/codex/ for version control. */
export async function backupCodexConfig(options = {}) {
	const { srcDir = CUSTOM_CODEX_DIR, codexHome = HOME } = options;

	log.info("Backing up Codex config...");
	fs.mkdirSync(srcDir, { recursive: true });

	for (const file of CODEX_PERSONAL_FILES) {
		const livePath = codexFilePath(file.src, codexHome);
		if (fs.existsSync(livePath)) {
			const destPath = path.join(srcDir, file.src);
			fs.mkdirSync(path.dirname(destPath), { recursive: true });
			fs.copyFileSync(livePath, destPath);
			log.info(`Backed up ${file.src}`);
		}
	}

	log.success("Codex config backed up to configs/codex/");
}

/** Install Codex CLI and deploy config (used by OS setup scripts). */
export async function configureCodex(options = {}) {
	const { installOptions, ...syncOptions } = options;
	await installCodex(installOptions);
	await installCodexSuperpowers(installOptions);
	await syncCodexConfig(syncOptions);
}
