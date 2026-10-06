import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRunLog } from "../src/common/run_log.js";
import { log, runCommand, runCommandCapture } from "../src/common/utils.js";

const roots = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
function begin(options = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "log-command-"));
	roots.push(root);
	return startRunLog({ version: "12.1.0", env: { HOME: root }, ...options });
}
function stream(chunks) {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks)
				controller.enqueue(new TextEncoder().encode(chunk));
			controller.close();
		},
	});
}
function child(exitCode, stdout = [], stderr = []) {
	return () => ({
		exited: Promise.resolve(exitCode),
		stdout: stream(stdout),
		stderr: stream(stderr),
	});
}
function content(run) {
	return fs.readFileSync(run.path, "utf8");
}

test("records both runners' command, exit, duration and redacted failure diagnostics", async () => {
	const run = begin();
	const chunks = Array.from({ length: 80 }, (_, i) => `line ${i + 1}\n`);
	expect(
		await runCommand("false", {
			log: false,
			check: false,
			stdout: "ignore",
			stderr: "ignore",
			spawnImpl: child(7, chunks, ["ghp_", "private123\n"]),
		}),
	).toBe(false);
	const captured = await runCommandCapture("true", {
		spawnImpl: child(0, ["\ufeffexact\n"], []),
	});
	expect(captured).toEqual({
		exitCode: 0,
		stdout: "\ufeffexact\n",
		stderr: "",
		failed: false,
	});
	const text = content(run);
	expect(text).toContain("Command: false\nExit: 7\nDuration:");
	expect(text).toContain("Command: true\nExit: 0\nDuration:");
	expect(text).toMatch(/Duration: \d+(?:\.\d+)? ms/);
	expect(text).toContain("line 31\n");
	expect(text).toContain("line 80\n");
	expect(text).not.toContain("line 30\n");
	expect(text).toContain("Stderr:\n[REDACTED]");
	expect(text).not.toContain("private123");
});

test("caps huge output while draining streams and preserving command results", async () => {
	const run = begin();
	const result = await runCommandCapture("false", {
		spawnImpl: child(
			9,
			["x".repeat(100_000)],
			["token=private123 ", "e".repeat(100_000)],
		),
	});
	expect(result.exitCode).toBe(9);
	expect(result.stdout.length).toBe(100_000);
	const text = content(run);
	expect(text.length).toBeLessThan(35_000);
	expect(text).toContain("[output capped]");
	expect(text).not.toContain("private123");
});

test("spawn errors are recorded as failures with exit 127", async () => {
	const run = begin();
	const result = await runCommand("false", {
		returnExitCode: true,
		spawnImpl: () => {
			throw new Error("Cannot spawn: tskey-auth-private123");
		},
	});
	expect(result).toBe(127);
	expect(content(run)).toContain("Exit: 127");
	expect(content(run)).toContain("Cannot spawn: [REDACTED]");
	expect(content(run)).not.toContain("private123");
});

test("every log level reaches the file without ANSI or credentials", () => {
	const run = begin();
	for (const level of ["info", "success", "warning", "error", "dim"])
		log[level](`\u001b[31m${level}: Bearer private123\u001b[0m`);
	const text = content(run);
	for (const level of ["info", "success", "warning", "error", "dim"])
		expect(text).toContain(`[${level}] ${level}: Bearer [REDACTED]`);
	expect(text).not.toContain("private123");
	expect(text).not.toContain("\u001b");
});
