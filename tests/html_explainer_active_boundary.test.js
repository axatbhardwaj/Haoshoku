import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const SKILL_PATH = "skills/html-explainer";
const SKILL_FILES = ["SKILL.md", "agents/openai.yaml", "template.html"];
const PINNED_DIGESTS = {
	"SKILL.md":
		"e93f612526b4cf320917a6c6d77b274c18476f38e12bfd4f757c9a3e9c256727",
	"agents/openai.yaml":
		"7f224c19d0ea397af25deedde727f8197724c49d7b1f4e164efa279db603a717",
	"template.html":
		"c70b817d679842558f538126f2d43e1f2d08596969030dab01a338a218708466",
};
const RETIRED_IDENTIFIERS = [["dvan", "dva"].join(""), ["samv", "ada"].join("")];
const activeConfigFiles = [
	"configs/codex/AGENTS.md",
	...SKILL_FILES.map((file) => path.join("configs/codex", SKILL_PATH, file)),
];

function digest(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

it("keeps the HTML Explainer skill on the active public configuration boundary", () => {
	const codexConfig = path.join(PROJECT_ROOT, "configs", "codex");

	for (const relativePath of SKILL_FILES) {
		const contents = fs.readFileSync(
			path.join(codexConfig, SKILL_PATH, relativePath),
			"utf8",
		);
		expect(digest(contents), relativePath).toBe(PINNED_DIGESTS[relativePath]);
	}

	const activeCodexConfig = fs.readFileSync(
		path.join(codexConfig, "AGENTS.md"),
		"utf8",
	);
	expect(activeCodexConfig).toContain("html-explainer");
	expect(activeCodexConfig).toContain("artifact-meta");
	expect(activeCodexConfig).toContain("artifact.");

	for (const relativePath of activeConfigFiles) {
		const contents = fs.readFileSync(
			path.join(PROJECT_ROOT, relativePath),
			"utf8",
		);
		for (const retired of RETIRED_IDENTIFIERS) {
			expect(contents.toLowerCase(), `${relativePath}: ${retired}`).not.toContain(
				retired,
			);
		}
	}
});
