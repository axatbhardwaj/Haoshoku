import { expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const PUBLIC_RUNTIME_FILES = [
	"configs/claude/agents/sol-wrapper.md",
	"configs/claude/agents/luna-wrapper.md",
	"configs/claude/agents/grok-wrapper.md",
	"configs/claude/agents/madhyastha.md",
	"configs/claude/agents/anveshaka.md",
	"configs/claude/agents/run-codex-task.sh",
	"configs/claude/agents/validate-codex-wrapper.sh",
	"configs/claude/agents/codex-result.schema.json",
	"configs/claude/workflows/pr-review.js",
	"configs/claude/workflows/review-station.js",
	"configs/claude/skills/discovering-work/SKILL.md",
	"configs/claude/skills/discovering-work/agents/openai.yaml",
	"configs/claude/skills/samvada-html-deliverables/SKILL.md",
	"configs/claude/skills/samvada-html-deliverables/agents/openai.yaml",
	"configs/claude/skills/samvada-html-deliverables/template.html",
];

it("keeps packed configs/claude files free of literal home-directory paths", () => {
	if (!Bun.which("npm")) return;
	const npmCache = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-npm-pack-cache-"),
	);

	try {
		const packed = Bun.spawnSync(["npm", "pack", "--dry-run", "--json"], {
			cwd: PROJECT_ROOT,
			env: { ...process.env, npm_config_cache: npmCache },
			stderr: "pipe",
			stdout: "pipe",
		});
		const stdout = packed.stdout.toString();
		const stderr = packed.stderr.toString();

		if (packed.exitCode !== 0) {
			throw new Error(
				`npm pack --dry-run failed with exit code ${packed.exitCode}\n${stderr}${stdout}`,
			);
		}

		const packOutput = JSON.parse(stdout);
		const manifest = Array.isArray(packOutput)
			? packOutput[0]
			: Object.values(packOutput)[0];
		const claudeFiles = manifest.files
			.map((file) => file.path)
			.filter((filePath) => filePath.startsWith("configs/claude/"));
		expect(claudeFiles.length).toBeGreaterThan(0);
		expect(claudeFiles).toEqual(expect.arrayContaining(PUBLIC_RUNTIME_FILES));

		const baselineFiles = claudeFiles.filter(
			(filePath) => !PUBLIC_RUNTIME_FILES.includes(filePath),
		);
		const leakingFiles = baselineFiles.filter((filePath) => {
			const contents = fs.readFileSync(
				path.join(PROJECT_ROOT, filePath),
				"utf8",
			);
			return contents.includes("/home/") || contents.includes("/Users/");
		});
		expect(leakingFiles).toEqual([]);
	} finally {
		fs.rmSync(npmCache, { recursive: true, force: true });
	}
}, 30_000);
