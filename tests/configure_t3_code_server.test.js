import { describe, expect, it } from "bun:test";
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

describe("T3 Code headless service configuration", () => {
	it("installs the upstream service, verifies it, and prints pairing guidance", async () => {
		const commands = [];
		const messages = [];
		const result = await configureT3CodeServer({
			ensureNodeImpl: async () => true,
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
		expect(messages).toContain("Pair a client later with: npx t3@latest pair");
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
});
