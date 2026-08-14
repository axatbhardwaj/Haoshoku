import { describe, expect, it } from "bun:test";
import {
	canResumeT3Connect,
	configureT3CodeServer,
	ensureT3NodeRuntime,
	ensureTailscaleService,
	isT3ConnectReady,
	isSafeUnixUsername,
	isT3NodeVersionSupported,
	parseT3ConnectStatus,
	parseTailscaleBackendState,
} from "../src/helpers/configure_t3_code_server.js";

const silentLogger = {
	error() {},
	info() {},
	success() {},
	warning() {},
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
		expect(parseT3ConnectStatus(readyJson)).toEqual({
			desired: true,
			authenticated: true,
			linked: true,
			relayUrl: "https://relay.t3.codes",
			relayClientAvailable: true,
		});
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

	it("rejects malformed and structurally invalid status", () => {
		for (const output of [
			"",
			"not-json",
			"[]",
			"{}",
			'{"desired":"yes"}',
		]) {
			expect(parseT3ConnectStatus(output)).toBeNull();
		}
	});
});

describe("Tailscale service preparation", () => {
	it("enables and verifies an existing connected vendor service as root", async () => {
		const commands = [];
		const result = await ensureTailscaleService({
			commandExistsImpl: async () => true,
			getBackendStateImpl: () => "Running",
			getUserContextImpl: () => ({ isRoot: true, username: null }),
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"systemctl enable --now tailscaled",
			"systemctl is-enabled tailscaled",
			"systemctl is-active tailscaled",
		]);
	});

	it("uses the official installer before starting the service when Tailscale is missing", async () => {
		const commands = [];
		const availability = [false, true];
		const result = await ensureTailscaleService({
			commandExistsImpl: async () => availability.shift() ?? true,
			getBackendStateImpl: () => "Running",
			getUserContextImpl: () => ({ isRoot: true, username: null }),
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"curl -fsSL https://tailscale.com/install.sh | sh",
			"systemctl enable --now tailscaled",
			"systemctl is-enabled tailscaled",
			"systemctl is-active tailscaled",
		]);
	});

	it("authenticates a disconnected root node once and rechecks connectivity", async () => {
		const commands = [];
		const states = ["NeedsLogin", "Running"];
		const result = await ensureTailscaleService({
			commandExistsImpl: async () => true,
			getBackendStateImpl: () => states.shift() ?? null,
			getUserContextImpl: () => ({ isRoot: true, username: null }),
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"systemctl enable --now tailscaled",
			"systemctl is-enabled tailscaled",
			"systemctl is-active tailscaled",
			"tailscale up",
		]);
	});

	it("uses sudo and grants the validated service owner operator access", async () => {
		const commands = [];
		const states = ["NeedsLogin", "Running"];
		const result = await ensureTailscaleService({
			commandExistsImpl: async () => true,
			getBackendStateImpl: () => states.shift() ?? null,
			getUserContextImpl: () => ({ isRoot: false, username: "deploy-user" }),
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"sudo systemctl enable --now tailscaled",
			"sudo systemctl is-enabled tailscaled",
			"sudo systemctl is-active tailscaled",
			"sudo tailscale up",
			"sudo tailscale set --operator=deploy-user",
		]);
	});

	it("stops after a failed installer and never reaches systemd", async () => {
		const commands = [];
		const result = await ensureTailscaleService({
			commandExistsImpl: async () => false,
			getBackendStateImpl: () => "Running",
			getUserContextImpl: () => ({ isRoot: true, username: null }),
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return false;
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual([
			"curl -fsSL https://tailscale.com/install.sh | sh",
		]);
	});

	it("stops at each systemd failure boundary before authentication", async () => {
		const systemdCommands = [
			"systemctl enable --now tailscaled",
			"systemctl is-enabled tailscaled",
			"systemctl is-active tailscaled",
		];
		for (const failingCommand of systemdCommands) {
			const commands = [];
			const result = await ensureTailscaleService({
				commandExistsImpl: async () => true,
				getBackendStateImpl: () => "NeedsLogin",
				getUserContextImpl: () => ({ isRoot: true, username: null }),
				logger: silentLogger,
				runCommandImpl: async (command) => {
					commands.push(command);
					return command !== failingCommand;
				},
			});

			expect(result).toBe(false);
			expect(commands.at(-1)).toBe(failingCommand);
			expect(commands).not.toContain("tailscale up");
		}
	});

	it("rejects an incomplete login before pairing can continue", async () => {
		const commands = [];
		const result = await ensureTailscaleService({
			commandExistsImpl: async () => true,
			getBackendStateImpl: () => "NeedsLogin",
			getUserContextImpl: () => ({ isRoot: true, username: null }),
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(false);
		expect(commands.at(-1)).toBe("tailscale up");
	});

	it("rejects unsafe non-root usernames before granting operator access", async () => {
		const commands = [];
		const result = await ensureTailscaleService({
			commandExistsImpl: async () => true,
			getBackendStateImpl: () => "Running",
			getUserContextImpl: () => ({
				isRoot: false,
				username: "deploy; reboot",
			}),
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual([
			"sudo systemctl enable --now tailscaled",
			"sudo systemctl is-enabled tailscaled",
			"sudo systemctl is-active tailscaled",
		]);
	});

	it("returns failure when operator access cannot be granted", async () => {
		const commands = [];
		const result = await ensureTailscaleService({
			commandExistsImpl: async () => true,
			getBackendStateImpl: () => "Running",
			getUserContextImpl: () => ({ isRoot: false, username: "deploy" }),
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return !command.includes("set --operator");
			},
		});

		expect(result).toBe(false);
		expect(commands.at(-1)).toBe("sudo tailscale set --operator=deploy");
	});
});

describe("T3 Code headless service configuration", () => {
	it("installs the upstream service, prepares Tailscale, pairs privately, and verifies Serve", async () => {
		const commands = [];
		const messages = [];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			ensureTailscaleImpl: async () => true,
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
			"npx --yes t3@latest pair --tailscale",
			"tailscale serve status",
		]);
		expect(
			messages.some((message) => message.includes("npx t3@latest pair")),
		).toBe(false);
		expect(messages.some((message) => message.includes("key expiry"))).toBe(
			true,
		);
	});

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
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			runCommandImpl: async (command) => {
				commands.push(command);
				return false;
			},
			logger: silentLogger,
		});

		expect(result).toBe(false);
		expect(commands).toEqual(["npx --yes t3@latest service install"]);
	});

	it("returns failure when the installed service cannot be verified", async () => {
		const commands = [];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
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
	});

	it("stops before pairing when Tailscale preparation fails", async () => {
		const commands = [];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			ensureTailscaleImpl: async () => false,
			logger: silentLogger,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual([
			"npx --yes t3@latest service install",
			"npx --yes t3@latest service status",
		]);
	});

	it("stops before Serve verification when private pairing fails", async () => {
		const commands = [];
		const errors = [];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			ensureTailscaleImpl: async () => true,
			logger: { ...silentLogger, error: (message) => errors.push(message) },
			runCommandImpl: async (command) => {
				commands.push(command);
				return !command.includes("pair --tailscale");
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual([
			"npx --yes t3@latest service install",
			"npx --yes t3@latest service status",
			"npx --yes t3@latest pair --tailscale",
		]);
		expect(errors.at(-1)).toContain("npx --yes t3@latest pair --tailscale");
	});

	it("returns failure with the Serve retry command when verification fails", async () => {
		const commands = [];
		const errors = [];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
			ensureTailscaleImpl: async () => true,
			logger: { ...silentLogger, error: (message) => errors.push(message) },
			runCommandImpl: async (command) => {
				commands.push(command);
				return command !== "tailscale serve status";
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual([
			"npx --yes t3@latest service install",
			"npx --yes t3@latest service status",
			"npx --yes t3@latest pair --tailscale",
			"tailscale serve status",
		]);
		expect(errors.at(-1)).toContain("tailscale serve status");
	});
});
