import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	PERSONAL_FILES,
	syncClaudeConfig,
} from "../src/helpers/configure_claude.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const CLAUDE_CONFIG_DIR = path.join(PROJECT_ROOT, "configs", "claude");
const PRIVATE_SOURCE_ROOT = process.env.HAOSHOKU_CLAUDE_RUNTIME_SOURCE_ROOT;
const PRIVATE_SOURCE_SHA = "572bb5b8bd4d06302f559b0bac2391ebde0ca9a6";
const RUNTIME_FILES = [
	"agents/sol-wrapper.md",
	"agents/luna-wrapper.md",
	"agents/grok-wrapper.md",
	"agents/madhyastha.md",
	"agents/anveshaka.md",
	"agents/run-codex-task.sh",
	"agents/validate-codex-wrapper.sh",
	"agents/codex-result.schema.json",
	"workflows/pr-review.js",
	"workflows/review-station.js",
	"skills/discovering-work/SKILL.md",
	"skills/discovering-work/agents/openai.yaml",
	"skills/samvada-html-deliverables/SKILL.md",
	"skills/samvada-html-deliverables/agents/openai.yaml",
	"skills/samvada-html-deliverables/template.html",
];
const PINNED_DIGESTS = {
	"agents/sol-wrapper.md":
		"d4e004cda372090c1aade211187f15421cee7c3faa2c6e9ab69b52ed5e4d47c0",
	"agents/luna-wrapper.md":
		"32891095e408502316b4d024f628f040a7d630b479a62f84b9f35c4c8d60528e",
	"agents/grok-wrapper.md":
		"69f0876934f8aeea6ec62d90d694ea481b1bc1906b2ea16a9a40cbb14e1b4130",
	"agents/madhyastha.md":
		"cc7278ea49f202acf7a1336ae9e20cce1eb716a199856419c56c71a8fbc89d7f",
	"agents/anveshaka.md":
		"42926e8bb514f634ff067bddf728f468a7b8c542a7bf6853dc884720d27e1577",
	"agents/run-codex-task.sh":
		"bb2d781c45630ff3224d67c0a54cf3534b4bd7614646fa04b44f1b74d4caf124",
	"agents/validate-codex-wrapper.sh":
		"1e06f6fb83e79ac14b020a69fdd85613ed6c20a225f8cad8bac75c3bed696996",
	"agents/codex-result.schema.json":
		"cccad847ac6a90694bbad15daddc42f4a55f7219a5ed9f717db4dcdfc7e4bfa0",
	"workflows/pr-review.js":
		"f419fa7e35e63555a01f2e20c3f619493c19ab3c4f0a9b2b2ccc9cff951bd63a",
	"workflows/review-station.js":
		"913be6d7cbf52593ad32ee9f22f781bf166787445ef9f16e20eb03c81ef77b7a",
	"skills/discovering-work/SKILL.md":
		"9d618579ceabafdf4f336122b6f58648fd3c001e3ecc69f5b7502b95db494471",
	"skills/discovering-work/agents/openai.yaml":
		"61d4bfdd85a518acacc2ec655f483049173290946faca7536b436857ca5d7583",
	"skills/samvada-html-deliverables/SKILL.md":
		"5f2c924887f2ddf85e7952d6c8d6680b75bf7c4460897ca1ce46e025390111fe",
	"skills/samvada-html-deliverables/agents/openai.yaml":
		"526bcf76d2cd248eeb79102063f1dc75faabf2006d1807c137039dba20302dd3",
	"skills/samvada-html-deliverables/template.html":
		"9aef7a092acbb59199a289e19545da2436deb8a36cf5a35057ee46e5c03197a7",
};

function digest(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

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

it("deploys the complete public Claude fallback runtime into a fresh home", async () => {
	expect(PERSONAL_FILES.map((file) => file.src)).toEqual([
		"CLAUDE.md",
		"statusline-command.sh",
		"gitignore.template",
		...RUNTIME_FILES,
	]);

	const claudeHome = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-public-claude-runtime-"),
	);
	try {
		await syncClaudeConfig({ claudeHome });
		const claudeDir = path.join(claudeHome, ".claude");
		for (const relativePath of RUNTIME_FILES) {
			const bundled = fs.readFileSync(
				path.join(CLAUDE_CONFIG_DIR, relativePath),
				"utf8",
			);
			const deployed = path.join(claudeDir, relativePath);
			expect(fs.readFileSync(deployed, "utf8"), relativePath).toBe(bundled);
			expect(digest(bundled), relativePath).toBe(PINNED_DIGESTS[relativePath]);
			if (PRIVATE_SOURCE_ROOT) {
				expect(bundled, relativePath).toBe(privateSource(relativePath));
			}
		}
		for (const executable of [
			"agents/run-codex-task.sh",
			"agents/validate-codex-wrapper.sh",
		]) {
			expect(
				fs.statSync(path.join(claudeDir, executable)).mode & 0o111,
			).not.toBe(0);
		}
	} finally {
		fs.rmSync(claudeHome, { recursive: true, force: true });
	}
});

it("keeps active ignore configuration free of the former identifier", () => {
	const formerIdentifier = ["dvan", "dva"].join("");
	const legacyDirectory = `.${formerIdentifier}`;
	for (const ignoreFile of [".gitignore", ".npmignore"]) {
		expect(
			fs.readFileSync(path.join(PROJECT_ROOT, ignoreFile), "utf8"),
		).not.toContain(formerIdentifier);
	}
	expect(
		fs.readFileSync(path.join(PROJECT_ROOT, ".gitignore"), "utf8"),
	).toContain(".dvan[d]va/");
	expect(
		fs.readFileSync(path.join(PROJECT_ROOT, ".npmignore"), "utf8"),
	).toContain(".dvan[d]va/");

	const repository = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-ignore-boundary-"),
	);
	try {
		fs.copyFileSync(
			path.join(PROJECT_ROOT, ".gitignore"),
			path.join(repository, ".gitignore"),
		);
		const init = Bun.spawnSync(["git", "init", "--quiet"], {
			cwd: repository,
		});
		expect(init.exitCode).toBe(0);
		const ignored = Bun.spawnSync(
			["git", "check-ignore", "--quiet", "--", `${legacyDirectory}/state`],
			{ cwd: repository },
		);
		expect(ignored.exitCode).toBe(0);
	} finally {
		fs.rmSync(repository, { recursive: true, force: true });
	}
});
