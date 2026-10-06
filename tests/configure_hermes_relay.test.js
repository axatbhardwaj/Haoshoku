import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { configureHermesRelay } from "../src/helpers/configure_hermes_relay.js";

const roots = [];
const projectRoot = path.resolve(import.meta.dir, "..");
const runtime = JSON.parse(
	fs.readFileSync(
		path.join(projectRoot, "configs/hermes-relay/hermes-runtime.json"),
		"utf8",
	),
);

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function fixture({
	activity = "idle",
	identity = { chatId: "123", userId: "123" },
	credentials = true,
} = {}) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-hermes-"));
	roots.push(home);
	const hermesHome = path.join(home, "custom-hermes");
	const python = path.join(hermesHome, "hermes-agent/venv/bin/python");
	fs.mkdirSync(path.dirname(python), { recursive: true });
	fs.writeFileSync(python, "fixture", { mode: 0o755 });
	fs.writeFileSync(path.join(hermesHome, "config.yaml"), "platforms: {}\n");
	const calls = [];
	const messages = [];
	const writes = [];
	const mutators = new Set([
		"mkdirSync",
		"chmodSync",
		"mkdtempSync",
		"rmSync",
		"writeFileSync",
		"renameSync",
		"copyFileSync",
		"cpSync",
		"symlinkSync",
	]);
	const setup = {
		home,
		hermesHome,
		projectRoot,
		calls,
		messages,
		writes,
		environment: { HERMES_HOME: hermesHome },
		hermesCandidates: [],
		isTTY: false,
		promptImpl: async () => {
			throw new Error("unexpected prompt");
		},
		fsImpl: new Proxy(fs, {
			get(target, key) {
				if (mutators.has(key))
					return (...args) => {
						writes.push([key, args[0]]);
						return target[key](...args);
					};
				return target[key];
			},
		}),
		whichImpl: (command) => (command === "hermes" ? "/mock/hermes" : null),
		logger: Object.fromEntries(
			["error", "warning", "info", "success", "dim"].map((key) => [
				key,
				(message) => messages.push(message),
			]),
		),
		runProcessImpl: async (argv, options) => {
			calls.push({ argv, options });
			if (argv[0] === "/mock/hermes" && argv[1] === "--version") {
				return { exitCode: 0, stdout: "Hermes Agent v0.21.1\n" };
			}
			if (argv[0] === python && argv[1] === "-c") {
				const value = {
					"telegram-identity": identity,
					"telegram-credentials": { ready: credentials },
					"gateway-activity": { activity },
				}[argv[3]];
				return { exitCode: 0, stdout: JSON.stringify(value) };
			}
			return {
				exitCode: 127,
				stdout: "",
				stderr: "not installed on this host",
			};
		},
	};
	return setup;
}

function expectReadOnly(setup) {
	expect(setup.writes).toEqual([]);
	expect(setup.calls.map(({ argv }) => argv[0])).not.toContain("paseo");
	expect(
		setup.calls.every(({ argv }) =>
			argv[0] === "/mock/hermes" ? argv[1] === "--version" : argv[1] === "-c",
		),
	).toBe(true);
}

