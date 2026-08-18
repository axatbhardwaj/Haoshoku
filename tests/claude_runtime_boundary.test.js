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
const OPENCODE_LAUNCHER_PATH = path.join(
	CLAUDE_CONFIG_DIR,
	"agents",
	"run-opencode-seat.sh",
);
const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");
const RUNTIME_FILES = [
	"agents/sol-high-wrapper.md",
	"agents/sol-medium-wrapper.md",
	"agents/luna-max-wrapper.md",
	"agents/opencode-wrapper.md",
	"agents/grok-wrapper.md",
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
	"agents/sol-high-wrapper.md":
		"110882784feeda0b60889a65424289238b0dee7864beddb817734513eb6a9191",
	"agents/sol-medium-wrapper.md":
		"b4d38ad18a22482081a7348724b0beb9474808bf26a722ce9eb947b796f6f81b",
	"agents/luna-max-wrapper.md":
		"ce3e349667d796e0dda146bb347e960e574d4eb89e7e2f6790b058fd98709656",
	"agents/opencode-wrapper.md":
		"c0e853b96e71ea0da5a397203945c1a06262f17758378e74b13ea65bec5e3386",
	"agents/grok-wrapper.md":
		"69f0876934f8aeea6ec62d90d694ea481b1bc1906b2ea16a9a40cbb14e1b4130",
	"agents/fable-planner.md":
		"f3f8f61d17972237eff9d6282007b65cb45133ce5f551bb44756f7da0f780567",
	"agents/opus-reviewer.md":
		"5ae2914bdf3b846cb76fc60ba9bf683de782d40a60bf14d50d325e874ae002e8",
	"agents/run-codex-task.sh":
		"eb327792e5b2702cba9ba9c22f77fc0aab4177016491e81abfb4e2addd7b884e",
	"agents/run-opencode-seat.sh":
		"476e35ed2469a3f4b5c6f1e5baa1c022432ef8cfaaed03c4f831b5e560a50307",
	"agents/validate-codex-wrapper.sh":
		"2170491a79707e2bfdabefa5feb54b8fc894c6690106d540a29fd98b68b92c2a",
	"agents/codex-result.schema.json":
		"cccad847ac6a90694bbad15daddc42f4a55f7219a5ed9f717db4dcdfc7e4bfa0",
	"agents/prepare-pr-review-render-workspace.sh":
		"01b03b63b1fa35318964b13c8a6dc86395201f0e42ebfb04c6134fb8996a15c4",
	"skills/discovering-work/SKILL.md":
		"9d618579ceabafdf4f336122b6f58648fd3c001e3ecc69f5b7502b95db494471",
	"skills/discovering-work/agents/openai.yaml":
		"61d4bfdd85a518acacc2ec655f483049173290946faca7536b436857ca5d7583",
	"skills/implement-work/SKILL.md":
		"9842546ad4da3fe13a33c206e9bb2631b8bd5970fd315b0faa4b8d5a2d5f97a5",
	"skills/review-pr/SKILL.md":
		"0921974b2befd9d4c6c414c6f84f409c24af0ef553e5ed369ce50d892d9dceb1",
	"skills/create-pr/SKILL.md":
		"f13a38f8d00da88415f2ae97d4c0285d3c98bd0490081d0bd497a7c0c33362cf",
	"skills/brainstorm/SKILL.md":
		"1424c54e3d8d998322928bfe039c754f1d4b8d4aaa3a3507d99c8fd5ea30a1b7",
	"skills/babysit-pr/SKILL.md":
		"10720a23c158b5249bb9b9379c8a41ab21cd46ba9c10a74cf3dfed7dc17d7d66",
	"skills/linear-ticketing/SKILL.md":
		"3612162702391ebebf93c6f177bfebbd036386fa7fd348d2b49ef5a0ae8c48d8",
	"skills/html-explainer/SKILL.md":
		"3cb1a31a9965145f9b0ac3f85648baa0c0262965c60a1870957ef0323f9e37e5",
	"skills/html-explainer/template.html":
		"f467f7333d3812705f77bec340a47c18a22f4fd1c1dd19a1502214627028e5c3",
};

function digest(contents) {
	return createHash("sha256").update(contents).digest("hex");
}

