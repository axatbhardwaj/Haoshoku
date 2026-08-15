import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const CONFIGS_DIR = path.resolve(import.meta.dir, "..", "configs");

function listFilesRecursive(dir) {
	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFilesRecursive(full));
		} else {
			files.push(full);
		}
	}
	return files;
}

describe("Omarchy 4 theme-state path", () => {
	it("no config template references the pre-Omarchy-4 path ~/.config/omarchy/current", () => {
		const stalePath = "~/.config/omarchy/current";
		const offenders = listFilesRecursive(CONFIGS_DIR)
			.filter((file) => fs.readFileSync(file, "utf-8").includes(stalePath))
			.map((file) => path.relative(path.dirname(CONFIGS_DIR), file));

		expect(offenders).toEqual([]);
	});
});
