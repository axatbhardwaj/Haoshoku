import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { copyDirRecursive, log } from "../common/utils.js";
import { ensureExplainerTheme } from "./configure_visual_explainer.js";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

export const UPSTREAM_AGENT_SKILLS = ["visual-explainer"];
const RETIRED_AGENT_SKILLS = [
	"html-deliverables",
	"model-routing",
	"paseo-pr-babysit",
	"paseo-pr-review",
];

function reconcileSkillLink({ home, agentHome, name, fsImpl, logger }) {
	const link = path.join(home, agentHome, "skills", name);
	const target = `../../.agents/skills/${name}`;
	const existing = fsImpl.lstatSync(link, { throwIfNoEntry: false });
	if (existing?.isSymbolicLink()) {
		if (fsImpl.readlinkSync(link) === target) return;
		fsImpl.unlinkSync(link);
	} else if (existing) {
		logger.warning(`Leaving real directory ${link} untouched.`);
		return;
	}
	fsImpl.mkdirSync(path.dirname(link), { recursive: true });
	fsImpl.symlinkSync(target, link);
}

function removeRetiredManagedLink({ home, agentHome, name, fsImpl, logger }) {
	const link = path.join(home, agentHome, "skills", name);
	const existing = fsImpl.lstatSync(link, { throwIfNoEntry: false });
	if (!existing) return;
	if (
		existing.isSymbolicLink() &&
		fsImpl.readlinkSync(link) === `../../.agents/skills/${name}`
	) {
		fsImpl.unlinkSync(link);
		return;
	}
	logger.warning(`Leaving non-managed retired skill path ${link} untouched.`);
}

function archiveRetiredSkill({
	home,
	name,
	fsImpl,
	logger,
	renameImpl,
	nowImpl,
}) {
	const live = path.join(home, ".agents", "skills", name);
	const existing = fsImpl.lstatSync(live, { throwIfNoEntry: false });
	if (existing) {
		if (!existing.isDirectory() || existing.isSymbolicLink()) {
			logger.warning(
				`Leaving non-managed retired skill path ${live} untouched.`,
			);
			return false;
		}
		const archiveRoot = path.join(
			home,
			".config",
			"haoshoku",
			"retired-agent-skills",
		);
		try {
			fsImpl.mkdirSync(archiveRoot, { recursive: true });
			const base = path.join(archiveRoot, name);
			let archive = base;
			if (fsImpl.existsSync(archive)) archive = `${base}.${nowImpl()}`;
			renameImpl(live, archive);
			logger.info(`Archived retired skill ${name} at ${archive}.`);
		} catch (error) {
			logger.error(
				`Could not archive retired skill ${live} (${error.message}).`,
			);
			return false;
		}
	}
	for (const agentHome of [".claude", ".codex"]) {
		removeRetiredManagedLink({ home, agentHome, name, fsImpl, logger });
	}
	return true;
}

export function syncAgentSkills({
	home = homedir(),
	projectRoot = PROJECT_ROOT,
	fsImpl = fs,
	copyDirImpl = copyDirRecursive,
	logger = log,
	renameImpl = fs.renameSync,
	nowImpl = Date.now,
} = {}) {
	const live = path.join(home, ".agents", "skills");
	let complete = true;

	for (const name of RETIRED_AGENT_SKILLS) {
		if (
			!archiveRetiredSkill({
				home,
				name,
				fsImpl,
				logger,
				renameImpl,
				nowImpl,
			})
		) {
			return false;
		}
	}

	for (const name of UPSTREAM_AGENT_SKILLS) {
		const source = path.join(projectRoot, "configs", "upstream-skills", name);
		if (!fsImpl.existsSync(source)) {
			logger.warning(
				`Missing bundled upstream-skills skill ${name}; sync skipped.`,
			);
			complete = false;
			continue;
		}
		copyDirImpl(source, path.join(live, name));
		for (const agentHome of [".claude", ".codex"]) {
			reconcileSkillLink({ home, agentHome, name, fsImpl, logger });
		}
	}
	if (!ensureExplainerTheme({ home, fsImpl, logger })) complete = false;

	if (complete) logger.success("Haoshoku agent skills synced.");
	return complete;
}
