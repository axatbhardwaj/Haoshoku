import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
	fixture,
	floor,
	listenerCommand,
	serveConfig,
	silentLogger,
} from "./configure_t3_code_server/fixture.js";
import { startRunLog } from "../src/common/run_log.js";
import { runCommandCapture } from "../src/common/utils.js";
import {
	configureT3CodeServer,
	ensureT3NodeRuntime,
	isT3NodeVersionSupported,
} from "../src/helpers/configure_t3_code_server.js";

it("keeps recovered server CLI and readiness probes out of the failure summary", async () => {
	const f = fixture({ version: null });
	const run = startRunLog({ version: "test", env: { HOME: f.home } });
	const capture = f.options.captureCommandImpl;
	let readiness = 0;
	f.options.captureCommandImpl = async (command, options) => {
		const result =
			command === "tailscale serve status --json" && readiness++ === 0
				? f.response("", 1)
				: await capture(command);
		return runCommandCapture(command, {
			...options,
			log: false,
			spawnImpl: () => ({
				exited: Promise.resolve(result.exitCode),
				stdout: new Response(result.stdout).body,
				stderr: new Response("").body,
			}),
		});
	};
	expect(await configureT3CodeServer(f.options)).toBe(true);
	const summary = [];
	run.finish(0, (message) => summary.push(message));
	expect(summary).toHaveLength(1);
	expect(summary[0]).not.toContain("failed command");
	const text = fs.readFileSync(run.path, "utf8");
	expect(text).toContain("Probe: t3 --version\nExit: 127");
	expect(text).toContain("Probe: tailscale serve status --json\nExit: 1");
});

