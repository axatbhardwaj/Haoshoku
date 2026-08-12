import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const PRIVATE_SOURCE_SHA = "413cf10231e8c5fa339666e6ccfea6a5a4ec3735";
const PRIVATE_SOURCE_ROOT = process.env.HAOSHOKU_SAMVADA_SOURCE_ROOT;
const SKILL_PATH = "skills/samvada-html-deliverables";
const SKILL_FILES = ["SKILL.md", "agents/openai.yaml", "template.html"];
const PINNED_DIGESTS = {
	"CLAUDE.md":
		"b4fb3f9ca39eae4a731940786dcd30900ea94fb580ba6e718879e4c527fe7751",
	"SKILL.md":
		"5f2c924887f2ddf85e7952d6c8d6680b75bf7c4460897ca1ce46e025390111fe",
	"agents/openai.yaml":
		"526bcf76d2cd248eeb79102063f1dc75faabf2006d1807c137039dba20302dd3",
	"template.html":
		"9aef7a092acbb59199a289e19545da2436deb8a36cf5a35057ee46e5c03197a7",
};
const FORMER_IDENTIFIER = ["dvan", "dva"].join("");
const activeCodexConfigFiles = [
	"configs/codex/AGENTS.md",
	...SKILL_FILES.map((file) => path.join("configs/codex", SKILL_PATH, file)),
];

function privateSource(relativePath) {
	if (!PRIVATE_SOURCE_ROOT) return undefined;
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

function digest(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

it("keeps Samvada on the active public configuration boundary", () => {
	const codexConfig = path.join(PROJECT_ROOT, "configs", "codex");
	const codexAgents = path.join(codexConfig, "AGENTS.md");

	for (const relativePath of SKILL_FILES) {
		const bundledPath = path.join(codexConfig, SKILL_PATH, relativePath);
		const contents = fs.readFileSync(bundledPath, "utf8");
		expect(digest(contents), relativePath).toBe(PINNED_DIGESTS[relativePath]);
		if (PRIVATE_SOURCE_ROOT) {
			expect(contents, relativePath).toBe(
				privateSource(path.join(SKILL_PATH, relativePath)),
			);
		}
	}

	const claudePolicy = fs.readFileSync(
		path.join(PROJECT_ROOT, "configs", "claude", "CLAUDE.md"),
		"utf8",
	);
	expect(digest(claudePolicy), "CLAUDE.md").toBe(PINNED_DIGESTS["CLAUDE.md"]);
	if (PRIVATE_SOURCE_ROOT) {
		expect(claudePolicy).toBe(privateSource("CLAUDE.md"));
	}

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
