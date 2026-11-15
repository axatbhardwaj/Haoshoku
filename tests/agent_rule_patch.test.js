import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncAgentsConfig } from "../src/helpers/configure_agents.js";

const oldRule =
	"- When I correct the same thing twice, write it here as one rule that day.";
const newRule =
	"- When I correct the same thing twice, make it a check, test or code change that day; the rule line here points to that check. Keep prose only for authority or judgement.";
const block =
	"<!-- axstack:begin v1 -->\r\nINSTALLER OWNED\r\n<!-- axstack:end -->";

describe("scoped correction-rule deployment", () => {
	let root;
	let home;
	let srcDir;
	let evidenceDir;
	let destinations;
	let original;
	const run = (mode) =>
		syncAgentsConfig({ home, srcDir, rulePatch: { mode, evidenceDir } });
	const read = (file) => fs.readFileSync(file, "utf8");

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-rule-"));
		fs.chmodSync(root, 0o700);
		home = path.join(root, "home");
		srcDir = path.join(root, "source");
		evidenceDir = path.join(root, "evidence");
		fs.mkdirSync(srcDir);
		fs.writeFileSync(path.join(srcDir, "PROFILE.md"), `SOURCE\n${newRule}\n`);
		destinations = [".claude/CLAUDE.md", ".codex/AGENTS.md"].map((name) =>
			path.join(home, name),
		);
		original = `LOCAL\r\n${oldRule}\r\n${block}\r\nTAIL`;
		for (const file of destinations) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, original);
		}
	});
	afterEach(() => fs.rmSync(root, { recursive: true }));

	it("plans without writing and deploys only the reviewed line to Claude and Codex", async () => {
		const plan = await run("plan");
		for (const file of destinations) expect(read(file)).toBe(original);
		expect(plan.source.revision).toMatch(/^[a-f0-9]{40}$/);
		expect(plan.destinations.map((d) => d.path)).toEqual(destinations);
		const result = await run("deploy");
		expect(result.destinations.map((d) => d.status)).toEqual([
			"applied",
			"applied",
		]);
		for (const file of destinations) {
			expect(read(file)).toBe(original.replace(oldRule, newRule));
		}
		expect(fs.existsSync(path.join(home, ".gemini"))).toBe(false);
		expect(fs.existsSync(path.join(home, ".config/opencode"))).toBe(false);
		const snapshots = fs
			.readdirSync(evidenceDir)
			.filter((name) => name.endsWith(".before"));
		expect(snapshots).toHaveLength(3);
		expect(snapshots.map((name) => read(path.join(evidenceDir, name)))).toContain(
			original,
		);
	});

	it("holds a stale destination and preserves its unrelated edit while deploying its peer", async () => {
		await run("plan");
		const stale = original.replace("LOCAL", "CHANGED AFTER REVIEW");
		fs.writeFileSync(destinations[0], stale);
		const result = await run("deploy");
		expect(result.destinations[0].status).toBe("held");
		expect(read(destinations[0])).toBe(stale);
		expect(read(destinations[1])).toBe(original.replace(oldRule, newRule));
	});

	it("holds deployment when the reviewed source changes", async () => {
		await run("plan");
		fs.appendFileSync(path.join(srcDir, "PROFILE.md"), "SOURCE DRIFT\n");
		const result = await run("deploy");
		expect(result.destinations.every((d) => d.status === "held")).toBe(true);
		for (const file of destinations) expect(read(file)).toBe(original);
	});

	it("holds an unreachable file without blocking its peer", async () => {
		await run("plan");
		fs.unlinkSync(destinations[0]);
		const result = await run("deploy");
		expect(result.destinations[0].status).toBe("held");
		expect(fs.existsSync(destinations[0])).toBe(false);
		expect(read(destinations[1])).toBe(original.replace(oldRule, newRule));
	});

	it("rolls back only the applied rule, preserving later bytes and the routing block", async () => {
		await run("plan");
		await run("deploy");
		for (const file of destinations) fs.appendFileSync(file, "\nADDED LATER\n");
		const result = await run("rollback");
		expect(result.destinations.map((d) => d.status)).toEqual([
			"rolled-back",
			"rolled-back",
		]);
		for (const file of destinations) {
			expect(read(file)).toBe(`${original}\nADDED LATER\n`);
		}
	});

	it("refuses rollback after the applied rule changes without blocking its peer", async () => {
		await run("plan");
		await run("deploy");
		const changed = original.replace(oldRule, `${newRule} EDITED`);
		fs.writeFileSync(destinations[0], changed);
		const result = await run("rollback");
		expect(result.destinations[0].status).toBe("held");
		expect(read(destinations[0])).toBe(changed);
		expect(read(destinations[1])).toBe(original);
	});

	it("never patches a rule inside the installer-owned block", async () => {
		const managed = `<!-- axstack:begin v1 -->\n${oldRule}\n<!-- axstack:end -->`;
		fs.writeFileSync(destinations[0], managed);
		await run("plan");
		const result = await run("deploy");
		expect(result.destinations[0].status).toBe("held");
		expect(read(destinations[0])).toBe(managed);
		expect(read(destinations[1])).toBe(original.replace(oldRule, newRule));
	});

	it("refuses rollback without this run's successful deployment receipt", async () => {
		await run("plan");
		const otherRun = original.replace(oldRule, newRule);
		fs.writeFileSync(destinations[0], otherRun);
		const result = await run("rollback");
		expect(result.destinations[0].status).toBe("held");
		expect(read(destinations[0])).toBe(otherRun);
	});
});
