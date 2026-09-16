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
	it("tracks only the live personal policy", () => {
		expect(CODEX_PERSONAL_FILES).toEqual([{ src: "AGENTS.md" }]);
	});
});

describe("Codex config round trip", () => {
	let tmpDir, configsDir, codexHome, codexDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-codex-"));
		configsDir = path.join(tmpDir, "configs", "codex");
		codexHome = path.join(tmpDir, "codex-home");
		codexDir = path.join(codexHome, ".codex");
		fs.mkdirSync(configsDir, { recursive: true });
	});

	afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

	it("deploys AGENTS.md into a fresh ~/.codex", async () => {
		fs.writeFileSync(path.join(configsDir, "AGENTS.md"), "BUNDLE");
		await syncCodexConfig({ srcDir: configsDir, codexHome });
		expect(fs.readFileSync(path.join(codexDir, "AGENTS.md"), "utf-8")).toBe(
			"BUNDLE",
		);
	});

	it("backs up a differing live AGENTS.md before overwriting", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		fs.writeFileSync(path.join(codexDir, "AGENTS.md"), "LIVE");
		fs.writeFileSync(path.join(configsDir, "AGENTS.md"), "BUNDLE");
		await syncCodexConfig({ srcDir: configsDir, codexHome });
		expect(fs.readFileSync(path.join(codexDir, "AGENTS.md.bak"), "utf-8")).toBe(
			"LIVE",
		);
	});

	it("backs up the live AGENTS.md into the bundle", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		fs.writeFileSync(path.join(codexDir, "AGENTS.md"), "LIVE-EDIT");
		await backupCodexConfig({ srcDir: configsDir, codexHome });
		expect(fs.readFileSync(path.join(configsDir, "AGENTS.md"), "utf-8")).toBe(
			"LIVE-EDIT",
		);
	});

	it("makes the exact live home portable during AGENTS.md backup", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		fs.writeFileSync(
			path.join(codexDir, "AGENTS.md"),
			`skill=${codexHome}/.agents/skills/model-routing/SKILL.md\nother=/home/alice/private\n`,
		);

		await backupCodexConfig({ srcDir: configsDir, codexHome });

		expect(fs.readFileSync(path.join(configsDir, "AGENTS.md"), "utf8")).toBe(
			"skill=~/.agents/skills/model-routing/SKILL.md\nother=/home/alice/private\n",
		);
	});
});

describe("Codex installation", () => {
	it("installs the package when codex is missing", async () => {
		const commands = [];
		const result = await installCodex({
			commandExists: () => false,
			run: async (command) => {
				commands.push(command);
				return true;
			},
		});
		expect(commands).toEqual(["bun install -g @openai/codex"]);
		expect(result).toEqual({ ok: true, reason: "installed" });
	});

	it("skips installation when codex already exists", async () => {
		const commands = [];
		const result = await installCodex({
			commandExists: () => true,
			run: async (command) => commands.push(command),
		});
		expect(commands).toEqual([]);
		expect(result).toEqual({ ok: true, reason: "already installed" });
	});

	it("reports a failed package installation truthfully", async () => {
		const result = await installCodex({
			commandExists: () => false,
			run: async () => false,
		});
		expect(result).toEqual({ ok: false, reason: "install command failed" });
	});

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
					run: async (command) => {
						commands.push(command);
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
