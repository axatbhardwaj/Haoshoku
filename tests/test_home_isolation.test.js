import { expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

it("isolates default agent-account writes before setup modules load", () => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-home-guard-"));
	const original = path.join(scratch, "original-home");
	const testFile = path.join(scratch, "default-home.test.js");
	fs.mkdirSync(original);
	fs.writeFileSync(path.join(original, "preserve"), "original-home bytes\n");
	const helper = path.resolve(
		import.meta.dir,
		"../src/helpers/configure_agent_accounts.js",
	);
	fs.writeFileSync(
		testFile,
		`
		import { expect, it } from "bun:test";
		import fs from "node:fs";
		import { homedir } from "node:os";
		import path from "node:path";
		import { configureAgentAccounts } from ${JSON.stringify(helper)};
		it("uses a disposable home even without a helper stub", () => {
			const home = homedir();
			expect(home).not.toBe(${JSON.stringify(original)});
			fs.mkdirSync(path.join(home, ".claude"));
			fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "fixture profile");
			expect(configureAgentAccounts()).toBe(true);
			expect(fs.realpathSync(path.join(home, ".claude-alt", "CLAUDE.md"))).toBe(path.join(home, ".claude", "CLAUDE.md"));
		});
	`,
	);
	try {
		const child = Bun.spawnSync([process.execPath, "test", testFile], {
			cwd: path.resolve(import.meta.dir, ".."),
			env: { ...process.env, HOME: original },
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(child.exitCode, `${child.stdout}${child.stderr}`).toBe(0);
		expect(fs.readdirSync(original)).toEqual(["preserve"]);
		expect(fs.readFileSync(path.join(original, "preserve"), "utf8")).toBe(
			"original-home bytes\n",
		);
	} finally {
		fs.rmSync(scratch, { recursive: true });
	}
});
