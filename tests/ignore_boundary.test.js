import { expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");

it("keeps local runtime ignore configuration explicit", () => {
	const projectIgnore = fs.readFileSync(
		path.join(PROJECT_ROOT, ".gitignore"),
		"utf8",
	);
	for (const expected of [
		".sidecar/",
		".todos/",
		".claude/",
		"tasks/",
		"/superpowers/",
		"/.worktrees/",
		"BRANCH-NOTES.md",
	]) {
		expect(projectIgnore).toContain(expected);
	}
	expect(projectIgnore).not.toContain("/report.json");

	const packageIgnore = fs.readFileSync(
		path.join(PROJECT_ROOT, ".npmignore"),
		"utf8",
	);
	for (const expected of [
		".claude/",
		"/.worktrees/",
		"superpowers/",
		"BRANCH-NOTES.md",
		".sidecar/",
		".todos/",
		"node_modules/",
	]) {
		expect(packageIgnore).toContain(expected);
	}
});
