import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	backupClaudeConfig,
	PERSONAL_FILES,
	syncClaudeConfig,
} from "../src/helpers/configure_claude.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const CLAUDE_CONFIG_DIR = path.join(PROJECT_ROOT, "configs", "claude");
const PRIVATE_SOURCE_ROOT = process.env.HAOSHOKU_CLAUDE_RUNTIME_SOURCE_ROOT;
const PRIVATE_SOURCE_SHA = "413cf10231e8c5fa339666e6ccfea6a5a4ec3735";
const RUNTIME_FILES = [
	"agents/sol-wrapper.md",
	"agents/luna-wrapper.md",
	"agents/opencode-wrapper.md",
	"agents/grok-wrapper.md",
	"agents/madhyastha.md",
	"agents/anveshaka.md",
	"agents/fable-planner.md",
	"agents/opus-reviewer.md",
	"agents/run-codex-task.sh",
	"agents/run-opencode-seat.sh",
	"agents/validate-codex-wrapper.sh",
	"agents/codex-result.schema.json",
	"agents/prepare-pr-review-render-workspace.sh",
	"skills/discovering-work/SKILL.md",
	"skills/discovering-work/agents/openai.yaml",
	"skills/implement-work/SKILL.md",
	"skills/review-pr/SKILL.md",
	"skills/create-pr/SKILL.md",
	"skills/brainstorm/SKILL.md",
	"skills/babysit-pr/SKILL.md",
	"skills/linear-ticketing/SKILL.md",
	"skills/html-explainer/SKILL.md",
	"skills/html-explainer/template.html",
];
const PINNED_DIGESTS = {
	"agents/sol-wrapper.md":
		"f5382cf2cc9b75197556a143e02fa4afe1ab80e2688dba73946aa40581f6a5b6",
	"agents/luna-wrapper.md":
		"92a65d590128fe1c8608a36d016264d7fa5482c0ce4c637ad42203e9d30dabad",
	"agents/opencode-wrapper.md":
		"35b39ea71699f3ccfd2a7ba5857002e97cd13bc962ddb9765391fac6f24e64ed",
	"agents/grok-wrapper.md":
		"69f0876934f8aeea6ec62d90d694ea481b1bc1906b2ea16a9a40cbb14e1b4130",
	"agents/madhyastha.md":
		"cc7278ea49f202acf7a1336ae9e20cce1eb716a199856419c56c71a8fbc89d7f",
	"agents/anveshaka.md":
		"42926e8bb514f634ff067bddf728f468a7b8c542a7bf6853dc884720d27e1577",
	"agents/fable-planner.md":
		"f3f8f61d17972237eff9d6282007b65cb45133ce5f551bb44756f7da0f780567",
	"agents/opus-reviewer.md":
		"471946a434a78b02c1cdd1f8ff7101be4d1ef594272a3909d5d61bcb79415256",
	"agents/run-codex-task.sh":
		"faef3eddc4dddafc2a1bf2d2edf45a13e710519266dd88507da259f97e5fd4d6",
	"agents/run-opencode-seat.sh":
		"0f7bb1e9ad4bbef90b602113dffd9ad7d9f9ffa533d837bd699959113db73f3c",
	"agents/validate-codex-wrapper.sh":
		"250dcf53eddc87a3af3a40bf4be1e7d2b651557b71da5a93b9d413d5ca06be66",
	"agents/codex-result.schema.json":
		"cccad847ac6a90694bbad15daddc42f4a55f7219a5ed9f717db4dcdfc7e4bfa0",
	"agents/prepare-pr-review-render-workspace.sh":
		"01b03b63b1fa35318964b13c8a6dc86395201f0e42ebfb04c6134fb8996a15c4",
	"skills/discovering-work/SKILL.md":
		"9d618579ceabafdf4f336122b6f58648fd3c001e3ecc69f5b7502b95db494471",
	"skills/discovering-work/agents/openai.yaml":
		"61d4bfdd85a518acacc2ec655f483049173290946faca7536b436857ca5d7583",
	"skills/implement-work/SKILL.md":
		"2a32cbde04ffa5c7e4bee5492b1bbb64f07da728741a6468cc3ffe81abe9d24e",
	"skills/review-pr/SKILL.md":
		"a59c68c8196bf45e1352d779f44ca352059d5dfeea089dac063c5064616a4786",
	"skills/create-pr/SKILL.md":
		"af13f63d3a2bf5f5b30db6760b06e7ea0ba6b6a435df47cbfb584c02c0a2c2f1",
	"skills/brainstorm/SKILL.md":
		"638a3d1555064af8ff068113872fff869e562787ff0beb90ef4986f6492359bd",
	"skills/babysit-pr/SKILL.md":
		"3c3cae8efd059caa09d4888a74ae1fca2c9604d49ce4cc64b77e60ecc2b4c105",
	"skills/linear-ticketing/SKILL.md":
		"3612162702391ebebf93c6f177bfebbd036386fa7fd348d2b49ef5a0ae8c48d8",
	"skills/html-explainer/SKILL.md":
		"7224676536d3628b24a5175c8bd9d4ebcd8eadc7b4d17121edb2878ebb3fd6a0",
	"skills/html-explainer/template.html":
		"f467f7333d3812705f77bec340a47c18a22f4fd1c1dd19a1502214627028e5c3",
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

it("matches the pinned private source for every bundled runtime file", () => {
	if (!PRIVATE_SOURCE_ROOT) return;
	const mismatches = RUNTIME_FILES.filter(
		(relativePath) =>
			fs.readFileSync(path.join(CLAUDE_CONFIG_DIR, relativePath), "utf8") !==
			privateSource(relativePath),
	);
	expect(mismatches).toEqual([]);
});

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
		}
		for (const executable of [
			"agents/run-codex-task.sh",
			"agents/run-opencode-seat.sh",
			"agents/validate-codex-wrapper.sh",
			"agents/prepare-pr-review-render-workspace.sh",
		]) {
			expect(
				fs.statSync(path.join(claudeDir, executable)).mode & 0o111,
			).not.toBe(0);
		}
	} finally {
		fs.rmSync(claudeHome, { recursive: true, force: true });
	}
});

it("installs a portable runtime into an arbitrary home without baked-in home paths", async () => {
	const claudeHome = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-arbitrary-claude-home-"),
	);
	try {
		await syncClaudeConfig({ claudeHome });
		for (const relativePath of RUNTIME_FILES) {
			expect(
				fs.readFileSync(path.join(claudeHome, ".claude", relativePath), "utf8"),
				relativePath,
			).not.toMatch(/\/(?:home|Users)\//);
		}
	} finally {
		fs.rmSync(claudeHome, { recursive: true, force: true });
	}
});

it("backs up the full public runtime manifest from an arbitrary home", async () => {
	const claudeHome = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-arbitrary-claude-home-"),
	);
	const backupDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-portable-runtime-backup-"),
	);
	try {
		await syncClaudeConfig({ claudeHome });

		const summary = await backupClaudeConfig({
			srcDir: backupDir,
			claudeHome,
		});
		expect(summary).toEqual({ backedUp: PERSONAL_FILES.length, refused: 0 });
		for (const file of PERSONAL_FILES) {
			const liveFile = file.dest ?? file.src;
			expect(
				fs.readFileSync(path.join(backupDir, file.src), "utf8"),
				file.src,
			).toBe(
				fs.readFileSync(path.join(claudeHome, ".claude", liveFile), "utf8"),
			);
		}
	} finally {
		fs.rmSync(claudeHome, { recursive: true, force: true });
		fs.rmSync(backupDir, { recursive: true, force: true });
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
