import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	configureT3CodeServer,
	ensureT3NodeRuntime,
	isT3NodeVersionSupported,
} from "../src/helpers/configure_t3_code_server.js";

const silentLogger = {
	error() {},
	info() {},
	success() {},
	warning() {},
};

const floor = "0.0.46-nightly.20261003.2610";
const serveConfig = {
	TCP: { 443: { HTTPS: true } },
	Web: {
		"server.tail123.ts.net:443": {
			Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } },
		},
	},
};
const homes = [];
afterEach(() => {
	for (const home of homes.splice(0)) {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

function fixture({
	version = `t3 v${floor}\n`,
	installedVersion = `t3 v${floor}\n`,
	desired = false,
} = {}) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-t3-"));
	homes.push(home);
	const events = [];
	const errors = [];
	const overrides = new Map();
	const dropIns = path.join(home, ".config/systemd/user/t3code.service.d");
	const installedT3 = `'${home}/.local/bin/t3'`;
	const response = (stdout = "", exitCode = 0) => ({ stdout, exitCode });
	const options = {
		home,
		uid: 1000,
		ensureNodeImpl: async () => {
			events.push("node");
			return true;
		},
		captureCommandImpl: async (command) => {
			events.push(command);
			if (overrides.has(command)) {
				const value = overrides.get(command);
				if (value instanceof Error) throw value;
				return typeof value === "function" ? value() : value;
			}
			if (command === "tailscale status") return response("logged in");
			if (command === "t3 --version")
				return response(version ?? "", version === null ? 127 : 0);
			if (command === `${installedT3} --version`)
				return response(installedVersion);
			if (command.endsWith("connect status --json"))
				return response(JSON.stringify({ desired }));
			if (command === "tailscale serve status --json")
				return response(JSON.stringify(serveConfig));
			throw new Error(`Unexpected probe: ${command}`);
		},
		runCommandImpl: async (command) => {
			events.push(command);
			if (command.endsWith("connect unlink")) desired = false;
			if (command.endsWith("service install")) {
				expect(
					fs.readFileSync(path.join(dropIns, "axstack-path.conf"), "utf8"),
				).toBe(
					'[Service]\nEnvironment="PATH=%h/.local/bin:%h/.bun/bin:%h/.grok/bin:/usr/local/bin:/usr/bin:/bin"\n',
				);
				expect(
					fs.readFileSync(path.join(dropIns, "axstack-tailscale.conf"), "utf8"),
				).toBe("[Service]\nEnvironment=T3CODE_TAILSCALE_SERVE=true\n");
				const sandbox = path.join(dropIns, "axstack-sandbox.conf");
				expect(fs.existsSync(sandbox)).toBe(options.uid === 0);
				if (options.uid === 0) {
					expect(fs.readFileSync(sandbox, "utf8")).toBe(
						"[Service]\nEnvironment=IS_SANDBOX=1\n",
					);
				}
			}
			return overrides.get(command) ?? true;
		},
		fetchImpl: async (url, init) => {
			events.push(url);
			expect(init.signal).toBeInstanceOf(AbortSignal);
			expect(init.redirect).toBe("error");
			return new Response("T3 ready");
		},
		sleepImpl: async (ms) => events.push(`sleep ${ms}`),
		maxReadinessAttempts: 2,
		logger: { ...silentLogger, error: (message) => errors.push(message) },
	};
	return {
		home,
		dropIns,
		installedT3,
		options,
		events,
		errors,
		overrides,
		response,
	};
}

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
			"t3 connect status --json",
			"t3 service install",
			"systemctl --user is-active --quiet t3code.service",
			"tailscale serve status --json",
			"https://server.tail123.ts.net",
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
		expect(f.events).toContain("t3 service install");
		expect(f.events.some((event) => event.startsWith("npm "))).toBe(false);
	});

	it.each([
		null,
		"t3 v0.0.45",
		"t3 v0.0.46-nightly.20261003.2609",
		"t3 v0.0.46-nightly.20261002.9999",
		"garbage",
		"0.0.99-nightly..1",
		"00.0.99",
		"t3 v0.0.99-nightly..1",
		"t3 v00.0.99",
		"t3 vv0.0.99",
		"t3 v0.0.99 extra output",
	])("installs the durable nightly CLI when PATH reports %s", async (version) => {
		const f = fixture({ version });
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events).toContain(
			`npm --global --prefix '${f.home}/.local' install t3@nightly`,
		);
		expect(f.events).toContain(`${f.installedT3} --version`);
		expect(f.events).toContain(`${f.installedT3} service install`);
		expect(f.events).not.toContain("t3 service install");
	});

	it.each([
		"t3 v0.0.46-nightly.20261004.2644",
		"t3 v0.0.46",
		"t3 v0.0.47-nightly.20261001.1",
		"t3 v1.0.0",
	])("keeps a newer CLI %s without installing npm packages", async (version) => {
		const f = fixture({ version });
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events.some((event) => event.startsWith("npm "))).toBe(false);
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

	it("stops when nightly installation fails", async () => {
		const f = fixture({ version: null });
		const install = `npm --global --prefix '${f.home}/.local' install t3@nightly`;
		f.overrides.set(install, false);
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events.at(-1)).toBe(install);
		expect(fs.existsSync(f.dropIns)).toBe(false);
	});

	it("unlinks enabled Connect and confirms disabled before installing the service", async () => {
		const f = fixture({ desired: true });
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(f.events.slice(3, 7)).toEqual([
			"t3 connect status --json",
			"t3 connect unlink",
			"t3 connect status --json",
			"t3 service install",
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
		expect(fs.readFileSync(path.join(f.dropIns, "custom.conf"), "utf8")).toBe(
			"custom",
		);
		f.options.uid = 1000;
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(fs.existsSync(path.join(f.dropIns, "axstack-sandbox.conf"))).toBe(
			false,
		);
	});

	it("fails with guidance when drop-ins cannot be written", async () => {
		const f = fixture();
		fs.mkdirSync(path.dirname(f.dropIns), { recursive: true });
		fs.writeFileSync(f.dropIns, "blocked");
		expect(await configureT3CodeServer(f.options)).toBe(false);
		expect(f.events).not.toContain("t3 service install");
		expect(f.errors.join(" ")).toContain("drop-in");
	});

	it.each([
		"t3 service install",
		"systemctl --user is-active --quiet t3code.service",
	])("fails when %s fails", async (command) => {
		const f = fixture();
		f.overrides.set(command, false);
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
		if (command === "t3 --version") {
			expect(await configureT3CodeServer(f.options)).toBe(true);
			expect(f.events).toContain(`${f.installedT3} service install`);
		} else {
			expect(await configureT3CodeServer(f.options)).toBe(false);
			expect(f.errors.length).toBeGreaterThan(0);
		}
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
