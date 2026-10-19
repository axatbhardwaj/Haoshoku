import { expect, it } from "bun:test";
import path from "node:path";

it("describes the daily disk cleanup deployment in CLI help", () => {
	const result = Bun.spawnSync([
		process.execPath,
		path.resolve(import.meta.dir, "..", "haoshoku.js"),
		"--help",
	]);
	expect(result.exitCode).toBe(0);
	const help = result.stdout.toString().replace(/\s+/g, " ");
	expect(help).toContain("daily disk-cleanup timer");
	expect(help).toContain("~/.local/share/disk-cleanup/");
	expect(help).not.toContain("Friday timer");
});
