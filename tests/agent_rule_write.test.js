import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createRuleFixture, newRule, oldRule } from "./agent_rule_fixture.js";

describe("correction-rule file replacement", () => {
	let f;
	beforeEach(async () => {
		f = await createRuleFixture();
	});
	afterEach(() => fs.rmSync(f.root, { recursive: true }));

	it("requires an explicit CLI home even when HOME contains eligible profiles", () => {
		const result = Bun.spawnSync(
			[
				process.execPath,
				path.join(f.root, "scripts/agent-rule-patch.js"),
				"plan",
				"--evidence",
				f.evidenceDir,
			],
			{ env: { ...process.env, HOME: f.home } },
		);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stderr.toString()).reason).toContain("--home");
		expect(fs.existsSync(f.evidenceDir)).toBe(false);
		for (const file of f.destinations)
			expect(fs.readFileSync(file, "utf8")).toBe(f.original);
	});

	it("atomically replaces each file with complete bytes and the original mode and owner", () => {
		const file = f.destinations[0];
		fs.chmodSync(file, 0o640);
		const before = fs.statSync(file);
		f.run("plan");
		const rename = fs.renameSync;
		let observed = false;
		const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
			if (to === file) {
				observed = true;
				expect(path.dirname(from)).toBe(path.dirname(file));
				expect(fs.readFileSync(file, "utf8")).toBe(f.original);
				expect(fs.readFileSync(from, "utf8")).toBe(
					f.original.replace(oldRule, newRule),
				);
				const staged = fs.statSync(from);
				expect(staged.mode).toBe(before.mode);
				expect([staged.uid, staged.gid]).toEqual([before.uid, before.gid]);
			}
			return rename(from, to);
		});
		let result;
		try {
			result = f.run("deploy");
		} finally {
			spy.mockRestore();
		}
		expect(result.destinations.every((d) => d.status === "applied")).toBe(true);
		expect(observed).toBe(true);
		expect(fs.statSync(file).ino).not.toBe(before.ino);
		expect(fs.readdirSync(path.dirname(file))).toEqual(["CLAUDE.md"]);
		f.run("rollback");
		expect(fs.readFileSync(file, "utf8")).toBe(f.original);
		expect(fs.statSync(file).mode).toBe(before.mode);
	});
});
