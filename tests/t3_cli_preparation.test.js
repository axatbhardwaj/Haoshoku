import { afterEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureAxstack } from "../src/helpers/configure_axstack.js";
import { configureTailscaleT3 } from "../src/helpers/configure_tailscale_t3.js";

const homes = [];
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true });
});
const quote = (s) => `'${s}'`;

function fixture() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "t3-cli-preparation-"));
	homes.push(home);
	const cli = path.join(home, ".local/bin/t3");
	const events = [],
		warnings = [],
		environments = [];
	const state = {
		node: "v24.10.0",
		npmOk: true,
		npmVersion: "0.1.0",
		nightly: null,
		active: false,
	};
	const write = (file, data) => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, data);
	};
	write(
		path.join(home, ".t3/userdata/desktop-settings.json"),
		'{"localEnvironmentEnabled":false,"unrelated":"preserve"}',
	);
	const seedNpm = (prefix = path.join(home, ".local"), version = "0.1.0") => {
		write(
			path.join(prefix, "lib/node_modules/t3/bin/t3.js"),
			"fixture npm launcher",
		);
		write(
			path.join(prefix, "lib/node_modules/t3/package.json"),
			JSON.stringify({ name: "t3", version, bin: { t3: "bin/t3.js" } }),
		);
		fs.mkdirSync(path.join(prefix, "bin"), { recursive: true });
		fs.symlinkSync(
			"../lib/node_modules/t3/bin/t3.js",
			path.join(prefix, "bin/t3"),
		);
	};
	const resolved = () => {
		try {
			fs.lstatSync(cli);
			return cli;
		} catch {
			return null;
		}
	};
	const captureCommandImpl = async (command, options = {}) => {
		events.push(command);
		environments.push([command, options.env]);
		const reply = (stdout = "", exitCode = 0) => ({ stdout, exitCode });
		if (command === "command -v t3")
			return reply(resolved() ?? "", resolved() ? 0 : 1);
		if (
			command.endsWith(" --version") &&
			(command === "t3 --version" ||
				command.includes("/t3'") ||
				command.includes("/t3.js'") ||
				command.includes("/t3-nightly"))
		) {
			if (
				command.includes("t3-nightly") ||
				(resolved() &&
					fs.lstatSync(cli).isSymbolicLink() &&
					fs.readlinkSync(cli) === "/usr/bin/t3-nightly" &&
					command === "t3 --version")
			)
				return reply(state.nightly ?? "", state.nightly ? 0 : 127);
			const available =
				fs.existsSync(cli) ||
				command.includes(".t3-install-") ||
				(command.startsWith("'") && fs.existsSync(command.split("'")[1]));
			return reply(
				available ? `t3 v${state.npmVersion}` : "",
				available ? 0 : 127,
			);
		}
		if (command === "node --version")
			return reply(state.node ?? "", state.node ? 0 : 127);
		if (command === "command -v node") return reply("/usr/bin/node");
		if (command === "command -v npm") return reply("/usr/bin/npm");
		if (command === "npm --version") return reply("10.9.3");
		if (command === "pacman -Q t3code-bin") return reply("t3code-bin 0.1.0-1");
		if (command.startsWith("pacman -Q")) return reply("", 1);
		if (command === "tailscale status --json")
			return reply('{"BackendState":"Running"}');
		if (command === "tailscale debug prefs")
			return reply('{"OperatorUser":"test"}');
		if (command === "command -v t3code t3code-nightly")
			return reply("/usr/bin/t3code");
		if (
			command === "ps -eo pid=,comm=,args=" ||
			command.startsWith("systemctl --user list-")
		)
			return reply();
		if (command.startsWith("systemctl --user show "))
			return reply("LoadState=not-found\nEnvironment=\n");
		if (command.includes("is-active") && command.includes("--user"))
			return reply("", state.active ? 0 : 1);
		if (command.startsWith("systemctl ")) return reply();
		if (command.startsWith("loginctl ")) return reply("Linger=yes");
		if (command === "tailscale serve status --json")
			return reply(
				JSON.stringify({
					TCP: { 443: { HTTPS: true } },
					Web: {
						"fixture.tail123.ts.net:443": {
							Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } },
						},
					},
				}),
			);
		if (command.startsWith("ss "))
			return reply("LISTEN 0 128 127.0.0.1:3773 0.0.0.0:*");
		throw new Error(`Unexpected fixture probe: ${command}`);
	};
	const runCommandImpl = async (command) => {
		events.push(command);
		if (command.startsWith("npm --global")) {
			if (!state.npmOk) return false;
			seedNpm(command.match(/--prefix '([^']+)'/)[1], state.npmVersion);
		}
		if (command.includes(" service install")) {
			state.active = true;
			write(
				path.join(home, ".config/systemd/user/t3code.service"),
				`[Service]\nEnvironment=T3CODE_HOME=${home}/.t3\n`,
			);
		}
		return true;
	};
	const fsImpl = {
		...fs,
		existsSync(file) {
			if (file === "/usr/bin/t3code") return true;
			if (file.startsWith("/usr/"))
				return file === "/usr/bin/t3-nightly" && state.nightly !== null;
			return fs.existsSync(file);
		},
		statSync(file, ...args) {
			if (file.startsWith("/usr/") || file.startsWith("/opt/")) {
				if (file === "/usr/bin/t3-nightly" && state.nightly)
					return { isFile: () => true };
				throw Object.assign(new Error("absent fixture"), { code: "ENOENT" });
			}
			return fs.statSync(file, ...args);
		},
		readdirSync(dir, ...args) {
			return dir.startsWith("/usr/") ? [] : fs.readdirSync(dir, ...args);
		},
	};
	const common = {
		home,
		env: {},
		fsImpl,
		captureCommandImpl,
		runCommandImpl,
		latestStableImpl: async () => "0.1.0",
	};
	const archive = Buffer.from("axstack fixture");
	const axstack = {
		...common,
		detectOS: () => "arch",
		bunPath: "/test/bun",
		fetcher: async (url) =>
			url.endsWith("/latest")
				? Response.json({
						version: "0.24.7",
						dist: {
							tarball: "https://example.com/axstack.tgz",
							integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
						},
					})
				: new Response(archive),
		extractor: async (_file, dir) => {
			write(path.join(dir, "package/bin/axstack.js"), "fixture");
		},
		runner: async (_exe, args) => {
			events.push(`harness:${args[args.indexOf("--harness") + 1]}`);
			return { exitCode: 0, stdout: "installed" };
		},
	};
	const tailscale = {
		...common,
		user: "test",
		hostname: "fixture",
		deviceType: "pc",
		maxReadinessAttempts: 1,
		sleepImpl: async () => {},
		fetchImpl: async () => new Response("ready"),
		logger: { info() {}, success() {}, warning: (m) => warnings.push(m) },
	};
	return {
		home,
		cli,
		events,
		environments,
		state,
		seedNpm,
		write,
		axstack,
		tailscale,
		warnings,
	};
}

