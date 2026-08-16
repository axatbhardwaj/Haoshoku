import { expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

it("migrates stale agy functions before defining the Antigravity alias", () => {
	const config = fs.readFileSync(
		path.join(import.meta.dir, "..", "configs", "fish", "config.fish"),
		"utf8",
	);
	const migrationIndex = config.indexOf("functions --erase agy");
	const aliasIndex = config.indexOf('alias antigravity="command agy"');

	expect(migrationIndex).toBeGreaterThanOrEqual(0);
	expect(aliasIndex).toBeGreaterThan(migrationIndex);
	expect(config).not.toContain("--new-window");
});
