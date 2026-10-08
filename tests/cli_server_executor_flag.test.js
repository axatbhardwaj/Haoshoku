import { expect, it } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const cli = path.resolve(import.meta.dir, "..", "haoshoku.js");
it("advertises the explicit opt-in Executor origin command", () => {
	const child = Bun.spawnSync([process.execPath, cli, "--help"]);
	expect(child.exitCode).toBe(0);
	expect(new TextDecoder().decode(child.stdout)).toContain(
		"--server-executor <https-origin>",
	);
});

const root = path.resolve(import.meta.dir, "..");
function runMode(args, osType = "debian-server", result = true) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "executor-cli-home-"));
	const child = Bun.spawnSync(
		[
			process.execPath,
			"--eval",
			`
		import { mock } from "bun:test";
		const utils = await import(${JSON.stringify(path.join(root, "src/common/cli_utils.js"))});
		mock.module(${JSON.stringify(path.join(root, "src/common/cli_utils.js"))}, () => ({ ...utils, detectOS: () => ${JSON.stringify(osType)} }));
		const helper = await import(${JSON.stringify(path.join(root, "src/helpers/configure_executor_server.js"))});
		mock.module(${JSON.stringify(path.join(root, "src/helpers/configure_executor_server.js"))}, () => ({ ...helper,
			configureExecutorServer: async (origin) => { console.log('EXECUTOR_ORIGIN=' + origin); console.log(origin === 'https://gateway.example:8444' ? 'EXECUTOR_CANONICAL_ORIGIN' : 'EXECUTOR_CALLED'); return ${JSON.stringify(result)}; }
		}));
		mock.module(${JSON.stringify(path.join(root, "src/os_scripts/debian_server.js"))}, () => ({ runDebianServerSetup: async () => { console.log('DEFAULT_SETUP'); return true; } }));
		process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
		await import(${JSON.stringify(cli)});
	`,
		],
		{
			env: {
				...process.env,
				HOME: home,
				XDG_STATE_HOME: path.join(home, "state"),
				XDG_CONFIG_HOME: path.join(home, "config"),
			},
		},
	);
	const logDir = path.join(home, "state", "haoshoku", "logs");
	const logText = fs.existsSync(logDir)
		? fs
				.readdirSync(logDir)
				.map((name) => fs.readFileSync(path.join(logDir, name), "utf8"))
				.join("\n")
		: "";
	return {
		logText,
		code: child.exitCode,
		output:
			new TextDecoder().decode(child.stdout) +
			new TextDecoder().decode(child.stderr),
	};
}
it("routes the canonical HTTPS origin to Executor and propagates incomplete setup", () => {
	for (const ok of [true, false]) {
		const r = runMode(
			["--server-executor", "https://gateway.example:8444/"],
			"debian-server",
			ok,
		);
		expect(r.code, r.output).toBe(ok ? 0 : 1);
		expect(r.output).toContain("EXECUTOR_CANONICAL_ORIGIN");
		expect(r.logText).not.toContain("gateway.example");
		expect(r.logText).toContain("[public-origin]");
		expect(r.output).not.toContain("DEFAULT_SETUP");
	}
});
it.each([
	["--server-executor", "https://axat-vps.tail140c22.ts.net/"],
	["--server-executor=https://axat-vps.tail140c22.ts.net"],
])("accepts a tailnet-only Executor origin via %j", (...args) => {
	const r = runMode(args);
	expect(r.code, r.output).toBe(0);
	expect(r.output).toContain(
		"EXECUTOR_ORIGIN=https://axat-vps.tail140c22.ts.net\n",
	);
	expect(r.output).not.toContain("DEFAULT_SETUP");
	expect(r.logText).not.toContain("tail140c22");
});
it.each([
	"arch",
	null,
])("rejects unsupported host %s before installer", (os) => {
	const r = runMode(["--server-executor", "https://gateway.example"], os);
	expect(r.code, r.output).toBe(2);
	expect(r.output).toContain("requires a Debian-family host");
	expect(r.output).not.toContain("EXECUTOR_CALLED");
});
it.each(
	[
		[],
		["http://gateway.example"],
		["https://user:secret@gateway.example"],
		["https://gateway.example/path"],
		["https://gateway.example/?secret=value"],
		["https://gateway.example/#token"],
		["https://gateway.example/?"],
		["https://gateway.example/#"],
		["https://gateway.example/../"],
		["https://gateway.example\\evil"],
		["https://*.example"],
		["https://gateway.example", "extra"],
	].map((values) => ({ values })),
)("refuses malformed Executor arguments %j with safe usage", ({ values }) => {
	const r = runMode(["--server-executor", ...values]);
	expect(r.code, r.output).toBe(2);
	expect(r.output).toContain("haoshoku --server-executor <https-origin>");
	expect(r.output).not.toContain("EXECUTOR_CALLED");
	expect(r.output).not.toContain("DEFAULT_SETUP");
	expect(r.output).not.toContain("secret");
	expect(r.logText).toBe("");
});
it("rejects combined modes before provisioning", () => {
	const r = runMode([
		"--server-executor",
		"https://gateway.example",
		"--codex",
	]);
	expect(r.code, r.output).toBe(2);
	expect(r.output).toContain("mutually exclusive");
	expect(r.output).not.toContain("EXECUTOR_CALLED");
});
it("rejects an explicit unsupported OS target before provisioning", () => {
	const r = runMode([
		"--server-executor",
		"https://gateway.example",
		"--os=arch",
	]);
	expect(r.code, r.output).toBe(2);
	expect(r.output).toContain("requires a Debian-family host");
	expect(r.output).not.toContain("EXECUTOR_CALLED");
});
