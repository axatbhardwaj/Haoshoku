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

test("summary counts repeated command failures, avoids duplicate runner errors and names steps", async () => {
	const run = begin();
	for (let i = 0; i < 2; i++)
		await runCommand("false", {
			spawnImpl: child(3),
			check: true,
			stdout: "ignore",
			stderr: "ignore",
		});
	log.error("setup step failed");
	const lines = [];
	run.finish?.(1, (message) => lines.push(message));
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain("3 failed commands/steps:");
	expect(lines[0]).toContain("false");
	expect(lines[0]).toContain("setup step failed");
	expect(lines[0]).toContain(run.path);
	run.finish?.(1, (message) => lines.push(message));
	expect(lines).toHaveLength(1);
});

test("log files have mode 0600 even under a restrictive umask", () => {
	const run = begin({
		fsImpl: {
			...fs,
			openSync: (...args) => {
				const original = process.umask(0o777);
				try {
					return fs.openSync(...args);
				} finally {
					process.umask(original);
				}
			},
		},
	});
	expect(fs.statSync(run.path).mode & 0o777).toBe(0o600);
});

test("forwards stdout and stderr before child exit and keeps stdin usable", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-command-"));
	roots.push(root);
	const utilsPath = path.resolve("src/common/utils.js");
	const loggerPath = path.resolve("src/common/run_log.js");
	const inner = `
		process.stdout.write("stdout-ready");
		process.stderr.write("stderr-ready");
		setTimeout(() => process.exit(7), 3000);
		process.stdin.once("data", () => process.exit(3));
		process.stdin.resume();
	`;
	const worker = `
		import { runCommand } from ${JSON.stringify(utilsPath)};
		import { startRunLog } from ${JSON.stringify(loggerPath)};
		const run = startRunLog({ version: "12.1.0" });
		const result = await runCommand([process.execPath, "--eval", ${JSON.stringify(inner)}], { log: false });
		console.log("RESULT=" + result + " LOG=" + run.path);
	`;
	const proc = Bun.spawn([process.execPath, "--eval", worker], {
		env: { ...process.env, HOME: root, XDG_STATE_HOME: root },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	let exited = false;
	proc.exited.then(() => {
		exited = true;
	});
	const stdout = proc.stdout.getReader();
	const stderr = proc.stderr.getReader();
	let timer;
	try {
		const ready = await Promise.race([
			Promise.all([stdout.read(), stderr.read()]),
			new Promise((resolve) => {
				timer = setTimeout(() => resolve(null), 1500);
			}),
		]);
		expect(ready).not.toBeNull();
		expect(new TextDecoder().decode(ready[0].value)).toContain("stdout-ready");
		expect(new TextDecoder().decode(ready[1].value)).toContain("stderr-ready");
		expect(exited).toBe(false);
		proc.stdin.write("continue\n");
		proc.stdin.end();
		expect(await proc.exited).toBe(0);
		const files = fs.readdirSync(path.join(root, "haoshoku/logs"));
		const text = fs.readFileSync(
			path.join(root, "haoshoku/logs", files[0]),
			"utf8",
		);
		expect(text).toContain("Exit: 3");
		expect(text).toContain("stdout-ready");
		expect(text).toContain("stderr-ready");
	} finally {
		clearTimeout(timer);
		proc.stdin.end();
		await proc.exited;
		stdout.releaseLock();
		stderr.releaseLock();
	}
});

test("retention failures leave the fresh log writable and continue pruning", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "retention-error-"));
	roots.push(root);
	const dir = path.join(root, "haoshoku/logs");
	fs.mkdirSync(dir, { recursive: true });
	for (let day = 1; day <= 22; day++)
		fs.writeFileSync(
			path.join(
				dir,
				`2025-01-${String(day).padStart(2, "0")}T00-00-00.000Z.log`,
			),
			"old",
		);
	const attempts = [];
	const run = startRunLog({
		version: "12.1.0",
		env: { HOME: root, XDG_STATE_HOME: root },
		fsImpl: {
			...fs,
			unlinkSync(file) {
				attempts.push(file);
				if (file.endsWith("01T00-00-00.000Z.log"))
					throw new Error("busy old log");
				fs.unlinkSync(file);
			},
		},
	});
	log.info("still logging");
	expect(content(run)).toContain("Haoshoku 12.1.0");
	expect(content(run)).toContain("still logging");
	expect(attempts).toHaveLength(3);
	expect(fs.existsSync(path.join(dir, "2025-01-02T00-00-00.000Z.log"))).toBe(
		false,
	);
});

test("terminal children retain TTY prompts and receive input after their live output", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "tty-command-"));
	roots.push(root);
	const childCode = `if [ -t 0 ] && [ -t 1 ] && [ -t 2 ]; then printf 'tty-stdout-ready'; printf 'tty-stderr-ready' >&2; read reply; [ "$reply" = continue ] && exit 3; fi; printf 'not-a-terminal'; exit 7`;
	const utilsPath = path.resolve("src/common/utils.js");
	const loggerPath = path.resolve("src/common/run_log.js");
	const workerFile = path.join(root, "worker.js");
	fs.writeFileSync(
		workerFile,
		`
		import { runCommand } from ${JSON.stringify(utilsPath)};
		import { startRunLog } from ${JSON.stringify(loggerPath)};
		startRunLog({ version: "12.1.0" });
		await runCommand(["sh", "-c", ${JSON.stringify(childCode)}], { log: false });
	`,
	);
	const quote = (arg) => `'${arg.replaceAll("'", "'\\''")}'`;
	const proc = Bun.spawn(
		[
			"script",
			"--quiet",
			"--return",
			"--flush",
			"--command",
			`${quote(process.execPath)} ${quote(workerFile)}`,
			"/dev/null",
		],
		{
			env: { ...process.env, HOME: root, XDG_STATE_HOME: root },
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	let exited = false;
	proc.exited.then(() => {
		exited = true;
	});
	const reader = proc.stdout.getReader();
	let timer;
	try {
		const output = await Promise.race([
			(async () => {
				let text = "";
				while (true) {
					const { value, done } = await reader.read();
					if (done) return text;
					text += new TextDecoder().decode(value);
					if (text.includes("tty-stderr-ready")) return text;
				}
			})(),
			new Promise((resolve) => {
				timer = setTimeout(() => resolve("timeout waiting for prompt"), 1500);
			}),
		]);
		expect(output).toContain("tty-stdout-ready");
		expect(output).toContain("tty-stderr-ready");
		expect(exited).toBe(false);
		proc.stdin.write("continue\n");
		proc.stdin.end();
		expect(await proc.exited).toBe(0);
		const file = path.join(
			root,
			"haoshoku/logs",
			fs.readdirSync(path.join(root, "haoshoku/logs"))[0],
		);
		expect(fs.readFileSync(file, "utf8")).toContain("Exit: 3");
		expect(fs.readFileSync(file, "utf8")).toContain("tty-stderr-ready");
	} finally {
		clearTimeout(timer);
		proc.stdin.write("continue\n");
		proc.stdin.end();
		await proc.exited;
		reader.releaseLock();
	}
});