describe("configureHermesRelay without Paseo", () => {
	it.each([
		"idle",
		"busy",
	])("keeps existing Hermes with a %s gateway, without activation or plugin prerequisites", async (activity) => {
		const setup = fixture({ activity });
		expect(await configureHermesRelay(setup)).toBe(true);
		expectReadOnly(setup);
		expect(
			setup.calls
				.filter(({ argv }) => argv[1] === "-c")
				.map(({ argv }) => argv[3])
				.sort(),
		).toEqual([
			"gateway-activity",
			"telegram-credentials",
			"telegram-identity",
		]);
	});

	it.each([
		["missing token", { credentials: false }],
		["unresolved private channel", { identity: null }],
		["group channel", { identity: { chatId: "-123", userId: "123" } }],
		["different owner", { identity: { chatId: "124", userId: "123" } }],
		["invalid owner", { identity: { chatId: "YOUR_ID", userId: "YOUR_ID" } }],
		["stopped or unknown gateway", { activity: "unknown" }],
	])("fails for %s and preserves existing plugin and marker files", async (_name, options) => {
		const setup = fixture(options);
		const files = [
			path.join(setup.home, ".config/haoshoku/hermes-relay.json"),
			path.join(setup.hermesHome, "plugins/paseo-review-relay/plugin.yaml"),
			path.join(setup.hermesHome, "plugin-data/paseo-review-relay/config.json"),
		];
		for (const file of files) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, "existing private data\n", { mode: 0o600 });
		}
		expect(await configureHermesRelay(setup)).toBe(false);
		expectReadOnly(setup);
		for (const file of files)
			expect(fs.readFileSync(file, "utf8")).toBe("existing private data\n");
	});

	it("keeps unrelated plugins, credentials and legacy markers on success and rerun", async () => {
		const setup = fixture();
		const files = [
			"config.yaml",
			".env",
			"plugins/other/plugin.yaml",
			"plugin-data/paseo-review-relay/config.json",
		];
		for (const file of files) {
			const target = path.join(setup.hermesHome, file);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, "preserved\n", { mode: 0o600 });
		}
		const marker = path.join(setup.home, ".config/haoshoku/hermes-relay.json");
		fs.mkdirSync(path.dirname(marker), { recursive: true });
		fs.writeFileSync(marker, "legacy marker\n");
		expect(await configureHermesRelay(setup)).toBe(true);
		expect(await configureHermesRelay(setup)).toBe(true);
		expectReadOnly(setup);
		for (const file of files)
			expect(fs.readFileSync(path.join(setup.hermesHome, file), "utf8")).toBe(
				"preserved\n",
			);
		expect(fs.readFileSync(marker, "utf8")).toBe("legacy marker\n");
	});

	it("rejects missing config before probing Telegram or the gateway", async () => {
		const setup = fixture();
		fs.rmSync(path.join(setup.hermesHome, "config.yaml"));
		expect(await configureHermesRelay(setup)).toBe(false);
		expect(setup.calls.map(({ argv }) => argv)).toEqual([
			["/mock/hermes", "--version"],
		]);
		expectReadOnly(setup);
	});

	it("fails an unusable existing Hermes without replacing it", async () => {
		const setup = fixture();
		setup.runProcessImpl = async (argv) => {
			setup.calls.push({ argv });
			return { exitCode: 1, stdout: "" };
		};
		expect(await configureHermesRelay(setup)).toBe(false);
		expect(setup.calls.map(({ argv }) => argv)).toEqual([
			["/mock/hermes", "--version"],
		]);
		expectReadOnly(setup);
	});

	it.each([
		"exit",
		"json",
	])("fails when the plugin-free probe returns invalid %s", async (failure) => {
		const setup = fixture();
		const runner = setup.runProcessImpl;
		setup.runProcessImpl = async (argv, options) =>
			argv[1] === "-c"
				? { exitCode: failure === "exit" ? 1 : 0, stdout: "invalid" }
				: runner(argv, options);
		expect(await configureHermesRelay(setup)).toBe(false);
		expectReadOnly(setup);
	});
});

function missingHermesFixture({
	fetchCode = 0,
	installCode = 0,
	availableAfter = true,
} = {}) {
	const setup = fixture();
	let installed = false;
	setup.whichImpl = (command) =>
		command === "hermes"
			? installed && availableAfter
				? "/mock/hermes"
				: null
			: ({ curl: "/mock/curl", bash: "/mock/bash" }[command] ?? null);
	const runner = setup.runProcessImpl;
	setup.runProcessImpl = async (argv, options) => {
		if (argv[0] === "/mock/curl" || argv[0] === "/mock/bash") {
			setup.calls.push({ argv, options });
			if (argv[0] === "/mock/bash") installed = installCode === 0;
			return {
				exitCode: argv[0] === "/mock/curl" ? fetchCode : installCode,
				stdout: "",
			};
		}
		return runner(argv, options);
	};
	return setup;
}

describe("pinned Hermes bootstrap", () => {
	it("installs only when absent, then verifies readiness without running setup", async () => {
		const setup = missingHermesFixture();
		expect(await configureHermesRelay(setup)).toBe(true);
		const commands = setup.calls.map(({ argv }) => argv);
		const installer = commands[0][4];
		expect(commands[0]).toEqual([
			"/mock/curl",
			"-fsSL",
			runtime.installer,
			"-o",
			installer,
		]);
		expect(commands[1]).toEqual([
			"/mock/bash",
			installer,
			"--commit",
			runtime.commit,
			"--skip-setup",
			"--skip-browser",
			"--skip-computer-use",
			"--non-interactive",
		]);
		expect(fs.existsSync(path.dirname(installer))).toBe(false);
		expect(
			commands
				.slice(2)
				.every((argv) => argv[1] === "--version" || argv[1] === "-c"),
		).toBe(true);
		setup.calls.length = 0;
		setup.writes.length = 0;
		expect(await configureHermesRelay(setup)).toBe(true);
		expectReadOnly(setup);
	});

	it.each([
		["fetch failure", { fetchCode: 1 }],
		["installer failure", { installCode: 1 }],
		["missing installed CLI", { availableAfter: false }],
	])("fails after %s and removes its temporary installer directory", async (_name, options) => {
		const setup = missingHermesFixture(options);
		expect(await configureHermesRelay(setup)).toBe(false);
		const installer = setup.calls[0].argv[4];
		expect(fs.existsSync(path.dirname(installer))).toBe(false);
		if (options.fetchCode) expect(setup.calls).toHaveLength(1);
	});

	it("rejects an invalid runtime pin before downloading", async () => {
		const setup = missingHermesFixture();
		setup.projectRoot = path.join(setup.home, "invalid-project");
		fs.mkdirSync(path.join(setup.projectRoot, "configs/hermes-relay"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(setup.projectRoot, "configs/hermes-relay/hermes-runtime.json"),
			JSON.stringify({ ...runtime, commit: "main" }),
		);
		expect(await configureHermesRelay(setup)).toBe(false);
		expect(setup.calls).toEqual([]);
		expect(setup.writes).toEqual([]);
	});
});
