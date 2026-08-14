import { describe, expect, it } from "bun:test";
import {
	canResumeT3Connect,
	configureT3CodeServer,
	ensureT3NodeRuntime,
	isT3ConnectReady,
	isT3NodeVersionSupported,
	parseT3ConnectStatus,
	readT3ConnectStatus,
} from "../src/helpers/configure_t3_code_server.js";

const silentLogger = {
	error() {},
	info() {},
	success() {},
	warning() {},
};

const readyStatus = {
	desired: true,
	authenticated: true,
	linked: true,
	relayUrl: "https://relay.t3.codes",
	relayClientAvailable: true,
};

const pendingStatus = {
	...readyStatus,
	linked: false,
	relayUrl: null,
};

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

describe("T3 Connect status parsing", () => {
	const readyJson = JSON.stringify({
		desired: true,
		authenticated: true,
		linked: true,
		cloudUserId: "must-not-be-retained",
		relayUrl: "https://relay.t3.codes",
		publishAgentActivity: false,
		relayClient: { status: "available", source: "managed" },
	});

	it("parses only readiness fields from T3 Connect JSON", () => {
		expect(parseT3ConnectStatus(readyJson)).toEqual(readyStatus);
	});

	it("distinguishes ready and resumable pending states", () => {
		const ready = parseT3ConnectStatus(readyJson);
		const pending = parseT3ConnectStatus(
			JSON.stringify({
				desired: true,
				authenticated: true,
				linked: false,
				relayUrl: null,
				relayClient: { status: "available" },
			}),
		);

		expect(isT3ConnectReady(ready)).toBe(true);
		expect(isT3ConnectReady(pending)).toBe(false);
		expect(canResumeT3Connect(pending)).toBe(true);
	});

	it("rejects incomplete relay state as not ready or resumable", () => {
		const missingClient = { ...readyStatus, relayClientAvailable: false };
		const emptyRelay = { ...readyStatus, relayUrl: "  " };

		expect(isT3ConnectReady(missingClient)).toBe(false);
		expect(canResumeT3Connect(missingClient)).toBe(false);
		expect(isT3ConnectReady(emptyRelay)).toBe(false);
	});

	it("rejects malformed and structurally invalid status", () => {
		for (const output of ["", "not-json", "[]", "{}", '{"desired":"yes"}']) {
			expect(parseT3ConnectStatus(output)).toBeNull();
		}
	});

	it("runs the machine-readable status command without retaining identifiers", () => {
		const calls = [];
		const result = readT3ConnectStatus({
			spawnSyncImpl: (args, options) => {
				calls.push({ args, options });
				return {
					exitCode: 0,
					stdout: new TextEncoder().encode(readyJson),
				};
			},
		});

		expect(result).toEqual(readyStatus);
		expect(calls).toEqual([
			{
				args: ["npx", "--yes", "t3@latest", "connect", "status", "--json"],
				options: { stderr: "ignore", stdout: "pipe" },
			},
		]);
	});

	it("returns null when the status command fails", () => {
		expect(
			readT3ConnectStatus({
				spawnSyncImpl: () => ({ exitCode: 1, stdout: new Uint8Array() }),
			}),
		).toBeNull();
	});
});