describe("T3 server over Tailscale", () => {
	it("does not invoke T3 when a compatible Node runtime cannot be prepared", async () => {
		const f = fixture();
		f.options.ensureNodeImpl = async () => false;
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events).toEqual(["tailscale status"]);
		expect(fs.existsSync(f.dropIns)).toBe(false);
	});

	it("requires logged-in Tailscale before runtime, CLI, or service changes", async () => {
		const f = fixture();
		f.overrides.set("tailscale status", f.response("Logged out", 1));
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events).toEqual(["tailscale status"]);
		expect(fs.existsSync(f.dropIns)).toBe(false);
		expect(f.errors.join(" ")).toContain("Tailscale");
	});

	it("reuses the floor CLI and verifies the service and HTTPS mapping", async () => {
		const f = fixture();
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events).toEqual([
			"tailscale status",
			"node",
			"t3 --version",
			"command -v t3",
			"systemctl --user show t3code.service --property=LoadState,Environment,ExecStart,EnvironmentFiles",
			"command -v t3code t3code-nightly",
			"systemctl --user list-unit-files --no-legend --no-pager",
			"systemctl --user list-units --all --no-legend --no-pager",
			"ps -eo pid=,comm=,args=",
			"t3 connect status --json",
			"tailscale debug prefs",
			`t3 service install --base-dir '${f.home}/.t3'`,
			"systemctl --user is-active --quiet t3code.service",
			"tailscale serve status --json",
			"https://server.tail123.ts.net",
			listenerCommand,
		]);
		expect(fs.existsSync(path.join(f.dropIns, "axstack-sandbox.conf"))).toBe(
			false,
		);
	});

	it.each([
		floor,
		`v${floor}`,
		`t3 v${floor}`,
		`t3 v${floor} \n\t`,
	])("accepts supported version output without reinstalling: %s", async (version) => {
		const f = fixture({ version });
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events).toContain(`t3 service install --base-dir '${f.home}/.t3'`);
		expect(f.events.some((event) => event.startsWith("npm "))).toBe(false);
	});

	it.each([
		null,
		"t3 v0.0.45",
		"t3 v0.0.46-nightly.20261004.2644",
	])("installs the durable stable CLI when managed PATH reports %s", async (version) => {
		const f = fixture({ version });
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events).toContain(
			`npm --global --prefix '${f.home}/.local' install t3@latest`,
		);
		expect(f.events).toContain(`${f.installedT3} --version`);
		expect(f.events).toContain(
			`${f.installedT3} service install --base-dir '${f.home}/.t3'`,
		);
	});

	it.each([
		"t3 v0.2.0",
		"t3 v0.2.0-nightly.20261016.1",
		"unknown",
	])("holds newer or unknown runtime %s", async (version) => {
		const f = fixture({ version });
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(
			f.events.some(
				(event) =>
					event.startsWith("npm ") || event.includes(" service install"),
			),
		).toBe(false);
		expect(fs.existsSync(f.dropIns)).toBe(false);
		expect(f.errors.join(" ")).toContain("held");
	});

	it("preserves an unmanaged CLI instead of silently replacing or reusing nightly", async () => {
		const f = fixture({ version: "t3 v0.0.46-nightly.20261004.2644" });
		const cli = path.join(f.home, ".local/bin/t3");
		fs.unlinkSync(cli);
		fs.writeFileSync(cli, "custom t3");
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(fs.readFileSync(cli, "utf8")).toBe("custom t3");
		expect(f.events.some((event) => event.startsWith("npm "))).toBe(false);
		expect(f.errors.join(" ")).toContain("origin");
	});

	it("holds when the stable release cannot be verified", async () => {
		const f = fixture();
		f.options.latestStableImpl = async () => {
			throw new Error("registry unavailable");
		};
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(fs.existsSync(f.dropIns)).toBe(false);
		expect(f.errors.join(" ")).toContain("registry unavailable");
	});

	it.each([
		"t3 v0.0.45",
		"garbage",
		"",
		"0.0.99-nightly..1",
		"t3 v0.0.99-nightly..1",
		"t3 v00.0.99",
		"t3 vv0.0.99",
		"t3 v0.0.99 extra output",
	])("rejects an installed CLI below the floor: %s", async (installedVersion) => {
		const f = fixture({ version: null, installedVersion });
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events.at(-1)).toBe(`${f.installedT3} --version`);
		expect(fs.existsSync(f.dropIns)).toBe(false);
		expect(f.errors.join(" ")).toContain(floor);
	});

	it("stops when stable installation fails", async () => {
		const f = fixture({ version: null });
		const install = `npm --global --prefix '${f.home}/.local' install t3@latest`;
		f.overrides.set(install, false);
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events.at(-1)).toBe(install);
		expect(fs.existsSync(f.dropIns)).toBe(false);
	});

	it("unlinks enabled Connect and confirms disabled before installing the service", async () => {
		const f = fixture({ desired: true });
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events.slice(9, 14)).toEqual([
			"t3 connect status --json",
			"t3 connect unlink",
			"t3 connect status --json",
			"tailscale debug prefs",
			`t3 service install --base-dir '${f.home}/.t3'`,
		]);
		expect(
			f.events.some((event) =>
				/connect (link|authorize)|service update/.test(event),
			),
		).toBe(false);
	});

	it.each([
		"{}",
		"[]",
		"not-json",
		'{"desired":"false"}',
		'{"desired":null}',
	])("stops before service changes for unknown Connect state: %s", async (stdout) => {
		const f = fixture();
		f.overrides.set("t3 connect status --json", f.response(stdout));
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events.at(-1)).toBe("t3 connect status --json");
		expect(fs.existsSync(f.dropIns)).toBe(false);
	});

	it("fails if unlink fails or Connect remains enabled", async () => {
		for (const unlinkFails of [true, false]) {
			const f = fixture({ desired: true });
			f.overrides.set("t3 connect unlink", !unlinkFails);
			f.overrides.set(
				"t3 connect status --json",
				f.response('{"desired":true}'),
			);
			expect(await configureT3CodeServer(f.options)).toBe(false);
			expect(fs.existsSync(f.dropIns)).toBe(false);
			expect(f.errors.join(" ")).toContain("connect");
		}
	});

	it("writes the root-only sandbox drop-in and preserves unrelated drop-ins", async () => {
		const f = fixture();
		f.options.uid = 0;
		fs.mkdirSync(f.dropIns, { recursive: true });
		fs.writeFileSync(path.join(f.dropIns, "custom.conf"), "custom");
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(
			fs.readFileSync(path.join(f.dropIns, "axstack-sandbox.conf"), "utf8"),
		).toBe("[Service]\nEnvironment=IS_SANDBOX=1\n");
		expect(
			fs.readFileSync(path.join(f.dropIns, "browser-sandbox.conf"), "utf8"),
		).toBe("[Service]\nEnvironment=T3CODE_SERVER_BROWSER_SANDBOX=0\n");
		expect(fs.readFileSync(path.join(f.dropIns, "custom.conf"), "utf8")).toBe(
			"custom",
		);
		f.options.uid = 1000;
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(fs.existsSync(path.join(f.dropIns, "browser-sandbox.conf"))).toBe(
			false,
		);
		expect(fs.existsSync(path.join(f.dropIns, "axstack-sandbox.conf"))).toBe(
			false,
		);
	});

	it("fails with guidance when drop-ins cannot be written", async () => {
		const f = fixture();
		fs.mkdirSync(path.dirname(f.dropIns), { recursive: true });
		fs.writeFileSync(f.dropIns, "blocked");
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events).not.toContain(
			`t3 service install --base-dir '${f.home}/.t3'`,
		);
		expect(f.errors.join(" ")).toContain("drop-in");
	});

	it.each([
		"t3 service install",
		"systemctl --user is-active --quiet t3code.service",
	])("fails when %s fails", async (command) => {
		const f = fixture();
		const actualCommand =
			command === "t3 service install"
				? `t3 service install --base-dir '${f.home}/.t3'`
				: command;
		f.overrides.set(actualCommand, false);
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events).not.toContain("https://server.tail123.ts.net");
		expect(f.errors.join(" ")).toContain(command);
	});

	it.each([
		{},
		{ Web: serveConfig.Web },
		{ ...serveConfig, TCP: { 443: { HTTPS: false } } },
		{
			...serveConfig,
			Web: {
				"server.tail123.ts.net:443": {
					Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } },
				},
			},
		},
		{
			...serveConfig,
			Web: { "evil.example:443": Object.values(serveConfig.Web)[0] },
		},
		{
			...serveConfig,
			Web: {
				"server.tail123.ts.net:443": {
					Handlers: { "/other": { Proxy: "http://127.0.0.1:3773" } },
				},
			},
		},
	])("rejects missing, wrong, or non-tailnet HTTPS mappings: %j", async (config) => {
		const f = fixture();
		f.overrides.set(
			"tailscale serve status --json",
			f.response(JSON.stringify(config)),
		);
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(
			f.events.filter((event) => event === "tailscale serve status --json"),
		).toHaveLength(2);
		expect(f.events.some((event) => event.startsWith("https://"))).toBe(false);
		expect(f.errors.join(" ")).toContain("tailscale serve status");
	});

	it("waits within a bound for Serve and HTTPS startup", async () => {
		const f = fixture();
		let attempts = 0;
		f.options.fetchImpl = async () =>
			new Response("starting", { status: ++attempts === 1 ? 503 : 200 });
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(attempts).toBe(2);
		expect(f.events.filter((event) => event.startsWith("sleep "))).toEqual([
			"sleep 2000",
		]);
	});

	it("returns false after bounded HTTPS errors or non-success responses", async () => {
		for (const throws of [true, false]) {
			const f = fixture();
			let attempts = 0;
			f.options.fetchImpl = async () => {
				attempts++;
				if (throws) throw new Error("unreachable");
				return new Response("unavailable", { status: 503 });
			};
			expect(await configureT3CodeServer(f.options)).toBe(false);
			expect(attempts).toBe(2);
			expect(f.errors.join(" ")).toContain("HTTPS");
		}
	});

	it.each([
		"tailscale status",
		"t3 --version",
		"t3 connect status --json",
		"tailscale serve status --json",
	])("handles a missing or failing probe: %s", async (command) => {
		const f = fixture();
		f.overrides.set(command, new Error("missing executable"));
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.errors.length).toBeGreaterThan(0);
	});
});