it("prepares the real desktop-only Arch layout before either Axstack harness", async () => {
	const f = fixture();
	expect((await configureAxstack(f.axstack)).ok).toBe(true);
	expect(
		f.events.findIndex((s) => s.startsWith("npm --global")),
	).toBeGreaterThanOrEqual(0);
	expect(f.events.findIndex((s) => s.startsWith("npm --global"))).toBeLessThan(
		f.events.indexOf("harness:claude"),
	);
	expect(fs.realpathSync(f.cli)).toBe(
		path.join(f.home, ".local/lib/node_modules/t3/bin/t3.js"),
	);
	expect(f.events).toContain("harness:codex");
});

it("prepares standalone Tailscale setup with the verified CLI, then reruns without npm", async () => {
	const f = fixture();
	expect([await configureTailscaleT3(f.tailscale), f.warnings]).toEqual([
		true,
		[],
	]);
	expect(f.events).toContain(
		`${quote(f.cli)} service install --base-dir '${f.home}/.t3'`,
	);
	const installs = f.events.filter((s) => s.startsWith("npm --global")).length;
	expect(installs).toBe(1);
	expect([await configureTailscaleT3(f.tailscale), f.warnings]).toEqual([
		true,
		[],
	]);
	expect(f.events.filter((s) => s.startsWith("npm --global"))).toHaveLength(
		installs,
	);
	expect(
		JSON.parse(
			fs.readFileSync(path.join(f.home, ".t3/userdata/desktop-settings.json")),
		),
	).toEqual({ localEnvironmentEnabled: false, unrelated: "preserve" });
});

