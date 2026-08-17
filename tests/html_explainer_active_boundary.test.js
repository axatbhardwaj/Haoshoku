import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const SKILL_PATH = "skills/html-explainer";
const SKILL_FILES = ["SKILL.md", "agents/openai.yaml", "template.html"];
const PINNED_DIGESTS = {
	"SKILL.md":
		"12c0cc2ff84e4c396f4e720996b4ee576fcb572cf7f207b9d3b16e72b0c37410",
	"agents/openai.yaml":
		"7f224c19d0ea397af25deedde727f8197724c49d7b1f4e164efa279db603a717",
	"template.html":
		"f467f7333d3812705f77bec340a47c18a22f4fd1c1dd19a1502214627028e5c3",
};
const RETIRED_IDENTIFIERS = [["dvan", "dva"].join(""), ["samv", "ada"].join("")];
const activeConfigFiles = [
	"configs/codex/AGENTS.md",
	...SKILL_FILES.map((file) => path.join("configs/codex", SKILL_PATH, file)),
	"configs/claude/agents/luna-max-wrapper.md",
	"configs/claude/skills/html-explainer/SKILL.md",
	"configs/claude/skills/html-explainer/template.html",
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

	// luna-max-wrapper resolves these exact paths at dispatch time; a rename that
	// misses it silently breaks every HTML deliverable dispatch.
	const lunaMaxWrapper = fs.readFileSync(
		path.join(PROJECT_ROOT, "configs/claude/agents/luna-max-wrapper.md"),
		"utf8",
	);
	for (const required of [
		"~/.claude/skills/html-explainer/SKILL.md",
		"~/.claude/skills/html-explainer/template.html",
	]) {
		expect(lunaMaxWrapper, "luna-max-wrapper.md").toContain(required);
	}

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
