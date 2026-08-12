import { expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const PRIVATE_SOURCE_ROOT =
	"/home/xzat/.claude/.worktrees/fixed-model-wrappers";
const PRIVATE_SOURCE_SHA = "572bb5b8bd4d06302f559b0bac2391ebde0ca9a6";
const SKILL_PATH = "skills/samvada-html-deliverables";
const SKILL_FILES = ["SKILL.md", "agents/openai.yaml", "template.html"];
const FORMER_IDENTIFIER = ["dvan", "dva"].join("");
const activeCodexConfigFiles = [
	"configs/codex/AGENTS.md",
	...SKILL_FILES.map((file) => path.join("configs/codex", SKILL_PATH, file)),
];

function privateSource(relativePath) {
	const result = Bun.spawnSync(
		[
			"git",
			"-C",
			PRIVATE_SOURCE_ROOT,
			"show",
			`${PRIVATE_SOURCE_SHA}:${relativePath}`,
		],
		{ stderr: "pipe", stdout: "pipe" },
	);
	expect(result.exitCode, relativePath).toBe(0);
	return result.stdout.toString();
}

it("keeps Samvada on the active public configuration boundary", () => {
	const codexConfig = path.join(PROJECT_ROOT, "configs", "codex");
	const codexAgents = path.join(codexConfig, "AGENTS.md");

	for (const relativePath of SKILL_FILES) {
		const bundledPath = path.join(codexConfig, SKILL_PATH, relativePath);
		expect(fs.readFileSync(bundledPath, "utf8"), relativePath).toBe(
			privateSource(path.join(SKILL_PATH, relativePath)),
		);
	}

	expect(
		fs.readFileSync(
			path.join(PROJECT_ROOT, "configs", "claude", "CLAUDE.md"),
			"utf8",
		),
	).toBe(privateSource("CLAUDE.md"));

	const activeCodexConfig = fs.readFileSync(codexAgents, "utf8");
	expect(activeCodexConfig).toContain("samvada-html-deliverables");
	expect(activeCodexConfig).toContain("samvada-artifact-meta");
	expect(activeCodexConfig).toContain("samvada.artifact.");
	for (const relativePath of activeCodexConfigFiles) {
		expect(
			fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8"),
			relativePath,
		).not.toContain(FORMER_IDENTIFIER);
	}
});
