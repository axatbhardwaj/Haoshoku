import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const desktopPath = path.join(
	repoRoot,
	"configs",
	"mimeapps",
	"applications",
	"chromium.desktop",
);
const wrapperPath = path.join(
	repoRoot,
	"configs",
	"scripts",
	"haoshoku-chromium-flux",
);

describe("Flux Chromium integration", () => {
	it("keeps the desktop Exec command paired with the deployed wrapper", () => {
		expect(fs.existsSync(desktopPath)).toBe(true);
		expect(fs.existsSync(wrapperPath)).toBe(true);

		const execLine = fs
			.readFileSync(desktopPath, "utf8")
			.split("\n")
			.find((line) => line.startsWith("Exec="));
		expect(execLine).toBeDefined();
		const execFirstField = execLine
			.slice("Exec=".length)
			.trim()
			.match(/^\S+/)?.[0];
		expect(execFirstField).toBeDefined();
		expect(execFirstField).toMatch(/^\S+$/);
		expect(path.isAbsolute(execFirstField)).toBe(false);
		expect(execFirstField).toBe(path.basename(wrapperPath));
	});

	it("keeps the wrapper on the isolated flux profile", () => {
		expect(fs.existsSync(wrapperPath)).toBe(true);
		const wrapper = fs.readFileSync(wrapperPath, "utf8");
		expect(wrapper).toMatch(
			/--user-data-dir=(?:"?(?:\$\{HOME\}|\$HOME|~)\/\.config\/chromium-haoshoku\/flux"?)/,
		);
	});
});