describe("T3 Code Node.js compatibility", () => {
	it("accepts every release family supported by the current T3 engine range", () => {
		for (const version of [
			"v22.16.0",
			"22.21.1",
			"v23.11.0",
			"24.10.0",
			"v25.0.0",
		]) {
			expect(isT3NodeVersionSupported(version)).toBe(true);
		}
	});

	it("rejects missing, malformed, and too-old Node.js releases", () => {
		for (const version of [
			null,
			"",
			"node",
			"v20.19.0",
			"22.15.9",
			"23.10.9",
			"24.9.9",
			"v24.10.0-rc.1",
		]) {
			expect(isT3NodeVersionSupported(version)).toBe(false);
		}
	});
});

describe("T3 Code Node.js runtime preparation", () => {
	it("keeps a compatible Node.js runtime without package-manager commands", async () => {
		const commands = [];
		const result = await ensureT3NodeRuntime({
			getNodeVersionImpl: () => "v24.10.0",
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([]);
	});

	it("installs Node.js 24 and verifies the resulting runtime", async () => {
		const commands = [];
		const versions = ["v20.19.0", "v24.10.0"];
		const result = await ensureT3NodeRuntime({
			getNodeVersionImpl: () => versions.shift() ?? null,
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -",
			"sudo apt install -y nodejs",
		]);
	});

	it("stops when NodeSource setup fails", async () => {
		const commands = [];
		const result = await ensureT3NodeRuntime({
			getNodeVersionImpl: () => null,
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return false;
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual([
			"curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -",
		]);
	});

	it("rejects a runtime that remains incompatible after installation", async () => {
		const commands = [];
		const result = await ensureT3NodeRuntime({
			getNodeVersionImpl: () => "v22.15.0",
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual([
			"curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -",
			"sudo apt install -y nodejs",
		]);
	});
});

describe("Debian Tailscale operator reconciliation", () => {
	it("grants non-root users operator access and warns about replacement", async () => {
		const f = fixture();
		const warnings = [];
		f.options.logger.warning = (message) => warnings.push(message);
		f.overrides.set(
			"tailscale debug prefs",
			f.response('{"OperatorUser":"previous"}'),
		);
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command) => {
			if (command.includes("set --operator")) {
				expect(warnings.join(" ")).toContain("previous");
				expect(warnings.join(" ")).toContain("test");
				f.overrides.set(
					"tailscale debug prefs",
					f.response('{"OperatorUser":"test"}'),
				);
			}
			return run(command);
		};
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events).toContain("sudo -n tailscale set --operator='test'");
		expect(warnings.join(" ")).toContain("previous");
		expect(warnings.join(" ")).toContain("test");
	});

	it("skips operator configuration for root", async () => {
		const f = fixture();
		f.options.uid = 0;
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events).not.toContain("tailscale debug prefs");
	});

	it("keeps an existing matching operator without a set command", async () => {
		const f = fixture();
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events).toContain("tailscale debug prefs");
		expect(f.events.some((command) => command.includes("set --operator"))).toBe(
			false,
		);
	});

	it.each([
		[false, true],
		[true, true],
		[false, false],
		[true, false],
	])("continues service setup after operator failure (throws=%s, HTTPS ready=%s)", async (throws, ready) => {
		const f = fixture();
		const warnings = [];
		const messages = [];
		f.options.logger.warning = (message) => warnings.push(message);
		f.options.logger.success = (message) => messages.push(message);
		f.overrides.set("tailscale debug prefs", f.response('{"OperatorUser":""}'));
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command) => {
			if (command.includes("set --operator")) {
				f.events.push(command);
				if (throws) throw new Error("sudo timestamp expired");
				return false;
			}
			return run(command);
		};
		if (!ready)
			f.options.fetchImpl = async () =>
				new Response("not ready", { status: 503 });
		expect(await configureT3CodeServer(f.options)).toBe(ready);
		expect(f.events).toContain(`t3 service install --base-dir '${f.home}/.t3'`);
		expect(f.events).toContain(
			"systemctl --user is-active --quiet t3code.service",
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("sudo tailscale set --operator='test'");
		expect(warnings[0]).toContain("haoshoku --server-t3-code");
		if (ready) expect(messages.join(" ")).toContain("are ready");
		else {
			expect(messages).toEqual([]);
			expect(f.errors.join(" ")).toContain("HTTPS");
		}
	});
});

describe("Debian T3 listener verification", () => {
	it("errors on a non-loopback listener without announcing success", async () => {
		const f = fixture();
		const messages = [];
		f.options.logger.success = (message) => messages.push(message);
		f.overrides.set(
			listenerCommand,
			f.response("LISTEN 0 128 100.65.100.23:3773 *:*"),
		);
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events).toContain("https://server.tail123.ts.net");
		expect(f.errors.join(" ")).toContain("100.65.100.23");
		expect(f.errors.join(" ")).toContain("127.0.0.1");
		expect(f.errors.join(" ")).toContain("only via Tailscale Serve");
		expect(messages).toEqual([]);
	});

	it.each([
		"empty",
		"missing",
		"throws",
	])("logs unverifiable binding when ss is %s", async (mode) => {
		const f = fixture();
		const warnings = [];
		f.options.logger.warning = (message) => warnings.push(message);
		f.overrides.set(
			listenerCommand,
			mode === "throws"
				? new Error("ss missing")
				: f.response("", mode === "missing" ? 127 : 0),
		);
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(warnings.join(" ")).toContain("bind could not be verified");
		expect(f.errors).toEqual([]);
	});
});

it("holds a newer managed npm package even if PATH no longer resolves it", async () => {
	const f = fixture();
	f.overrides.set("t3 --version", f.response("", 127));
	f.overrides.set("command -v t3", f.response("", 1));
	fs.writeFileSync(
		path.join(f.home, ".local/lib/node_modules/t3/package.json"),
		'{"name":"t3","version":"0.2.0"}',
	);
	expect(await configureT3CodeServer(f.options)).toBe(false);
	expect(f.events.some((event) => event.startsWith("npm "))).toBe(false);
	expect(f.errors.join(" ")).toContain("newer");
});
