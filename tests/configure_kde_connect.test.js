import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	configureKdeConnectCommands,
	parseCommandsConfig,
	SCREENS_OFF_COMMAND,
} from "../src/helpers/configure_kde_connect.js";

const homes = [];
const COMMANDS_MODEL_PROBE = path.join(
	import.meta.dir,
	"fixtures",
	"kde_commands_model_probe.qml",
);

afterEach(() => {
	for (const home of homes.splice(0)) {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

function makeHome() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-kdeconnect-"));
	homes.push(home);
	return home;
}

function paths(home, deviceId = "phone123") {
	const base = path.join(home, ".config", "kdeconnect");
	return {
		base,
		trusted: path.join(base, "trusted_devices"),
		device: path.join(base, deviceId, "config"),
		commands: path.join(base, deviceId, "kdeconnect_runcommand", "config"),
	};
}

function seedDevice(home, { deviceId = "phone123", commands } = {}) {
	const target = paths(home, deviceId);
	fs.mkdirSync(path.dirname(target.commands), { recursive: true });
	fs.writeFileSync(
		target.trusted,
		`[${deviceId}]\nname=Phone\nprotocolVersion=8\n`,
	);
	fs.writeFileSync(
		target.device,
		"[General]\nfoo=bar\n[Plugins]\nkdeconnect_pingEnabled=true\n",
		{ mode: 0o600 },
	);
	if (commands !== undefined) fs.writeFileSync(target.commands, commands);
	return target;
}

function silentLog() {
	return { success() {}, warning() {} };
}

describe("KDE Connect commands", () => {
	it("merges Screens Off without replacing existing commands and enables the plugin", async () => {
		const home = makeHome();
		const target = seedDevice(home, {
			commands:
				'[General]\ncommands="@ByteArray({\\"{lock-id}\\":{\\"name\\":\\"Lock\\",\\"command\\":\\"omarchy system lock\\"}})"\n',
		});
		const reloads = [];

		const result = await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
			reloadDeviceImpl: async (id) => {
				reloads.push(id);
				return true;
			},
		});

		const commands = parseCommandsConfig(
			fs.readFileSync(target.commands, "utf8"),
		);
		expect(commands["{lock-id}"]).toEqual({
			name: "Lock",
			command: "omarchy system lock",
		});
		expect(commands[SCREENS_OFF_COMMAND.id]).toEqual({
			name: SCREENS_OFF_COMMAND.name,
			command: SCREENS_OFF_COMMAND.command,
		});
		expect(fs.readFileSync(target.device, "utf8")).toContain(
			"[Plugins]\nkdeconnect_pingEnabled=true\nkdeconnect_runcommandEnabled=true\n",
		);
		expect(fs.statSync(target.commands).mode & 0o777).toBe(0o644);
		expect(reloads).toEqual(["phone123"]);
		expect(result).toEqual({
			configured: ["phone123"],
			unchanged: [],
			failed: [],
			reloadPending: [],
		});
	});

	it("updates an existing named command in place and is idempotent", async () => {
		const home = makeHome();
		const target = seedDevice(home, {
			commands:
				'[General]\ncommands=@ByteArray({"{custom-id}":{"name":"Screens Off","command":"old-command"}})\n',
		});
		const reloads = [];
		const options = {
			home,
			logImpl: silentLog(),
			reloadDeviceImpl: async (id) => {
				reloads.push(id);
				return true;
			},
		};

		await configureKdeConnectCommands(options);
		const first = fs.readFileSync(target.commands, "utf8");
		const secondResult = await configureKdeConnectCommands(options);

		const commands = parseCommandsConfig(first);
		expect(commands["{custom-id}"].command).toBe(SCREENS_OFF_COMMAND.command);
		expect(commands[SCREENS_OFF_COMMAND.id]).toBeUndefined();
		expect(fs.readFileSync(target.commands, "utf8")).toBe(first);
		expect(reloads).toEqual(["phone123", "phone123"]);
		expect(secondResult.unchanged).toEqual(["phone123"]);
	});

	it("preserves malformed command config instead of overwriting it", async () => {
		const home = makeHome();
		const malformed = "[General]\ncommands=not-json\n";
		const target = seedDevice(home, { commands: malformed });
		let reloads = 0;

		const result = await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
			reloadDeviceImpl: async () => {
				reloads += 1;
				return true;
			},
		});

		expect(result.failed).toEqual(["phone123"]);
		expect(fs.readFileSync(target.commands, "utf8")).toBe(malformed);
		expect(fs.readFileSync(target.device, "utf8")).not.toContain(
			"kdeconnect_runcommandEnabled",
		);
		expect(reloads).toBe(0);
	});

	it("reports a pending refresh while keeping the persistent configuration", async () => {
		const home = makeHome();
		const target = seedDevice(home);

		const result = await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
			reloadDeviceImpl: async () => false,
		});

		expect(result.configured).toEqual(["phone123"]);
		expect(result.reloadPending).toEqual(["phone123"]);
		expect(
			parseCommandsConfig(fs.readFileSync(target.commands, "utf8"))[
				SCREENS_OFF_COMMAND.id
			],
		).toBeDefined();
		expect(fs.statSync(target.commands).mode & 0o777).toBe(0o600);
	});

	it("does nothing before a phone has been paired", async () => {
		const home = makeHome();
		const result = await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
		});

		expect(result).toEqual({
			configured: [],
			unchanged: [],
			failed: [],
			reloadPending: [],
		});
		expect(fs.existsSync(path.join(home, ".config", "kdeconnect"))).toBe(false);
	});

	it("writes the QByteArray encoding consumed by KDE Connect's CommandsModel", async () => {
		if (
			!fs.existsSync("/usr/bin/qml6") ||
			!fs.existsSync(
				"/usr/lib/qt6/qml/org/kde/kdeconnect/libkdeconnectdeclarativeplugin.so",
			)
		) {
			return;
		}

		const home = makeHome();
		seedDevice(home);
		await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
			reloadDeviceImpl: async () => true,
		});

		const probe = Bun.spawnSync(["qml6", COMMANDS_MODEL_PROBE], {
			env: {
				...process.env,
				QT_QPA_PLATFORM: "offscreen",
				XDG_CONFIG_HOME: path.join(home, ".config"),
			},
			stderr: "pipe",
			stdout: "pipe",
		});

		expect(
			probe.exitCode,
			`${probe.stdout.toString()}\n${probe.stderr.toString()}`,
		).toBe(0);
	});
});
