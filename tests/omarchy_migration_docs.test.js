import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

describe("Omarchy migration documentation", () => {
	it("accurately documents all v4-gated helpers and hyprctl dispatch semantics", () => {
		const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
		expect(changelog.replace(/\s+/g, " ")).toContain(
			"Migration, workspaces, hyprmoncfg, and plugin helpers gate on the installed Omarchy major version.",
		);
		expect(changelog.replace(/\s+/g, " ")).toContain(
			"Dispatch exit status is not treated as a failure signal; only an unrunnable `hyprctl` fails the launcher.",
		);
		expect(changelog).not.toContain(
			"Dispatch failures in `haoshoku-special-workspace` propagate instead of being masked.",
		);
	});

	it("documents the Omarchy plugin manifest in common/CLAUDE.md", () => {
		const commonDocs = fs.readFileSync(
			path.join(root, "common", "CLAUDE.md"),
			"utf8",
		);
		expect(commonDocs).toContain("`omarchy-plugins.json`");
		expect(commonDocs).toContain("Omarchy plugin");
	});
});