describe("T3 Code headless service configuration", () => {
	it("does not invoke T3 when a compatible Node.js runtime cannot be prepared", async () => {
		const commands = [];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => false,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			logger: silentLogger,
		});

		expect(result).toBe(false);
		expect(commands).toEqual([]);
	});

	it("skips the status probe when service installation fails", async () => {
		const commands = [];
		let statusCalls = 0;
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			getConnectStatusImpl: async () => {
				statusCalls += 1;
				return readyStatus;
			},
			runCommandImpl: async (command) => {
				commands.push(command);
				return false;
			},
			logger: silentLogger,
		});

		expect(result).toBe(false);
		expect(commands).toEqual(["npx --yes t3@latest service install"]);
		expect(statusCalls).toBe(0);
	});

	it("returns failure when the installed service cannot be verified", async () => {
		const commands = [];
		let statusCalls = 0;
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			getConnectStatusImpl: async () => {
				statusCalls += 1;
				return readyStatus;
			},
			runCommandImpl: async (command) => {
				commands.push(command);
				return !command.endsWith("service status");
			},
			logger: silentLogger,
		});

		expect(result).toBe(false);
		expect(commands).toEqual([
			"npx --yes t3@latest service install",
			"npx --yes t3@latest service status",
		]);
		expect(statusCalls).toBe(0);
	});

	it("keeps an already-ready Connect environment without relinking or restarting", async () => {
		const commands = [];
		const messages = [];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			getConnectStatusImpl: async () => readyStatus,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			logger: {
				...silentLogger,
				info: (message) => messages.push(message),
				success: (message) => messages.push(message),
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"npx --yes t3@latest service install",
			"npx --yes t3@latest service status",
		]);
		expect(
			messages.some((message) => message.includes("already provisioned")),
		).toBe(true);
	});

	it("restarts a previously authorized pending environment without relinking", async () => {
		const commands = [];
		const statuses = [pendingStatus, readyStatus];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			getConnectStatusImpl: async () =>
				statuses.length > 0 ? statuses.shift() : readyStatus,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			sleepImpl: async () => {},
			logger: silentLogger,
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"npx --yes t3@latest service install",
			"npx --yes t3@latest service status",
			"npx --yes t3@latest service update",
			"systemctl --user restart t3code.service",
			"npx --yes t3@latest service status",
		]);
	});

	it("links headlessly, restarts, polls, and verifies the service", async () => {
		const commands = [];
		const sleeps = [];
		const messages = [];
		const statuses = [null, pendingStatus, readyStatus];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			getConnectStatusImpl: async () =>
				statuses.length > 0 ? statuses.shift() : readyStatus,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
			logger: {
				...silentLogger,
				info: (message) => messages.push(message),
				success: (message) => messages.push(message),
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"npx --yes t3@latest service install",
			"npx --yes t3@latest service status",
			"npx --yes t3@latest connect link --headless",
			"npx --yes t3@latest service update",
			"systemctl --user restart t3code.service",
			"npx --yes t3@latest service status",
		]);
		expect(sleeps).toEqual([2000]);
		expect(messages.some((message) => message.includes("phone"))).toBe(true);
		expect(commands.some((command) => command.includes("tailscale"))).toBe(
			false,
		);
	});

	it("stops at each Connect command failure boundary", async () => {
		for (const failingCommand of [
			"npx --yes t3@latest connect link --headless",
			"npx --yes t3@latest service update",
			"systemctl --user restart t3code.service",
		]) {
			const commands = [];
			const errors = [];
			const result = await configureT3CodeServer({
				ensureNodeImpl: async () => true,
				getConnectStatusImpl: async () => null,
				runCommandImpl: async (command) => {
					commands.push(command);
					return command !== failingCommand;
				},
				sleepImpl: async () => {},
				logger: { ...silentLogger, error: (message) => errors.push(message) },
			});

			expect(result).toBe(false);
			expect(commands.at(-1)).toBe(failingCommand);
			expect(errors.at(-1)).toContain(failingCommand);
			expect(commands.some((command) => command.includes("tailscale"))).toBe(
				false,
			);
		}
	});

	it("times out when the environment never becomes ready", async () => {
		const errors = [];
		let statusCalls = 0;
		let sleepCalls = 0;
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			getConnectStatusImpl: async () => {
				statusCalls += 1;
				return pendingStatus;
			},
			runCommandImpl: async () => true,
			sleepImpl: async () => {
				sleepCalls += 1;
			},
			maxConnectAttempts: 2,
			logger: { ...silentLogger, error: (message) => errors.push(message) },
		});

		expect(result).toBe(false);
		expect(statusCalls).toBe(3);
		expect(sleepCalls).toBe(1);
		expect(errors.at(-1)).toContain("npx --yes t3@latest connect status");
	});

	it("fails when the provisioned service cannot be verified", async () => {
		const commands = [];
		const statuses = [pendingStatus, readyStatus];
		let serviceStatusCalls = 0;
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			getConnectStatusImpl: async () => statuses.shift() ?? readyStatus,
			runCommandImpl: async (command) => {
				commands.push(command);
				if (!command.endsWith("service status")) return true;
				serviceStatusCalls += 1;
				return serviceStatusCalls === 1;
			},
			sleepImpl: async () => {},
			logger: silentLogger,
		});

		expect(result).toBe(false);
		expect(commands.at(-1)).toBe("npx --yes t3@latest service status");
	});
});
