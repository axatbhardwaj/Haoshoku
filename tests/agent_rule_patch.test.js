import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
	block,
	createRuleFixture,
	newRule,
	oldRule,
} from "./agent_rule_fixture.js";

describe("scoped correction-rule deployment", () => {
	let fixture;
	let source;
	let evidenceDir;
	let destinations;
	let original;
	const run = (mode) => fixture.run(mode);
	const read = (file) => fs.readFileSync(file, "utf8");

	beforeEach(async () => {
		fixture = await createRuleFixture();
		({ source, evidenceDir, destinations, original } = fixture);
	});
	afterEach(() => fs.rmSync(fixture.root, { recursive: true }));

	it("plans without writing and deploys only the reviewed line to all four harnesses", async () => {
		const plan = await run("plan");
		for (const file of destinations) expect(read(file)).toBe(original);
		expect(plan.source.revision).toMatch(/^[a-f0-9]{40}$/);
		expect(plan.destinations.map((d) => d.path)).toEqual(destinations);
		const result = await run("deploy");
		expect(result.destinations.map((d) => d.status)).toEqual([
			"applied",
			"applied",
			"applied",
			"applied",
		]);
		for (const file of destinations) {
			expect(read(file)).toBe(original.replace(oldRule, newRule));
		}
		const snapshots = fs
			.readdirSync(evidenceDir)
			.filter((name) => name.endsWith(".before"));
		expect(snapshots).toHaveLength(5);
		expect(
			snapshots.map((name) => read(path.join(evidenceDir, name))),
		).toContain(original);
	});

	it.each([
		0, 1, 2, 3,
	])("holds stale destination %i and preserves its unrelated edit", async (index) => {
		await run("plan");
		const stale = original.replace("LOCAL", "CHANGED AFTER REVIEW");
		fs.writeFileSync(destinations[index], stale);
		const result = await run("deploy");
		expect(result.destinations[index].status).toBe("held");
		expect(read(destinations[index])).toBe(stale);
		expect(read(destinations[(index + 1) % 4])).toBe(
			original.replace(oldRule, newRule),
		);
	});

	it("holds deployment when the reviewed source changes", async () => {
		await run("plan");
		fs.appendFileSync(source, "SOURCE DRIFT\n");
		const result = await run("deploy");
		expect(result.destinations.every((d) => d.status === "held")).toBe(true);
		for (const file of destinations) expect(read(file)).toBe(original);
	});

	it.each([
		0, 1, 2, 3,
	])("holds unreachable destination %i without blocking its peer", async (index) => {
		await run("plan");
		fs.unlinkSync(destinations[index]);
		const result = await run("deploy");
		expect(result.destinations[index].status).toBe("held");
		expect(fs.existsSync(destinations[index])).toBe(false);
		expect(read(destinations[(index + 1) % 4])).toBe(
			original.replace(oldRule, newRule),
		);
	});

	it("rolls back only the applied rule, preserving later bytes and the routing block", async () => {
		await run("plan");
		await run("deploy");
		for (const file of destinations) fs.appendFileSync(file, "\nADDED LATER\n");
		const result = await run("rollback");
		expect(result.destinations.map((d) => d.status)).toEqual([
			"rolled-back",
			"rolled-back",
			"rolled-back",
			"rolled-back",
		]);
		for (const file of destinations) {
			expect(read(file)).toBe(`${original}\nADDED LATER\n`);
		}
	});

	it.each([
		0, 1, 2, 3,
	])("refuses rollback of changed rule at destination %i", async (index) => {
		await run("plan");
		await run("deploy");
		const changed = original.replace(oldRule, `${newRule} EDITED`);
		fs.writeFileSync(destinations[index], changed);
		const result = await run("rollback");
		expect(result.destinations[index].status).toBe("held");
		expect(read(destinations[index])).toBe(changed);
		expect(read(destinations[(index + 1) % 4])).toBe(original);
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

	it("preserves arbitrary unrelated bytes during deploy and rollback", async () => {
		const bytes = Buffer.concat([
			Buffer.from([0xff, 0x80, 0x00, 0x0a]),
			Buffer.from(`${oldRule}\n${block}`),
		]);
		fs.writeFileSync(destinations[0], bytes);
		await run("plan");
		await run("deploy");
		expect(fs.readFileSync(destinations[0])).toEqual(
			Buffer.concat([
				bytes.subarray(0, 4),
				Buffer.from(`${newRule}\n${block}`),
			]),
		);
		await run("rollback");
		expect(fs.readFileSync(destinations[0])).toEqual(bytes);
	});

	it.each([
		0, 1, 2, 3,
	])("holds missing destination %i at plan while applying its peers", (index) => {
		fs.unlinkSync(destinations[index]);
		const plan = fixture.command("plan");
		expect(plan.exitCode).toBe(2);
		expect(JSON.parse(plan.stdout.toString()).destinations[index].status).toBe(
			"held",
		);
		const deploy = fixture.command("deploy");
		expect(deploy.exitCode).toBe(2);
		const result = JSON.parse(deploy.stdout.toString());
		expect(result.destinations).toHaveLength(4);
		expect(result.destinations[index].status).toBe("held");
		expect(fs.existsSync(destinations[index])).toBe(false);
		for (const file of destinations.filter((_, i) => i !== index)) {
			expect(read(file)).toBe(original.replace(oldRule, newRule));
		}
	});

	it("prints CLI receipts and exit 2 on a held destination, then rolls back its peer", () => {
		const command = (mode) => {
			const result = fixture.command(mode);
			expect(result.stderr.toString()).toBe("");
			return {
				exit: result.exitCode,
				receipt: JSON.parse(result.stdout.toString()),
			};
		};
		const geminiNote = "\nGEMINI HARNESS NOTES\n";
		fs.appendFileSync(destinations[3], geminiNote);
		expect(command("plan").exit).toBe(0);
		expect(read(destinations[0])).toBe(original);
		fs.appendFileSync(destinations[0], "\nSTALE\n");
		const deployed = command("deploy");
		expect(deployed.exit).toBe(2);
		expect(deployed.receipt.destinations.map((d) => d.status)).toEqual([
			"held",
			"applied",
			"applied",
			"applied",
		]);
		expect(command("rollback").exit).toBe(2);
		expect(read(destinations[0])).toBe(`${original}\nSTALE\n`);
		expect(read(destinations[1])).toBe(original);
		expect(read(destinations[2])).toBe(original);
		expect(read(destinations[3])).toBe(original + geminiNote);
	});
});
