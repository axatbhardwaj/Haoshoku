import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shareLog } from "../src/helpers/share_log.js";

const roots = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
function fixture(replies, extraEnv = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "share-log-"));
	roots.push(root);
	const dir = path.join(root, "haoshoku/logs");
	fs.mkdirSync(dir, { recursive: true });
	const older = path.join(dir, "2025-01-01T00-00-00.000Z.log");
	const latest = path.join(dir, "2025-01-02T00-00-00.000Z.log");
	fs.writeFileSync(older, "older");
	fs.writeFileSync(latest, "latest sanitized run");
	fs.writeFileSync(path.join(dir, "unrelated.log"), "preserve");
	const calls = [],
		messages = [];
	return {
		latest,
		older,
		calls,
		messages,
		options: {
			env: { XDG_STATE_HOME: root, HOME: root, ...extraEnv },
			runProcess: async (argv) => {
				calls.push(argv);
				const reply = replies.shift();
				if (reply instanceof Error) throw reply;
				if (!reply) throw new Error("Unexpected extra command");
				return reply;
			},
			logImpl: Object.fromEntries(
				["info", "success", "warning", "error", "dim"].map((level) => [
					level,
					(value) => messages.push(value),
				]),
			),
		},
	};
}
const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
const unavailable = { exitCode: 1, stdout: "", stderr: "unavailable" };
const peer = (HostName = "io", Online = true) =>
	ok(
		JSON.stringify({
			BackendState: "Running",
			Peer: {
				abc: { HostName, DNSName: `${HostName}.tailnet.ts.net.`, Online },
			},
		}),
	);

test("uses Taildrop for an online exact target and emits the agent handoff", async () => {
	const f = fixture([peer(), ok()]);
	expect(await shareLog(undefined, f.options)).toBe(true);
	expect(f.calls).toEqual([
		["tailscale", "status", "--json"],
		["tailscale", "file", "cp", f.latest, "io:"],
	]);
	expect(f.messages.join("\n")).toContain(
		`log sent to io via Taildrop: ${path.basename(f.latest)}`,
	);
});

test("explicit file and target override remain separate argv values", async () => {
	const f = fixture([peer("main"), ok()], { HAOSHOKU_LOG_TARGET: "main" });
	const file = path.join(path.dirname(f.latest), "selected log.log");
	fs.writeFileSync(file, "selected");
	expect(await shareLog(file, f.options)).toBe(true);
	expect(f.calls.at(-1)).toEqual(["tailscale", "file", "cp", file, "main:"]);
});

for (const status of [
	unavailable,
	ok("not JSON"),
	peer("io2"),
	peer("io", false),
]) {
	test("falls back to a secret gist when Taildrop is unavailable", async () => {
		const url = "https://gist.github.com/axat/0123456789abcdef";
		const f = fixture([status, ok(), ok(`${url}\n`)]);
		expect(await shareLog(undefined, f.options)).toBe(true);
		expect(f.calls.slice(1)).toEqual([
			["gh", "auth", "status"],
			["gh", "gist", "create", f.latest],
		]);
		expect(f.messages.join("\n")).toContain(url);
	});
}

test("missing tools or credentials leave the log available for manual sharing", async () => {
	const f = fixture([new Error("missing tailscale"), unavailable]);
	expect(await shareLog(undefined, f.options)).toBe(true);
	expect(f.calls).toHaveLength(2);
	expect(f.messages.join("\n")).toContain(
		`Send this log to your agent: ${f.latest}`,
	);
	expect(f.messages.join("\n")).toContain("attach");
});

test("never claims success or switches upload channels after a failed Taildrop transfer", async () => {
	const f = fixture([peer(), unavailable]);
	expect(await shareLog(undefined, f.options)).toBe(false);
	expect(f.calls).toHaveLength(2);
	expect(f.messages.join("\n")).toContain("Taildrop failed");
	expect(f.messages.join("\n")).toContain(f.latest);
	expect(f.messages.join("\n")).not.toContain("log sent");
});

test("gist failure retains the path and does not claim an uploaded URL", async () => {
	const f = fixture([unavailable, ok(), unavailable]);
	expect(await shareLog(undefined, f.options)).toBe(false);
	expect(f.messages.join("\n")).toContain("Gist creation failed");
	expect(f.messages.join("\n")).toContain(f.latest);
});

test("latest selection excludes the sharing run itself", async () => {
	const f = fixture([peer(), ok()]);
	expect(
		await shareLog(undefined, { ...f.options, excludePath: f.latest }),
	).toBe(true);
	expect(f.calls.at(-1)).toEqual(["tailscale", "file", "cp", f.older, "io:"]);
});

test("missing explicit log fails before probing or uploading", async () => {
	const f = fixture([]);
	expect(await shareLog(`${f.latest}.missing`, f.options)).toBe(false);
	expect(f.calls).toHaveLength(0);
	expect(f.messages.join("\n")).toContain("No readable run log");
});

test("real-runner availability probes are recorded without bogus failures", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "share-real-runner-"));
	roots.push(root);
	const { startRunLog } = await import("../src/common/run_log.js");
	const { runCommandCapture } = await import("../src/common/utils.js");
	const env = { ...process.env, HOME: root, XDG_STATE_HOME: root };
	const run = startRunLog({ version: "12.1.0", env });
	// These real subprocesses hit the required exit-1 guard scripts, never live tools.
	expect(await shareLog(run.path, { env })).toBe(true);
	expect(run.failures).toEqual([]);
	const text = fs.readFileSync(run.path, "utf8");
	expect(text).toContain('Probe: ["tailscale","status","--json"]\nExit: 1');
	expect(text).toContain('Probe: ["gh","auth","status"]\nExit: 1');
	const result = await runCommandCapture([
		"sh",
		"-c",
		"echo actual-failure >&2; exit 7",
	]);
	expect(result.exitCode).toBe(7);
	const lines = [];
	run.finish(0, (line) => lines.push(line));
	expect(lines[0]).toContain("1 failed command/step:");
	expect(lines[0]).toContain("actual-failure");
});
