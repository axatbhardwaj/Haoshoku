import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactLog } from "../src/common/run_log.js";

const roots = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "run-log-"));
	roots.push(root);
	return {
		root,
		dir: path.join(root, "haoshoku/logs"),
		env: { ...process.env, HOME: root, XDG_STATE_HOME: root, FORCE_COLOR: "1" },
	};
}
async function cli(f, args = ["--explainer-theme", "dark"]) {
	const child = Bun.spawn([process.execPath, "haoshoku.js", ...args], {
		env: f.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}
function readLog(f) {
	const names = fs.existsSync(f.dir) ? fs.readdirSync(f.dir) : [];
	expect(names.length).toBe(1);
	return {
		file: path.join(f.dir, names[0]),
		text: fs.readFileSync(path.join(f.dir, names[0]), "utf8"),
	};
}

test("setup creates a private UTC log with device and invocation metadata", async () => {
	const f = fixture();
	expect((await cli(f)).exitCode).toBe(0);
	const { file, text } = readLog(f);
	expect(path.basename(file)).toMatch(
		/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.log$/,
	);
	expect(fs.statSync(f.dir).mode & 0o777).toBe(0o700);
	expect(fs.statSync(file).mode & 0o777).toBe(0o600);
	for (const value of [
		"Haoshoku 12.1.0",
		"--explainer-theme",
		"Date:",
		"OS NAME:",
		"OS VERSION:",
		"Omarchy:",
		"Kernel:",
		"Arch:",
		"Runtime: source",
	])
		expect(text).toContain(value);
});

for (const secret of [
	"ghp_private123",
	"gho_private123",
	"github_pat_private123",
	"sk-private-123",
	"tskey-auth-private123",
	"Bearer private123",
	"password=private123",
	"TOKEN=private123",
	"https://api.test/?token=private123&ok=1",
	"https://login.tailscale.com/a/private123",
]) {
	test(`redacts ${secret.split(/[=_-]/)[0]} before writing`, () => {
		const text = redactLog(secret);
		expect(text).not.toContain("private123");
		expect(text).not.toContain("private-123");
		expect(text).toContain("[REDACTED]");
	});
}

test("captures log.* errors and strips ANSI", async () => {
	const f = fixture();
	const result = await cli(f, ["--explainer-theme", "invalid"]);
	expect(result.exitCode).toBe(1);
	const { text } = readLog(f);
	expect(text).toContain("invalid");
	expect(text).toContain("error");
	expect(text).not.toContain("\u001b");
});

test("retains 20 exact-pattern logs and preserves unrelated files and symlinks", async () => {
	const f = fixture();
	fs.mkdirSync(f.dir, { recursive: true });
	for (let day = 1; day <= 22; day++)
		fs.writeFileSync(
			path.join(
				f.dir,
				`2025-01-${String(day).padStart(2, "0")}T00-00-00.000Z.log`,
			),
			"old",
		);
	fs.writeFileSync(path.join(f.dir, "notes.log"), "keep");
	fs.symlinkSync(
		path.join(f.root, "outside"),
		path.join(f.dir, "2024-01-01T00-00-00.000Z.log"),
	);
	await cli(f);
	expect(fs.readdirSync(f.dir).length).toBe(22);
	expect(fs.existsSync(path.join(f.dir, "2025-01-01T00-00-00.000Z.log"))).toBe(
		false,
	);
	expect(fs.readFileSync(path.join(f.dir, "notes.log"), "utf8")).toBe("keep");
	expect(
		fs
			.lstatSync(path.join(f.dir, "2024-01-01T00-00-00.000Z.log"))
			.isSymbolicLink(),
	).toBe(true);
});

test("unwritable state warns once and preserves the run result", async () => {
	const f = fixture();
	const blocked = path.join(f.root, "blocked");
	fs.writeFileSync(blocked, "not a directory");
	f.env.XDG_STATE_HOME = blocked;
	const result = await cli(f, ["--explainer-theme", "invalid"]);
	expect(result.exitCode).toBe(1);
	expect(
		`${result.stdout}${result.stderr}`.match(/Run logging unavailable/g)
			?.length,
	).toBe(1);
});

test("redacts credentials in the on-disk header without damaging safe argv", async () => {
	const f = fixture();
	await cli(f, [
		"--explainer-theme",
		"invalid",
		"password=private123",
		"safe-value",
	]);
	const { text } = readLog(f);
	expect(text).not.toContain("private123");
	expect(text).toContain("[REDACTED]");
	expect(text).toContain("safe-value");
});

test("end summary reports named failed steps and the log path even on explicit exit", async () => {
	const f = fixture();
	const result = await cli(f, ["--claude", "--audio"]);
	const { file } = readLog(f);
	expect(result.exitCode).toBe(2);
	expect(result.stdout).toContain("1 failed command/step:");
	expect(result.stdout).toContain("mutually exclusive");
	expect(result.stdout).toContain(file);
});

test("clean runs end with one dim log-path line", async () => {
	const f = fixture();
	const result = await cli(f);
	const { file } = readLog(f);
	expect(result.stdout).toContain(`Log: ${file}`);
	expect(result.stdout.match(/Log:/g)?.length).toBe(1);
	expect(result.stdout).not.toContain("failed command");
});

test("--share-log selects the previous run and falls back to manual instructions", async () => {
	const f = fixture();
	await cli(f);
	const { file } = readLog(f);
	const result = await cli(f, ["--share-log"]);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain(`Send this log to your agent: ${file}`);
	expect(result.stdout).toContain("attach");
});

test("--share-log accepts an explicit path with spaces and handles missing logs", async () => {
	const f = fixture();
	const file = path.join(f.root, "chosen log.log");
	fs.writeFileSync(file, "sanitized log");
	const result = await cli(f, ["--share-log", file]);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain(file);
	const missing = await cli(f, [
		"--share-log",
		path.join(f.root, "missing.log"),
	]);
	expect(missing.exitCode).toBe(1);
	expect(missing.stderr).toContain("No readable run log");
});

test("--share-log is mutually exclusive with setup flags", async () => {
	const f = fixture();
	const result = await cli(f, ["--share-log", "--claude"]);
	expect(result.exitCode).toBe(2);
	expect(result.stderr).toContain("mutually exclusive");
});

test("quoted credential values are redacted even inside serialized argv", async () => {
	const secret = 'PASSWORD="private value"';
	expect(redactLog(secret)).not.toContain("private value");
	expect(redactLog(JSON.stringify(secret))).not.toContain("private value");
	const f = fixture();
	await cli(f, ["--explainer-theme", "invalid", secret]);
	expect(readLog(f).text).not.toContain("private value");
});

test("a normal run never invokes the sharing helper", async () => {
	const f = fixture();
	const cliPath = path.resolve("haoshoku.js");
	const helperPath = path.resolve("src/helpers/share_log.js");
	const script = `
		import { mock } from "bun:test";
		mock.module(${JSON.stringify(helperPath)}, () => ({ shareLog: async () => { console.log("UPLOAD_CALLED"); return true; } }));
		process.argv = [process.execPath, ${JSON.stringify(cliPath)}, "--explainer-theme", "dark"];
		await import(${JSON.stringify(cliPath)});
	`;
	const result = Bun.spawnSync([process.execPath, "--eval", script], {
		env: f.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(result.exitCode).toBe(0);
	expect(new TextDecoder().decode(result.stdout)).not.toContain(
		"UPLOAD_CALLED",
	);
	expect(
		JSON.parse(
			fs.readFileSync(
				path.join(f.root, ".config/haoshoku/visual-explainer.json"),
				"utf8",
			),
		).theme,
	).toBe("dark");
});

for (const args of [
	["--help"],
	["-h"],
	["--version"],
	["-V"],
	["--share-log"],
]) {
	test(`${args[0]} does not create or rotate logs`, async () => {
		const f = fixture();
		fs.mkdirSync(f.dir, { recursive: true });
		for (let day = 1; day <= 20; day++)
			fs.writeFileSync(
				path.join(
					f.dir,
					`2025-01-${String(day).padStart(2, "0")}T00-00-00.000Z.log`,
				),
				`log ${day}`,
			);
		const before = fs
			.readdirSync(f.dir)
			.map((name) => [name, fs.readFileSync(path.join(f.dir, name), "utf8")]);
		const result = await cli(f, args);
		expect(result.exitCode).toBe(0);
		expect(
			fs
				.readdirSync(f.dir)
				.map((name) => [name, fs.readFileSync(path.join(f.dir, name), "utf8")]),
		).toEqual(before);
		expect(result.stdout).not.toContain("failed command");
		if (args[0] === "--version" || args[0] === "-V")
			expect(result.stdout).toBe("12.1.0\n");
		if (args[0] === "--share-log")
			expect(result.stdout).toContain("2025-01-20T00-00-00.000Z.log");
	});
}

for (const secret of [
	"ghs_private123",
	"ghu_private123",
	"ghr_private123",
	"token: private123",
	"token=private123",
	"--token private123",
	"--token=private123",
	"--password private123",
	"https://user:private123@example.test/path",
]) {
	test(`redacts additional credential form ${secret.split(/[ :=]/)[0]}`, () => {
		const text = redactLog(secret);
		expect(text).not.toContain("private123");
		expect(text).toContain("[REDACTED]");
	});
}

test("redacts separate credential flag values inside serialized argv", () => {
	const text = redactLog(
		JSON.stringify([
			"program",
			"--token",
			"private123",
			"--password",
			"other-secret",
			"--safe",
			"keep",
		]),
	);
	expect(text).not.toContain("private123");
	expect(text).not.toContain("other-secret");
	expect(text).toContain("keep");
	expect(text).toContain("[REDACTED]");
});
