import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	AGENT_TARGETS,
	backupAgentsConfig,
	syncAgentsConfig,
} from "../src/helpers/configure_agents.js";

describe("AGENT_TARGETS manifest", () => {
	it("covers claude, codex, opencode and antigravity", () => {
		expect(AGENT_TARGETS).toEqual([
			{ src: "PROFILE.md", destDir: ".claude", dest: "CLAUDE.md" },
			{ src: "PROFILE.md", destDir: ".codex", dest: "AGENTS.md" },
			{
				src: "PROFILE.md",
				destDir: ".config/opencode",
				dest: "AGENTS.md",
			},
			{
				src: "PROFILE.md",
				destDir: ".gemini",
				dest: "GEMINI.md",
				append: "GEMINI.append.md",
			},
		]);
	});
});

describe("shared agent profile round trip", () => {
	let tmpDir;
	let srcDir;
	let home;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-agents-"));
		srcDir = path.join(tmpDir, "configs", "agent-profile");
		home = path.join(tmpDir, "home");
		fs.mkdirSync(srcDir, { recursive: true });
	});

	afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

	it("deploys PROFILE.md verbatim to claude, codex and opencode", async () => {
		fs.writeFileSync(path.join(srcDir, "PROFILE.md"), "SHARED");
		await syncAgentsConfig({ srcDir, home });
		for (const target of AGENT_TARGETS.filter((t) => !t.append)) {
			expect(
				fs.readFileSync(path.join(home, target.destDir, target.dest), "utf-8"),
			).toBe("SHARED");
		}
	});

	it("appends the harness note only to the Antigravity profile", async () => {
		fs.writeFileSync(path.join(srcDir, "PROFILE.md"), "SHARED");
		fs.writeFileSync(path.join(srcDir, "GEMINI.append.md"), "ANTIGRAVITY-ONLY");
		await syncAgentsConfig({ srcDir, home });
		expect(
			fs.readFileSync(path.join(home, ".gemini", "GEMINI.md"), "utf-8"),
		).toBe("SHARED\n\nANTIGRAVITY-ONLY");
		expect(
			fs.readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf-8"),
		).toBe("SHARED");
	});

	it("skips a second sync when every destination is already in sync", async () => {
		fs.writeFileSync(path.join(srcDir, "PROFILE.md"), "SHARED");
		fs.writeFileSync(path.join(srcDir, "GEMINI.append.md"), "ANTIGRAVITY-ONLY");
		await syncAgentsConfig({ srcDir, home });
		await syncAgentsConfig({ srcDir, home });
		expect(fs.existsSync(path.join(home, ".gemini", "GEMINI.md.bak"))).toBe(
			false,
		);
	});

	it("backs up a differing live file before overwriting", async () => {
		fs.writeFileSync(path.join(srcDir, "PROFILE.md"), "BUNDLE");
		const livePath = path.join(home, ".claude", "CLAUDE.md");
		fs.mkdirSync(path.dirname(livePath), { recursive: true });
		fs.writeFileSync(livePath, "LIVE");
		await syncAgentsConfig({ srcDir, home });
		expect(
			fs.readFileSync(path.join(home, ".claude", "CLAUDE.md.bak"), "utf-8"),
		).toBe("LIVE");
	});

	it("backs up the primary live profile into the bundle", async () => {
		const livePath = path.join(home, ".claude", "CLAUDE.md");
		fs.mkdirSync(path.dirname(livePath), { recursive: true });
		fs.writeFileSync(livePath, "LIVE-EDIT");
		await backupAgentsConfig({ srcDir, home });
		expect(fs.readFileSync(path.join(srcDir, "PROFILE.md"), "utf-8")).toBe(
			"LIVE-EDIT",
		);
	});

	it("makes the exact live home portable during backup", async () => {
		const livePath = path.join(home, ".claude", "CLAUDE.md");
		fs.mkdirSync(path.dirname(livePath), { recursive: true });
		fs.writeFileSync(livePath, `skill=${home}/.agents/skills/x/SKILL.md\n`);
		await backupAgentsConfig({ srcDir, home });
		expect(fs.readFileSync(path.join(srcDir, "PROFILE.md"), "utf8")).toBe(
			"skill=~/.agents/skills/x/SKILL.md\n",
		);
	});
});