it("accepts a proven local npm stable CLI without reinstalling", async () => {
	const f = fixture();
	f.seedNpm();
	expect([await configureTailscaleT3(f.tailscale), f.warnings]).toEqual([
		true,
		[],
	]);
	expect(f.events.some((s) => s.startsWith("npm --global"))).toBe(false);
});

it.each([
	false,
	true,
])("migrates only the exact managed old-nightly alias (target present %s)", async (present) => {
	const f = fixture();
	if (present) f.state.nightly = "t3 v0.0.46-nightly.20261013.1";
	fs.mkdirSync(path.dirname(f.cli), { recursive: true });
	fs.symlinkSync("/usr/bin/t3-nightly", f.cli);
	expect((await configureAxstack(f.axstack)).ok).toBe(true);
	expect(fs.realpathSync(f.cli)).toBe(
		path.join(f.home, ".local/lib/node_modules/t3/bin/t3.js"),
	);
});

it.each([
	"npm failed",
	"bad installed version",
])("preserves a usable nightly alias across %s and runs no harness", async (kind) => {
	const f = fixture();
	f.state.nightly = "t3 v0.0.46-nightly.20261013.1";
	fs.mkdirSync(path.dirname(f.cli), { recursive: true });
	fs.symlinkSync("/usr/bin/t3-nightly", f.cli);
	if (kind === "npm failed") f.state.npmOk = false;
	else f.state.npmVersion = "0.0.45";
	expect((await configureAxstack(f.axstack)).ok).toBe(false);
	expect(f.events.some((s) => s.startsWith("npm --global"))).toBe(true);
	expect(fs.readlinkSync(f.cli)).toBe("/usr/bin/t3-nightly");
	expect(f.events.some((s) => s.startsWith("harness:"))).toBe(false);
});

it.each([
	null,
	"v22.15.0",
])("holds fresh setup without supported Node (%s), never apt or npm", async (version) => {
	const f = fixture();
	f.state.node = version;
	const result = await configureAxstack(f.axstack);
	expect(result.ok).toBe(false);
	expect(result.harnesses.codex.reason).toContain("Node");
	expect(
		f.events.some(
			(s) =>
				s.startsWith("npm --global") ||
				s.includes("apt ") ||
				s.includes("nodesource"),
		),
	).toBe(false);
});

it.each([
	"t3 v0.2.0-nightly.1",
	"unknown",
])("holds an exact managed link with a newer/unknown nightly %s", async (version) => {
	const f = fixture();
	f.state.nightly = version;
	fs.mkdirSync(path.dirname(f.cli), { recursive: true });
	fs.symlinkSync("/usr/bin/t3-nightly", f.cli);
	expect((await configureAxstack(f.axstack)).ok).toBe(false);
	expect(fs.readlinkSync(f.cli)).toBe("/usr/bin/t3-nightly");
	expect(
		f.events.some(
			(s) => s.startsWith("npm --global") || s.startsWith("harness:"),
		),
	).toBe(false);
});

it.each([
	"file",
	"dangling",
	"archive",
])("holds an unusable unmanaged %s without adoption or harness installs", async (kind) => {
	const f = fixture();
	f.state.npmVersion = "unknown";
	fs.mkdirSync(path.dirname(f.cli), { recursive: true });
	if (kind === "file") fs.writeFileSync(f.cli, "custom CLI");
	else
		fs.symlinkSync(
			kind === "archive"
				? path.join(f.home, ".local/opt/t3code-stable/t3-0.1.0-linux-x64/t3")
				: "/missing/custom-t3",
			f.cli,
		);
	const before = fs.lstatSync(f.cli).isSymbolicLink()
		? fs.readlinkSync(f.cli)
		: fs.readFileSync(f.cli, "utf8");
	expect((await configureAxstack(f.axstack)).ok).toBe(false);
	expect(
		fs.lstatSync(f.cli).isSymbolicLink()
			? fs.readlinkSync(f.cli)
			: fs.readFileSync(f.cli, "utf8"),
	).toBe(before);
	expect(
		f.events.some(
			(s) => s.startsWith("npm --global") || s.startsWith("harness:"),
		),
	).toBe(false);
});

