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

function hasCommandsModel() {
	return (
		fs.existsSync("/usr/bin/qml6") &&
		fs.existsSync(
			"/usr/lib/qt6/qml/org/kde/kdeconnect/libkdeconnectdeclarativeplugin.so",
		)
	);
}

function seedKdeIdentity(home) {
	const configDir = path.join(home, ".config", "kdeconnect");
	const privateKey = path.join(configDir, "privateKey.pem");
	const certificate = path.join(configDir, "certificate.pem");
	fs.writeFileSync(
		path.join(configDir, "config"),
		"[General]\nkeyAlgorithm=EC\n",
	);
	const opensslEnv = { ...process.env, OPENSSL_CONF: "/etc/ssl/openssl.cnf" };
	const key = Bun.spawnSync(
		[
			"openssl",
			"ecparam",
			"-genkey",
			"-name",
			"prime256v1",
			"-noout",
			"-out",
			privateKey,
		],
		{ env: opensslEnv },
	);
	expect(key.exitCode, key.stderr.toString()).toBe(0);
	const cert = Bun.spawnSync(
		[
			"openssl",
			"req",
			"-new",
			"-x509",
			"-key",
			privateKey,
			"-out",
			certificate,
			"-days",
			"2",
			"-subj",
			"/CN=0123456789abcdef0123456789abcdef",
		],
		{ env: opensslEnv },
	);
	expect(cert.exitCode, cert.stderr.toString()).toBe(0);
	fs.chmodSync(privateKey, 0o600);
	fs.chmodSync(certificate, 0o600);
}

describe("KDE Connect commands", () => {
	it("delegates command mutation without rewriting the device plugin config", async () => {
		const home = makeHome();
		const target = seedDevice(home, {
			commands:
				'[General]\ncommands="@ByteArray({\\"{lock-id}\\":{\\"name\\":\\"Lock\\",\\"command\\":\\"omarchy system lock\\"}})"\n',
		});
		const deviceConfigBefore = fs.readFileSync(target.device, "utf8");
		const updates = [];

		const result = await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
			updateCommandsImpl: async ({ deviceId, name, command }) => {
				updates.push({ deviceId, name, command });
				const nativeCommands = {
					"{lock-id}": {
						command: "omarchy system lock",
						name: "Lock",
					},
					"native-id": { command, name },
				};
				fs.writeFileSync(
					target.commands,
					`[General]\ncommands=${JSON.stringify(`@ByteArray(${JSON.stringify(nativeCommands)})`)}\n`,
				);
				return { changed: true };
			},
		});

		expect(updates).toEqual([
			{
				deviceId: "phone123",
				name: "Screens Off",
				command:
					"/usr/bin/hyprctl dispatch 'hl.dsp.dpms({ action = \"disable\" })'",
			},
		]);
		expect(fs.readFileSync(target.device, "utf8")).toBe(deviceConfigBefore);
		expect(result).toEqual({
			configured: ["phone123"],
			unchanged: [],
			failed: [],
		});
	});

	it("rejects a symlinked device directory before invoking the native writer", async () => {
		const home = makeHome();
		const target = paths(home);
		const outsideDevice = path.join(home, "outside-device");
		const outsideCommands = path.join(
			outsideDevice,
			"kdeconnect_runcommand",
			"config",
		);
		fs.mkdirSync(path.dirname(outsideCommands), { recursive: true });
		fs.mkdirSync(target.base, { recursive: true });
		fs.writeFileSync(
			target.trusted,
			"[phone123]\nname=Phone\nprotocolVersion=8\n",
		);
		fs.writeFileSync(outsideCommands, "[General]\n");
		fs.symlinkSync(outsideDevice, path.join(target.base, "phone123"));
		let updates = 0;

		const result = await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
			updateCommandsImpl: async () => {
				updates += 1;
				return { changed: true };
			},
		});

		expect(result.failed).toEqual(["phone123"]);
		expect(updates).toBe(0);
		expect(fs.readFileSync(outsideCommands, "utf8")).toBe("[General]\n");
	});

	it("merges Screens Off without replacing existing commands", async () => {
		if (!hasCommandsModel()) return;
		const home = makeHome();
		const target = seedDevice(home, {
			commands:
				'[General]\ncommands="@ByteArray({\\"{lock-id}\\":{\\"name\\":\\"Lock\\",\\"command\\":\\"omarchy system lock\\"}})"\n',
		});
		seedKdeIdentity(home);
		const deviceConfigBefore = fs.readFileSync(target.device, "utf8");

		const result = await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
		});

		const commands = parseCommandsConfig(
			fs.readFileSync(target.commands, "utf8"),
		);
		expect(commands["{lock-id}"]).toEqual({
			name: "Lock",
			command: "omarchy system lock",
		});
		expect(
			Object.values(commands).find(
				(entry) => entry.name === SCREENS_OFF_COMMAND.name,
			),
		).toEqual({
			name: SCREENS_OFF_COMMAND.name,
			command: SCREENS_OFF_COMMAND.command,
		});
		expect(fs.readFileSync(target.device, "utf8")).toBe(deviceConfigBefore);
		expect(fs.statSync(target.commands).mode & 0o777).toBe(0o644);
		expect(result).toEqual({
			configured: ["phone123"],
			unchanged: [],
			failed: [],
		});
	});

	it("updates an existing named command in place and is idempotent", async () => {
		if (!hasCommandsModel()) return;
		const home = makeHome();
		const target = seedDevice(home, {
			commands:
				'[General]\ncommands="@ByteArray({\\"{custom-id}\\":{\\"name\\":\\"Screens Off\\",\\"command\\":\\"old-command\\"}})"\n',
		});
		seedKdeIdentity(home);
		const options = {
			home,
			logImpl: silentLog(),
		};

		await configureKdeConnectCommands(options);
		const first = fs.readFileSync(target.commands, "utf8");
		const secondResult = await configureKdeConnectCommands(options);

		const commands = parseCommandsConfig(first);
		expect(commands["{custom-id}"].command).toBe(SCREENS_OFF_COMMAND.command);
		expect(fs.readFileSync(target.commands, "utf8")).toBe(first);
		expect(secondResult.unchanged).toEqual(["phone123"]);
	});

	it("preserves malformed command config instead of overwriting it", async () => {
		const home = makeHome();
		const malformed = "[General]\ncommands=not-json\n";
		const target = seedDevice(home, { commands: malformed });

		const result = await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
		});

		expect(result.failed).toEqual(["phone123"]);
		expect(fs.readFileSync(target.commands, "utf8")).toBe(malformed);
		expect(fs.readFileSync(target.device, "utf8")).not.toContain(
			"kdeconnect_runcommandEnabled",
		);
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
		});
		expect(fs.existsSync(path.join(home, ".config", "kdeconnect"))).toBe(false);
	});

	it("writes the QByteArray encoding consumed by KDE Connect's CommandsModel", async () => {
		if (!hasCommandsModel()) return;

		const home = makeHome();
		seedDevice(home);
		seedKdeIdentity(home);
		await configureKdeConnectCommands({
			home,
			logImpl: silentLog(),
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
