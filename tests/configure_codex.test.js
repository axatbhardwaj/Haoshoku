import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	backupCodexConfig,
	CODEX_PERSONAL_FILES,
	configureCodex,
	installCodex,
	syncCodexConfig,
} from "../src/helpers/configure_codex.js";

describe("CODEX_PERSONAL_FILES manifest", () => {
	it("tracks AGENTS.md and the bundled Samvada skill", () => {
		expect(CODEX_PERSONAL_FILES.map((f) => f.src)).toEqual([
			"AGENTS.md",
			"skills/samvada-html-deliverables/SKILL.md",
			"skills/samvada-html-deliverables/agents/openai.yaml",
			"skills/samvada-html-deliverables/template.html",
		]);
	});
});

describe("syncCodexConfig", () => {
	let tmpDir, configsDir, codexHome, codexDir;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-codex-"));
		configsDir = path.join(tmpDir, "configs", "codex");
		codexHome = path.join(tmpDir, "codex-home");
		codexDir = path.join(codexHome, ".codex");
		fs.mkdirSync(configsDir, { recursive: true });
		fs.mkdirSync(path.join(configsDir, "skills", "samvada-html-deliverables"), {
			recursive: true,
		});
	});
	afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

	it("deploys AGENTS.md into a fresh ~/.codex", async () => {
		fs.writeFileSync(path.join(configsDir, "AGENTS.md"), "BUNDLE");
		await syncCodexConfig({ srcDir: configsDir, codexHome });
		expect(fs.readFileSync(path.join(codexDir, "AGENTS.md"), "utf-8")).toBe(
			"BUNDLE",
		);
	});

	it("backs up a differing live AGENTS.md to .bak before overwriting", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		fs.writeFileSync(path.join(codexDir, "AGENTS.md"), "LIVE");
		fs.writeFileSync(path.join(configsDir, "AGENTS.md"), "BUNDLE");
		await syncCodexConfig({ srcDir: configsDir, codexHome });
		expect(fs.readFileSync(path.join(codexDir, "AGENTS.md.bak"), "utf-8")).toBe(
			"LIVE",
		);
		expect(fs.readFileSync(path.join(codexDir, "AGENTS.md"), "utf-8")).toBe(
			"BUNDLE",
		);
	});

	it("round-trips via backupCodexConfig", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		fs.writeFileSync(path.join(codexDir, "AGENTS.md"), "LIVE-EDIT");
		await backupCodexConfig({ srcDir: configsDir, codexHome });
		expect(fs.readFileSync(path.join(configsDir, "AGENTS.md"), "utf-8")).toBe(
			"LIVE-EDIT",
		);
	});

	it("deploys and round-trips the Samvada skill files", async () => {
		const skill = path.join("skills", "samvada-html-deliverables");
		const bundledSkill = path.join(configsDir, skill);
		const liveSkill = path.join(codexDir, skill);
		const files = [
			["SKILL.md", "bundle skill\n", "live skill\n"],
			["agents/openai.yaml", "bundle metadata\n", "live metadata\n"],
			["template.html", "bundle template\n", "live template\n"],
		];
		fs.mkdirSync(path.join(bundledSkill, "agents"), { recursive: true });
		for (const [relativePath, bundledContents] of files) {
			fs.writeFileSync(path.join(bundledSkill, relativePath), bundledContents);
		}

		await syncCodexConfig({ srcDir: configsDir, codexHome });

		for (const [relativePath, bundledContents, liveContents] of files) {
			expect(fs.readFileSync(path.join(liveSkill, relativePath), "utf8")).toBe(
				bundledContents,
			);
			fs.writeFileSync(path.join(liveSkill, relativePath), liveContents);
		}
		fs.writeFileSync(path.join(liveSkill, "stale.txt"), "do not bundle\n");
		await backupCodexConfig({ srcDir: configsDir, codexHome });

		for (const [relativePath, , liveContents] of files) {
			expect(
				fs.readFileSync(path.join(bundledSkill, relativePath), "utf8"),
			).toBe(liveContents);
		}
		expect(fs.existsSync(path.join(bundledSkill, "stale.txt"))).toBe(false);
	});

	it("backs up a differing Samvada file before overwriting it", async () => {
		const skill = path.join("skills", "samvada-html-deliverables");
		const bundledSkill = path.join(configsDir, skill);
		const liveSkill = path.join(codexDir, skill);
		fs.mkdirSync(path.join(bundledSkill, "agents"), { recursive: true });
		fs.mkdirSync(path.join(liveSkill, "agents"), { recursive: true });
		fs.writeFileSync(path.join(bundledSkill, "SKILL.md"), "bundle skill\n");
		fs.writeFileSync(path.join(liveSkill, "SKILL.md"), "live skill\n");

		await syncCodexConfig({ srcDir: configsDir, codexHome });

		expect(fs.readFileSync(path.join(liveSkill, "SKILL.md.bak"), "utf8")).toBe(
			"live skill\n",
		);
		expect(fs.readFileSync(path.join(liveSkill, "SKILL.md"), "utf8")).toBe(
			"bundle skill\n",
		);
	});
});

describe("installCodex", () => {
	it("installs the @openai/codex package when the codex command is missing", async () => {
		const commands = [];

		await installCodex({
			commandExists: () => false,
			run: async (cmd) => {
				commands.push(cmd);
				return true;
			},
		});

		expect(commands).toEqual(["bun install -g @openai/codex"]);
	});

	it("skips installation when the codex command already exists", async () => {
		const commands = [];

		await installCodex({
			commandExists: () => true,
			run: async (cmd) => {
				commands.push(cmd);
				return true;
			},
		});

		expect(commands).toEqual([]);
	});
});

describe("configureCodex", () => {
	it("installs Codex before syncing AGENTS.md", async () => {
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-codex-configure-"),
		);
		try {
			const configsDir = path.join(tmpDir, "configs", "codex");
			const codexHome = path.join(tmpDir, "codex-home");
			const codexDir = path.join(codexHome, ".codex");
			fs.mkdirSync(configsDir, { recursive: true });
			fs.writeFileSync(path.join(configsDir, "AGENTS.md"), "BUNDLE");

			const commands = [];
			await configureCodex({
				srcDir: configsDir,
				codexHome,
				installOptions: {
					commandExists: () => false,
					run: async (cmd) => {
						commands.push(cmd);
						expect(fs.existsSync(path.join(codexDir, "AGENTS.md"))).toBe(false);
						return true;
					},
				},
			});

			expect(commands).toEqual(["bun install -g @openai/codex"]);
			expect(fs.readFileSync(path.join(codexDir, "AGENTS.md"), "utf-8")).toBe(
				"BUNDLE",
			);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