it.each([
	"paru_applist.txt",
	"paru_applist_iobox.txt",
])("requests Node/npm through the existing Arch package list %s", (file) => {
	const packages = fs
		.readFileSync(path.join(import.meta.dir, "../common", file), "utf8")
		.split(/\s+/);
	expect(packages).toContain("nodejs");
	expect(packages).toContain("npm");
});

it("validates Node selected by the service PATH, including a shadowing mise shim", async () => {
	const f = fixture(),
		capture = f.axstack.captureCommandImpl;
	f.axstack.captureCommandImpl = async (command, options) =>
		command === "node --version"
			? {
					exitCode: 0,
					stdout: options?.env?.PATH?.includes("mise/shims")
						? "v22.15.0"
						: "v24.10.0",
				}
			: capture(command, options);
	const result = await configureAxstack(f.axstack);
	expect(result.ok).toBe(false);
	expect(result.harnesses.codex.reason).toContain("Node");
	expect(
		f.events.some(
			(s) => s.startsWith("npm --global") || s.startsWith("harness:"),
		),
	).toBe(false);
});

it("reuses a stable custom shell CLI without replacing its working harness PATH", async () => {
	const f = fixture(),
		capture = f.axstack.captureCommandImpl,
		paths = [];
	f.axstack.env.PATH = `/custom/bin:/custom/harness-tools:${process.env.PATH}`;
	f.axstack.runner = async (_exe, _args, options) => {
		paths.push(options.env.PATH);
		return { exitCode: 0, stdout: "installed" };
	};
	f.axstack.captureCommandImpl = async (command, options) =>
		command === "command -v t3"
			? { exitCode: 0, stdout: "/custom/t3" }
			: command === "t3 --version"
				? { exitCode: 0, stdout: "t3 v0.1.0" }
				: capture(command, options);
	expect((await configureAxstack(f.axstack)).ok).toBe(true);
	expect(paths).toEqual([f.axstack.env.PATH, f.axstack.env.PATH]);
	expect(f.events.some((s) => s.startsWith("npm --global"))).toBe(false);
});

for (const origin of ["managed npm", "unmanaged file", "archive alias"]) {
	it.each(["T3 registry unavailable", "Node absent", "npm absent"])(
		`reuses a runnable stable ${origin} when %s without CLI preparation`,
		async (failure) => {
			const f = fixture();
			if (origin === "managed npm") f.seedNpm();
			else if (origin === "unmanaged file") f.write(f.cli, "custom CLI");
			else {
				const target = path.join(f.home, ".local/opt/t3code-stable/t3-0.1.0-linux-x64/t3");
				f.write(target, "archive CLI");
				fs.mkdirSync(path.dirname(f.cli), { recursive: true });
				fs.symlinkSync(target, f.cli);
			}
			const snapshot = () => ({
				link: fs.lstatSync(f.cli).isSymbolicLink() ? fs.readlinkSync(f.cli) : null,
				content: fs.readFileSync(f.cli, "utf8"),
			});
			const before = snapshot(), capture = f.axstack.captureCommandImpl;
			let lookups = 0;
			f.axstack.latestStableImpl = async () => {
				lookups++;
				if (failure === "T3 registry unavailable") throw new Error("T3 registry offline");
				return "0.1.0";
			};
			f.axstack.captureCommandImpl = async (command, options) =>
				(failure === "Node absent" && command === "node --version") ||
				(failure === "npm absent" && command === "npm --version")
					? { exitCode: 127, stdout: "" }
					: capture(command, options);
			expect((await configureAxstack(f.axstack)).ok).toBe(true);
			expect(f.events.filter((s) => s.startsWith("harness:"))).toEqual(["harness:claude", "harness:codex"]);
			expect(snapshot()).toEqual(before);
			expect(lookups).toBe(0);
			expect(f.events.some((s) => s.startsWith("npm ") || s === "node --version")).toBe(false);
		},
	);
}

