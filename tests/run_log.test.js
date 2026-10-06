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
async function cli(f, args = ["--version"]) {
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

test("even --version creates a private UTC log with device and invocation metadata", async () => {
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
		"--version",
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
	await cli(f, ["--version", "password=private123", "safe-value"]);
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
