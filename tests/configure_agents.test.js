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

describe("bundled shared agent profile", () => {
	it("leaves Axstack instruction ownership to its installer", () => {
		for (const relativePath of [
			"configs/agent-profile/PROFILE.md",
			"configs/claude/CLAUDE.md",
			"configs/codex/AGENTS.md",
		]) {
			expect(
				fs.readFileSync(path.join(import.meta.dir, "..", relativePath), "utf8"),
				relativePath,
			).not.toContain("axstack:begin");
		}
	});
	it("keeps bundled global templates aligned with the shared agent profile", () => {
		const read = (relativePath) =>
			fs.readFileSync(path.join(import.meta.dir, "..", relativePath), "utf8");
		const profile = read("configs/agent-profile/PROFILE.md");
		for (const relativePath of [
			"configs/codex/AGENTS.md",
			"configs/claude/CLAUDE.md",
		]) {
			const template = read(relativePath);
			expect(template, relativePath).toContain("## Notifications");
			expect(template, relativePath).toBe(profile);
			expect(template, relativePath).toContain("T3 Code orchestration");
			expect(template, relativePath).toContain("Axstack workflows");
			expect(template, relativePath).toContain("gh stack");
		}
	});

	it("routes Notion and Linear MCP access through Executor", () => {
		for (const relativePath of [
			"configs/agent-profile/PROFILE.md",
			"configs/claude/CLAUDE.md",
			"configs/codex/AGENTS.md",
		]) {
			const profile = fs.readFileSync(
				path.join(import.meta.dir, "..", relativePath),
				"utf8",
			);
			expect(profile).toContain(
				"Use the configured `executor` MCP for Notion and Linear access",
			);
			expect(profile).toContain("including both\nNotion accounts.");
			expect(profile).toContain(
				"Use Linear only for repositories in the `defi-com` GitHub organization.",
			);
			expect(profile).toContain("Keep specs for other repositories on GitHub");
			expect(profile).not.toMatch(/orca-linear|`orca linear/i);
		}
	});
});

const axstackBlock =
	"<!-- axstack:begin v1 -->\nManaged by Axstack; preserve these exact bytes.\n<!-- axstack:end -->";

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

	it("preserves each existing Axstack block across profile resyncs", async () => {
		fs.writeFileSync(path.join(srcDir, "PROFILE.md"), "UPDATED\n");
		fs.writeFileSync(path.join(srcDir, "GEMINI.append.md"), "HARNESS\n");
		for (const target of AGENT_TARGETS) {
			const live = path.join(home, target.destDir, target.dest);
			fs.mkdirSync(path.dirname(live), { recursive: true });
			fs.writeFileSync(live, `OLD\n\n${axstackBlock}\nOLD-TAIL`);
		}
		await syncAgentsConfig({ srcDir, home });
		for (const target of AGENT_TARGETS) {
			const live = path.join(home, target.destDir, target.dest);
			expect(fs.readFileSync(live, "utf8")).toBe(
				`${target.append ? "UPDATED\n\nHARNESS" : "UPDATED"}\n\n${axstackBlock}\n`,
			);
		}
		const before = AGENT_TARGETS.map((t) =>
			fs.readdirSync(path.join(home, t.destDir)),
		);
		await syncAgentsConfig({ srcDir, home });
		expect(
			AGENT_TARGETS.map((t) => fs.readdirSync(path.join(home, t.destDir))),
		).toEqual(before);
	});

	it("strips the Axstack block from shared backups without changing live bytes", async () => {
		const live = path.join(home, ".claude", "CLAUDE.md");
		fs.mkdirSync(path.dirname(live), { recursive: true });
		const original = `BEFORE\n\n${axstackBlock}\n\nAFTER\n`;
		fs.writeFileSync(live, original);
		await backupAgentsConfig({ srcDir, home });
		expect(fs.readFileSync(path.join(srcDir, "PROFILE.md"), "utf8")).toBe(
			"BEFORE\n\nAFTER\n",
		);
		expect(fs.readFileSync(live, "utf8")).toBe(original);
	});

	for (const newline of ["\n", "\r\n"]) {
		it(`keeps neighbouring profile lines separate during ${JSON.stringify(newline)} backup`, async () => {
			const live = path.join(home, ".claude", "CLAUDE.md");
			fs.mkdirSync(path.dirname(live), { recursive: true });
			const block = axstackBlock.replace(/\n/g, newline);
			const original = `A${newline}${block}${newline}B`;
			fs.writeFileSync(live, original);
			await backupAgentsConfig({ srcDir, home });
			expect(fs.readFileSync(path.join(srcDir, "PROFILE.md"), "utf8")).toBe(
				`A${newline}B`,
			);
			expect(fs.readFileSync(live, "utf8")).toBe(original);
		});
	}

	it("deploys PROFILE.md verbatim to claude, codex and opencode", async () => {
		fs.writeFileSync(path.join(srcDir, "PROFILE.md"), "SHARED");
		await syncAgentsConfig({ srcDir, home });
		for (const target of AGENT_TARGETS.filter((t) => !t.append)) {
			expect(
				fs.readFileSync(path.join(home, target.destDir, target.dest), "utf-8"),
			).toBe("SHARED");
		}
	});

	it("deploys the bundled Executor tailnet URL to Claude and Codex", async () => {
		await syncAgentsConfig({ home });
		for (const relativePath of [".claude/CLAUDE.md", ".codex/AGENTS.md"]) {
			expect(
				fs.readFileSync(path.join(home, relativePath), "utf8"),
				relativePath,
			).toContain("https://axat-vps.tail140c22.ts.net/mcp");
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
