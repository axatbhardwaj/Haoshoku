import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeCodexStatusLine } from "../src/helpers/codex_status_line.js";
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

	it("merges the native footer while preserving unrelated config and a private rollback", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		const live =
			'# keep this comment\nmodel = "custom"\n[mcp_servers.executor]\ncommand = "private"\n[tui]\nnotifications = true\nstatus_line = ["old"] # keep\n';
		fs.writeFileSync(path.join(codexDir, "config.toml"), live);
		fs.writeFileSync(
			path.join(configsDir, "status-line.toml"),
			'[tui]\nstatus_line = ["model-with-reasoning", "current-dir", "git-branch", "context-remaining", "five-hour-limit", "weekly-limit", "fast-mode"]\n',
		);
		await syncCodexConfig({ srcDir: configsDir, codexHome });
		const changed = fs.readFileSync(path.join(codexDir, "config.toml"), "utf8");
		expect(Bun.TOML.parse(changed).tui.status_line).toEqual([
			"model-with-reasoning",
			"current-dir",
			"git-branch",
			"context-remaining",
			"five-hour-limit",
			"weekly-limit",
			"fast-mode",
		]);
		expect(changed).toContain(
			'# keep this comment\nmodel = "custom"\n[mcp_servers.executor]\ncommand = "private"',
		);
		expect(changed).toContain("notifications = true");
		expect(
			fs.readFileSync(path.join(codexDir, "config.toml.bak"), "utf8"),
		).toBe(live);
		await syncCodexConfig({ srcDir: configsDir, codexHome });
		expect(fs.readFileSync(path.join(codexDir, "config.toml"), "utf8")).toBe(
			changed,
		);
		expect(
			fs.readFileSync(path.join(codexDir, "config.toml.bak"), "utf8"),
		).toBe(live);
	});

	it("exports only the footer value from the alternate Codex home", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		fs.writeFileSync(
			path.join(codexDir, "config.toml"),
			'model = "private"\n[mcp_servers.executor]\ncommand = "secret"\n[tui]\nstatus_line = ["git-branch", "fast-mode"]\nnotifications = true\n',
		);
		await backupCodexConfig({ srcDir: configsDir, codexHome });
		const exported = fs.readFileSync(
			path.join(configsDir, "status-line.toml"),
			"utf8",
		);
		expect(Bun.TOML.parse(exported)).toEqual({
			tui: { status_line: ["git-branch", "fast-mode"] },
		});
		expect(exported).not.toContain("secret");
		expect(exported).not.toContain("private");
		expect(fs.existsSync(path.join(configsDir, "config.toml"))).toBe(false);
	});

	it("rejects malformed config without changing it or its existing backup", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		const bad = '[tui]\nstatus_line = ["old"\n';
		fs.writeFileSync(path.join(codexDir, "config.toml"), bad);
		fs.writeFileSync(path.join(codexDir, "config.toml.bak"), "previous");
		fs.writeFileSync(
			path.join(configsDir, "status-line.toml"),
			'[tui]\nstatus_line = ["git-branch"]\n',
		);
		expect(
			syncCodexConfig({ srcDir: configsDir, codexHome }),
		).rejects.toThrow();
		expect(fs.readFileSync(path.join(codexDir, "config.toml"), "utf8")).toBe(
			bad,
		);
		expect(
			fs.readFileSync(path.join(codexDir, "config.toml.bak"), "utf8"),
		).toBe("previous");
	});

	it("updates a root dotted footer assignment without duplicating it", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		fs.writeFileSync(
			path.join(codexDir, "config.toml"),
			'tui.status_line = ["old"]\nmodel = "private"\n',
		);
		fs.writeFileSync(
			path.join(configsDir, "status-line.toml"),
			'[tui]\nstatus_line = ["git-branch"]\n',
		);
		await syncCodexConfig({ srcDir: configsDir, codexHome });
		const changed = fs.readFileSync(path.join(codexDir, "config.toml"), "utf8");
		expect(Bun.TOML.parse(changed)).toEqual({
			tui: { status_line: ["git-branch"] },
			model: "private",
		});
		expect(changed).toContain('model = "private"');
	});

	it("leaves an ambiguous inline TUI table untouched", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		const live = 'tui = { status_line = ["old"], notifications = true }\n';
		fs.writeFileSync(path.join(codexDir, "config.toml"), live);
		fs.writeFileSync(
			path.join(configsDir, "status-line.toml"),
			'[tui]\nstatus_line = ["git-branch"]\n',
		);
		expect(syncCodexConfig({ srcDir: configsDir, codexHome })).rejects.toThrow(
			"Ambiguous",
		);
		expect(fs.readFileSync(path.join(codexDir, "config.toml"), "utf8")).toBe(
			live,
		);
		expect(fs.existsSync(path.join(codexDir, "config.toml.bak"))).toBe(false);
	});

	it("keeps the original config if writing its replacement fails midway", () => {
		fs.mkdirSync(codexDir, { recursive: true });
		const livePath = path.join(codexDir, "config.toml");
		const bundlePath = path.join(configsDir, "status-line.toml");
		const original = 'model = "private"\n[tui]\nstatus_line = ["old"]\n';
		fs.writeFileSync(livePath, original);
		fs.writeFileSync(bundlePath, '[tui]\nstatus_line = ["git-branch"]\n');
		const write = fs.writeFileSync;
		fs.writeFileSync = (file, ...args) => {
			if (path.dirname(file) === codexDir && !file.endsWith(".bak")) {
				write(file, "partial");
				throw new Error("simulated write failure");
			}
			return write(file, ...args);
		};
		try {
			expect(() => writeCodexStatusLine(livePath, bundlePath)).toThrow(
				"simulated write failure",
			);
		} finally {
			fs.writeFileSync = write;
		}
		expect(fs.readFileSync(livePath, "utf8")).toBe(original);
	});

	it("rejects a symlinked config and creates private rollback files", async () => {
		fs.mkdirSync(codexDir, { recursive: true });
		const livePath = path.join(codexDir, "config.toml");
		const target = path.join(tmpDir, "target.toml");
		const original = '[tui]\nstatus_line = ["old"]\n';
		fs.writeFileSync(target, original);
		fs.symlinkSync(target, livePath);
		fs.writeFileSync(
			path.join(configsDir, "status-line.toml"),
			'[tui]\nstatus_line = ["git-branch"]\n',
		);
		expect(syncCodexConfig({ srcDir: configsDir, codexHome })).rejects.toThrow(
			"regular file",
		);
		expect(fs.readFileSync(target, "utf8")).toBe(original);
		fs.rmSync(livePath);
		fs.writeFileSync(livePath, original, { mode: 0o644 });
		fs.chmodSync(livePath, 0o644);
		await syncCodexConfig({ srcDir: configsDir, codexHome });
		expect(fs.statSync(`${livePath}.bak`).mode & 0o777).toBe(0o600);
		expect(fs.statSync(livePath).mode & 0o777).toBe(0o600);
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
