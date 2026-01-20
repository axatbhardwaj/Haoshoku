import { describe, expect, it } from "bun:test";
import { commandExists, runCommand } from "../src/common/utils.js";

describe("Utils", () => {
	it("commandExists returns true for existing command", async () => {
		// We assume 'ls' exists on linux/unix
		const exists = await commandExists("ls");
		expect(exists).toBe(true);
	});

	it("commandExists returns false for non-existing command", async () => {
		const exists = await commandExists("nonexistentcommand_12345");
		expect(exists).toBe(false);
	});

	// Note: runCommand is hard to test directly without mocking spawn,
	// but Bun's test runner can't easily mock native modules like 'bun' import yet in the same way jest does.
	// However, we can test that it runs a simple echo command.
	it("runCommand executes successfully", async () => {
		const result = await runCommand("echo 'test'", { check: false });
		expect(result).toBe(true);
	});
});
