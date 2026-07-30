import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("haoshoku CLI help", () => {
	function helpTextFor(flag) {
		const source = fs.readFileSync(
			path.resolve(import.meta.dir, "..", "haoshoku.js"),
			"utf-8",
		);
		const helpText = source.match(
			new RegExp(`\\.option\\(\\s*"${flag}",\\s*"([^"]+)"`, "s"),
		)?.[1];

		expect(helpText).toBeDefined();
		return helpText;
	}

	it("--claude advertises only its three deployed files", () => {
		expect(helpTextFor("--claude")).toBe(
			"Deploy Claude Code config (CLAUDE.md, statusline, .gitignore)",
		);
	});

	it("--claude-backup advertises a personal-files-only backup", () => {
		expect(helpTextFor("--claude-backup")).toBe(
			"Backup Claude Code personal files to configs/claude/",
		);
	});
});
