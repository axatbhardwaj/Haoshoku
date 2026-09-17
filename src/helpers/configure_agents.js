import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, portabilizeHome, safeCopyFile } from "../common/utils.js";

const HOME = homedir();
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_PROFILE_DIR = path.join(PROJECT_ROOT, "configs", "agent-profile");

// Single configurable source (PROFILE.md) deployed to every harness.
// Claude reads CLAUDE.md, Codex/Opencode read AGENTS.md, Antigravity reads
// GEMINI.md as global rules. Exported for the manifest test.
export const AGENT_TARGETS = [
	{ src: "PROFILE.md", destDir: ".claude", dest: "CLAUDE.md" },
	{ src: "PROFILE.md", destDir: ".codex", dest: "AGENTS.md" },
	{
		src: "PROFILE.md",
		destDir: ".config/opencode",
		dest: "AGENTS.md",
	},
	{ src: "PROFILE.md", destDir: ".gemini", dest: "GEMINI.md" },
];

/** Deploy the shared profile from the bundle to all four agent homes. */
export async function syncAgentsConfig(options = {}) {
	const { srcDir = AGENT_PROFILE_DIR, home = HOME } = options;

	log.info("Syncing shared agent profile...");
	const srcPath = path.join(srcDir, "PROFILE.md");
	if (!fs.existsSync(srcPath)) {
		log.warning(`Missing PROFILE.md in source bundle (${srcPath}) — skipped`);
		return;
	}

	for (const target of AGENT_TARGETS) {
		const destPath = path.join(home, target.destDir, target.dest);
		fs.mkdirSync(path.dirname(destPath), { recursive: true });
		safeCopyFile(srcPath, destPath);
		log.info(`Copied PROFILE.md to ${target.destDir}/${target.dest}`);
	}

	log.success("Shared agent profile synced.");
}

/** Copy the primary live profile back into the bundle for version control. */
export async function backupAgentsConfig(options = {}) {
	const { srcDir = AGENT_PROFILE_DIR, home = HOME } = options;

	log.info("Backing up shared agent profile...");
	fs.mkdirSync(srcDir, { recursive: true });

	const primary = path.join(home, ".claude", "CLAUDE.md");
	if (!fs.existsSync(primary)) {
		log.warning(`No live profile at ${primary} — skipped`);
		return { backedUp: 0, refused: 0 };
	}

	const portable = portabilizeHome(fs.readFileSync(primary, "utf8"), home);
	fs.writeFileSync(path.join(srcDir, "PROFILE.md"), portable);
	log.info("Backed up ~/.claude/CLAUDE.md to PROFILE.md");
	log.success("Shared agent profile backed up to configs/agent-profile/");
	return { backedUp: 1, refused: 0 };
}
