import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	configureSplitLockSudoers,
	splitLockSudoersRule,
} from "../src/helpers/configure_split_lock_sudoers.js";

const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function makeEnvironment(results = []) {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-split-lock-"));
	temporaryDirectories.push(tmpDir);
	const commands = [];
	const staged = [];
	const runCommandImpl = async (command) => {
		commands.push(command);
		const stage = command.match(/visudo -cf '([^']+)'/);
		if (stage) staged.push(fs.readFileSync(stage[1], "utf8"));
		return results.length > 0 ? results.shift() : true;
	};
	return { tmpDir, commands, staged, runCommandImpl };
}

describe("splitLockSudoersRule", () => {
	it("grants exactly the two sysctl calls the launch wrapper makes", () => {
		expect(splitLockSudoersRule("xzat")).toContain(
			"xzat ALL=(root) NOPASSWD: /usr/bin/sysctl -q -w kernel.split_lock_mitigate=0, /usr/bin/sysctl -q -w kernel.split_lock_mitigate=1\n",
		);
	});

	it("rejects a username that could widen the rule", () => {
		expect(() => splitLockSudoersRule("ALL")).toThrow();
		expect(() => splitLockSudoersRule("xzat, root")).toThrow();
		expect(() => splitLockSudoersRule("")).toThrow();
	});
});

describe("configureSplitLockSudoers", () => {
	it("validates the staged rule with visudo before installing it read-only", async () => {
		const env = makeEnvironment();
		const ok = await configureSplitLockSudoers({
			username: "xzat",
			tmpDir: env.tmpDir,
			runCommandImpl: env.runCommandImpl,
		});

		expect(ok).toBe(true);
		expect(env.commands).toHaveLength(2);
		expect(env.commands[0]).toMatch(/^sudo visudo -cf '/);
		expect(env.commands[1]).toMatch(
			/^sudo install -o root -g root -m 0440 '.+' '\/etc\/sudoers\.d\/haoshoku-split-lock'$/,
		);
		expect(env.staged).toEqual([splitLockSudoersRule("xzat")]);
	});

	it("installs nothing when visudo rejects the rule", async () => {
		const env = makeEnvironment([false]);
		const ok = await configureSplitLockSudoers({
			username: "xzat",
			tmpDir: env.tmpDir,
			runCommandImpl: env.runCommandImpl,
		});

		expect(ok).toBe(false);
		expect(env.commands).toHaveLength(1);
	});

	it("reports failure when the install step fails", async () => {
		const env = makeEnvironment([true, false]);
		expect(
			await configureSplitLockSudoers({
				username: "xzat",
				tmpDir: env.tmpDir,
				runCommandImpl: env.runCommandImpl,
			}),
		).toBe(false);
	});

	it("uses sudo -n when asked to stay non-interactive", async () => {
		const env = makeEnvironment();
		await configureSplitLockSudoers({
			username: "xzat",
			tmpDir: env.tmpDir,
			runCommandImpl: env.runCommandImpl,
			nonInteractiveSudo: true,
		});

		expect(
			env.commands.every((command) => command.startsWith("sudo -n ")),
		).toBe(true);
	});

	it("removes its staging file in every outcome", async () => {
		for (const results of [[true, true], [false], [true, false]]) {
			const env = makeEnvironment(results);
			await configureSplitLockSudoers({
				username: "xzat",
				tmpDir: env.tmpDir,
				runCommandImpl: env.runCommandImpl,
			});
			expect(fs.readdirSync(env.tmpDir)).toEqual([]);
		}
	});
});