it("reuses a newer stable CLI without downgrade comparison while the service still holds", async () => {
	const f = fixture();
	f.write(f.cli, "custom native CLI");
	f.state.npmVersion = "0.2.0";
	f.axstack.latestStableImpl = async () => { throw new Error("must not look up T3 for reuse"); };
	expect((await configureAxstack(f.axstack)).ok).toBe(true);
	expect(f.events.filter((s) => s.startsWith("harness:"))).toHaveLength(2);
	expect(await configureTailscaleT3(f.tailscale)).toBe(false);
	expect(fs.readFileSync(f.cli, "utf8")).toBe("custom native CLI");
	expect(f.events.some((s) => s.startsWith("npm --global") || s.includes(" service install"))).toBe(false);
});

it.each([
	[0, "unknown"],
	[0, "t3 v0.0.99"],
	[0, "t3 v0.1.0-nightly.1"],
	[127, "t3 v0.1.0"],
	[null, "probe failed"],
])("holds unusable custom CLI exit=%s output=%s without replacement", async (exitCode, stdout) => {
	const f = fixture(), capture = f.axstack.captureCommandImpl;
	f.write(f.cli, "keep custom bytes");
	f.axstack.captureCommandImpl = async (command, options) => {
		if (command !== "t3 --version") return capture(command, options);
		if (exitCode === null) throw new Error(stdout);
		return { exitCode, stdout };
	};
	const result = await configureAxstack(f.axstack);
	expect(result.ok).toBe(false);
	expect(result.harnesses.claude.reason).toContain("T3");
	expect(fs.readFileSync(f.cli, "utf8")).toBe("keep custom bytes");
	expect(f.events.some((s) => s.startsWith("npm --global") || s.startsWith("harness:"))).toBe(false);
});

it.each([
	"version mismatch",
	"wrong bin",
])("rejects local npm metadata with %s before service changes", async (kind) => {
	const f = fixture();
	f.seedNpm();
	f.write(
		path.join(f.home, ".local/lib/node_modules/t3/package.json"),
		JSON.stringify({
			name: "t3",
			version: kind === "version mismatch" ? "0.0.45" : "0.1.0",
			bin: { t3: kind === "wrong bin" ? "other.js" : "bin/t3.js" },
		}),
	);
	expect(await configureTailscaleT3(f.tailscale)).toBe(false);
	expect(
		f.events.some(
			(s) => s.startsWith("npm --global") || s.includes(" service install"),
		),
	).toBe(false);
});

it("carries the validated service PATH into harness and service invocations", async () => {
	const f = fixture(),
		harnessPaths = [];
	f.axstack.runner = async (_exe, _args, options) => {
		harnessPaths.push(options.env.PATH);
		return { exitCode: 0, stdout: "installed" };
	};
	expect((await configureAxstack(f.axstack)).ok).toBe(true);
	const servicePath = `${f.home}/.local/bin:${f.home}/.bun/bin:${f.home}/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin`;
	expect(harnessPaths).toEqual([servicePath, servicePath]);
	const run = f.tailscale.runCommandImpl,
		servicePaths = [];
	f.tailscale.runCommandImpl = async (command, options) => {
		if (command.includes(" service install"))
			servicePaths.push(options?.env?.PATH);
		return run(command, options);
	};
	expect(await configureTailscaleT3(f.tailscale)).toBe(true);
	expect(servicePaths).toEqual([servicePath]);
});

it("accepts the authentic 0.1.0 tarball's relative npm bin metadata", async () => {
	const f = fixture();
	f.seedNpm();
	f.write(
		path.join(f.home, ".local/lib/node_modules/t3/package.json"),
		JSON.stringify({
			name: "t3",
			version: "0.1.0",
			bin: { t3: "./bin/t3.js" },
		}),
	);
	expect(await configureTailscaleT3(f.tailscale)).toBe(true);
	expect(f.events.some((s) => s.startsWith("npm --global"))).toBe(false);
});