function runOpencodeReceiptFixture(fixtureName, version) {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "opencode-receipt-boundary-"),
	);
	const workspace = path.join(root, "workspace");
	const fakeBin = path.join(root, "bin");
	const fakeHome = path.join(root, "home");
	const realOpencode = path.join(root, "real-opencode");
	fs.mkdirSync(workspace);
	fs.mkdirSync(fakeBin);
	fs.mkdirSync(path.join(fakeHome, ".local", "share", "opencode"), {
		recursive: true,
	});
	fs.mkdirSync(path.join(fakeHome, ".config", "opencode"), {
		recursive: true,
	});
	fs.copyFileSync("/bin/true", realOpencode);
	fs.chmodSync(realOpencode, 0o755);
	fs.writeFileSync(path.join(workspace, "prompt.md"), "Return result JSON.\n");
	fs.writeFileSync(path.join(workspace, "scope.txt"), "hello.txt\n");
	const init = Bun.spawnSync(["git", "init", "--quiet"], { cwd: workspace });
	expect(init.exitCode).toBe(0);

	fs.writeFileSync(
		path.join(fakeBin, "bwrap"),
		`#!/bin/bash
for ((i = 1; i <= $#; i++)); do
  if [ "\${!i}" = --version ]; then
    printf '%s\\n' "$FAKE_OPENCODE_VERSION"
    exit 0
  fi
  if [ "\${!i}" = export ]; then
    printf '%s' "$FAKE_EXPORT_STDOUT"
    exit 0
  fi
done
printf '%s\\n' '{"type":"text","sessionID":"ses_test","part":{"text":"{\\"status\\":\\"completed\\",\\"summary\\":\\"done\\",\\"changed_paths\\":[],\\"verification\\":[{\\"command\\":\\"true\\",\\"exit_code\\":0,\\"evidence\\":\\"ok\\"}]}"}}'
`,
		{ mode: 0o755 },
	);

	const fixturePath = path.join(FIXTURES_DIR, fixtureName);
	const exportStdout = fs.readFileSync(fixturePath, "utf8");
	const result = Bun.spawnSync(
		[
			"bash",
			OPENCODE_LAUNCHER_PATH,
			"--mode",
			"implementation",
			"--workspace",
			workspace,
			"--prompt-file",
			path.join(workspace, "prompt.md"),
			"--scope-file",
			path.join(workspace, "scope.txt"),
		],
		{
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				CODEX_WRAPPER_GATEWAY: "opencode-wrapper",
				FAKE_EXPORT_STDOUT: exportStdout,
				FAKE_OPENCODE_VERSION: version,
				HOME: fakeHome,
				OPENCODE_SEAT_BIN: realOpencode,
				PATH: `${fakeBin}:${process.env.PATH}`,
			},
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	fs.rmSync(root, { force: true, recursive: true });
	return {
		exportJson: JSON.parse(exportStdout),
		result,
	};
}

it("opencode receipt compatibility extracts the 1.18.x export shape", () => {
	const { result } = runOpencodeReceiptFixture(
		"opencode-export-1.18.json",
		"1.18.18",
	);
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	const report = JSON.parse(result.stdout.toString());
	expect(report.launcher_status).toBe("ok");
	expect(report.receipt).toEqual({
		modelID: "glm-5.3",
		providerID: "opencode-go",
		variant: "high",
	});
});

it("opencode receipt compatibility extracts the 1.1.x messages shape", () => {
	const { exportJson, result } = runOpencodeReceiptFixture(
		"opencode-export-1.1.json",
		"1.1.51",
	);
	expect(exportJson.info.model).toBeUndefined();
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	const report = JSON.parse(result.stdout.toString());
	expect(report.launcher_status).toBe("ok");
	expect(report.receipt).toEqual({
		modelID: "glm-5.3",
		providerID: "opencode-go",
		variant: "high",
	});
});

it("opencode receipt compatibility fails closed when neither shape is complete", () => {
	const { result } = runOpencodeReceiptFixture(
		"opencode-export-invalid.json",
		"1.1.51",
	);
	expect(result.exitCode, result.stderr.toString()).toBe(70);
	const report = JSON.parse(result.stdout.toString());
	expect(report.launcher_status).toBe("blocked_invalid_receipt");
	expect(report.receipt).toEqual({
		modelID: "",
		providerID: "",
		variant: "",
	});
});

it("opencode receipt compatibility rejects a mismatched 1.1.x receipt", () => {
	const { result } = runOpencodeReceiptFixture(
		"opencode-export-mismatch-1.1.json",
		"1.1.51",
	);
	expect(result.exitCode, result.stderr.toString()).toBe(70);
	expect(JSON.parse(result.stdout.toString()).launcher_status).toBe(
		"blocked_receipt_mismatch",
	);
});

it("opencode receipt compatibility records version drift without gating", () => {
	const { result } = runOpencodeReceiptFixture(
		"opencode-export-1.18.json",
		"9.9.9",
	);
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	const report = JSON.parse(result.stdout.toString());
	expect(report.launcher_status).toBe("ok");
	expect(report.opencode_version).toBe("9.9.9");
});

it("opencode receipt compatibility falls back when the first shape has an empty model id", () => {
	const { result } = runOpencodeReceiptFixture(
		"opencode-export-fallback-1.1.json",
		"1.1.51",
	);
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	expect(JSON.parse(result.stdout.toString()).receipt).toEqual({
		modelID: "glm-5.3",
		providerID: "opencode-go",
		variant: "high",
	});
});

it("opencode receipt compatibility records an omitted variant as empty", () => {
	const { result } = runOpencodeReceiptFixture(
		"opencode-export-no-variant-1.1.json",
		"1.1.51",
	);
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	expect(JSON.parse(result.stdout.toString()).receipt).toEqual({
		modelID: "glm-5.3",
		providerID: "opencode-go",
		variant: "",
	});
});

// The pinned private commit predates the seat renames, and that repository has
// since removed the runtime. Repo-local PINNED_DIGESTS detect unreviewed drift.

it("deploys the complete public Claude fallback runtime into a fresh home", async () => {
	expect(PERSONAL_FILES.map((file) => file.src)).toEqual([
		"CLAUDE.md",
		"statusline-command.sh",
		"gitignore.template",
		...RUNTIME_FILES,
	]);
	expect(
		PERSONAL_FILES.some(
			(file) =>
				file.src.startsWith("skills/omarchy/") ||
				file.src.startsWith("skills/diagnose-crash/"),
		),
	).toBe(false);

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
