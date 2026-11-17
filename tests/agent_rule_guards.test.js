import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createRuleFixture, newRule, oldRule } from "./agent_rule_fixture.js";

describe("correction-rule safety guards", () => {
	let f;
	beforeEach(async () => {
		f = await createRuleFixture();
	});
	afterEach(() => fs.rmSync(f.root, { recursive: true }));
	const unchanged = () => {
		for (const file of f.destinations)
			expect(fs.readFileSync(file, "utf8")).toBe(f.original);
	};

	it("refuses a symlink at planning without snapshotting its target", () => {
		const file = f.destinations[0];
		const target = path.join(f.root, "linked-profile");
		fs.renameSync(file, target);
		fs.symlinkSync(target, file);
		const result = f.run("plan");
		expect(result.destinations[0].status).toBe("held");
		expect(fs.existsSync(path.join(f.evidenceDir, "0.before"))).toBe(false);
		expect(fs.readFileSync(target, "utf8")).toBe(f.original);
	});

	it("refuses to follow a symlink introduced after planning", () => {
		f.run("plan");
		const file = f.destinations[0];
		const target = path.join(f.root, "linked-profile");
		fs.renameSync(file, target);
		fs.symlinkSync(target, file);
		const open = fs.openSync;
		const read = fs.readFileSync;
		let linkedFd;
		let readLink = false;
		const openSpy = spyOn(fs, "openSync").mockImplementation(
			(name, ...args) => {
				const fd = open(name, ...args);
				if (name === file) linkedFd = fd;
				return fd;
			},
		);
		const readSpy = spyOn(fs, "readFileSync").mockImplementation(
			(name, ...args) => {
				if (name === linkedFd) readLink = true;
				return read(name, ...args);
			},
		);
		let result;
		try {
			result = f.run("deploy");
		} finally {
			openSpy.mockRestore();
			readSpy.mockRestore();
		}
		expect(result.destinations[0].status).toBe("held");
		// Refusal must happen before reading the linked profile, not at readback.
		expect(readLink).toBe(false);
		expect(result.destinations[0].reason).toMatch(/ELOOP|symlink/i);
		expect(fs.readFileSync(target, "utf8")).toBe(f.original);
	});

	it("requires a private 0700 evidence directory on deploy", () => {
		f.run("plan");
		fs.chmodSync(f.evidenceDir, 0o755);
		expect(() => f.run("deploy")).toThrow("0700");
		unchanged();
	});

	it("creates every before-snapshot as 0600 even with umask 000", () => {
		const previous = process.umask(0);
		try {
			f.run("plan");
		} finally {
			process.umask(previous);
		}
		expect(fs.statSync(f.evidenceDir).mode & 0o777).toBe(0o700);
		for (const name of [
			"source.before",
			"0.before",
			"1.before",
			"2.before",
			"3.before",
		]) {
			expect(fs.statSync(path.join(f.evidenceDir, name)).mode & 0o777).toBe(
				0o600,
			);
		}
	});

	it("refuses a second deploy even if another writer restores the old bytes", () => {
		f.run("plan");
		f.run("deploy");
		for (const file of f.destinations) fs.writeFileSync(file, f.original);
		const result = f.run("deploy");
		expect(result.destinations.every((d) => d.status === "held")).toBe(true);
		unchanged();
	});

	it("holds a changed HEAD even when source bytes still match", () => {
		const plan = f.run("plan");
		f.commit();
		expect(f.git("rev-parse", "HEAD").trim()).not.toBe(plan.source.revision);
		const result = f.run("deploy");
		expect(result.destinations.every((d) => d.status === "held")).toBe(true);
		unchanged();
	});

	it("refuses a receipt from a different host", () => {
		const receipt = f.run("plan");
		receipt.host = `${receipt.host}-other`;
		fs.writeFileSync(
			path.join(f.evidenceDir, "receipt.json"),
			JSON.stringify(receipt),
		);
		expect(() => f.run("deploy")).toThrow("host");
		unchanged();
	});

	it("names the stale lock file and preserves it for inspection", () => {
		f.run("plan");
		const lock = path.join(f.evidenceDir, "lock");
		fs.writeFileSync(lock, "inspect this owner");
		expect(() => f.run("deploy")).toThrow(`Stale or active lock: ${lock}`);
		expect(fs.readFileSync(lock, "utf8")).toBe("inspect this owner");
		unchanged();
	});

	for (const kind of ["inode", "fresh bytes"]) {
		it(`holds a last-moment change of ${kind} before writing`, () => {
			f.run("plan");
			const file = f.destinations[0];
			const lstat = fs.lstatSync;
			let injected = false;
			const spy = spyOn(fs, "lstatSync").mockImplementation((name, ...args) => {
				if (name === file && !injected) {
					injected = true;
					if (kind === "inode") {
						fs.writeFileSync(`${file}.replacement`, f.original);
						fs.renameSync(`${file}.replacement`, file);
					} else fs.appendFileSync(file, "\nLATE EDIT\n");
				}
				return lstat(name, ...args);
			});
			let result;
			try {
				result = f.run("deploy");
			} finally {
				spy.mockRestore();
			}
			expect(injected).toBe(true);
			expect(result.destinations[0].status).toBe("held");
			expect(result.destinations[0].reason).toContain(
				"immediately before write",
			);
			expect(fs.readFileSync(file, "utf8")).toBe(
				f.original + (kind === "inode" ? "" : "\nLATE EDIT\n"),
			);
			expect(fs.readFileSync(f.destinations[1], "utf8")).toBe(
				f.original.replace(oldRule, newRule),
			);
		});
	}
});
