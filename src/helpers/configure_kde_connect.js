import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

export const SCREENS_OFF_COMMAND = Object.freeze({
	name: "Screens Off",
	command: "/usr/bin/hyprctl dispatch 'hl.dsp.dpms({ action = \"disable\" })'",
});

const SAFE_DEVICE_ID = /^[A-Za-z0-9_-]+$/;
const COMMANDS_WRITER = path.join(
	import.meta.dir,
	"kde_connect_commands_writer.qml",
);

function decodeCommandsValue(value) {
	let decoded = value.trim();
	if (decoded.startsWith('"') && decoded.endsWith('"')) {
		decoded = JSON.parse(decoded);
	}
	if (!decoded.startsWith("@ByteArray(") || !decoded.endsWith(")")) {
		throw new Error("commands is not a KDE byte-array value");
	}
	let json = decoded.slice("@ByteArray(".length, -1);
	if (!value.trim().startsWith('"')) json = json.replaceAll("\\\\", "\\");
	const commands = JSON.parse(json);
	if (
		commands === null ||
		typeof commands !== "object" ||
		Array.isArray(commands)
	) {
		throw new Error("commands is not a JSON object");
	}
	return commands;
}

export function parseCommandsConfig(content) {
	let inGeneral = false;
	const values = [];
	for (const rawLine of content.split(/\r?\n/)) {
		if (rawLine === "" || /^\s*[#;]/.test(rawLine)) continue;
		const section = rawLine.match(/^\[([^\]]+)\]$/);
		if (section) {
			inGeneral = section[1] === "General";
			continue;
		}
		if (!rawLine.includes("=")) {
			throw new Error("commands config contains a malformed INI line");
		}
		if (inGeneral && rawLine.startsWith("commands=")) {
			values.push(rawLine.slice("commands=".length));
		}
	}
	if (values.length > 1) {
		throw new Error("duplicate commands keys in [General]");
	}
	return values.length === 0 ? {} : decodeCommandsValue(values[0]);
}

function trustedDeviceIds(content) {
	return [...content.matchAll(/^\[([^\]]+)\]\r?$/gm)]
		.map((match) => match[1])
		.filter((id) => SAFE_DEVICE_ID.test(id));
}

function assertPathType(file, expectedType, fsImpl) {
	let stat;
	try {
		stat = fsImpl.lstatSync(file);
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	if (stat.isSymbolicLink()) throw new Error(`${file} is a symbolic link`);
	if (expectedType === "directory" && !stat.isDirectory()) {
		throw new Error(`${file} is not a directory`);
	}
	if (expectedType === "file" && !stat.isFile()) {
		throw new Error(`${file} is not a regular file`);
	}
}

function assertSafeDevicePaths(kdeConnectDir, deviceId, fsImpl) {
	const deviceDir = path.join(kdeConnectDir, deviceId);
	const pluginDir = path.join(deviceDir, "kdeconnect_runcommand");
	const commandsFile = path.join(pluginDir, "config");
	assertPathType(kdeConnectDir, "directory", fsImpl);
	assertPathType(deviceDir, "directory", fsImpl);
	assertPathType(pluginDir, "directory", fsImpl);
	assertPathType(commandsFile, "file", fsImpl);
	return commandsFile;
}

async function updateCommandsWithKde({ deviceId, name, command, home }) {
	const child = Bun.spawn(
		["qml6", COMMANDS_WRITER, "--", deviceId, name, command],
		{
			env: {
				...process.env,
				HOME: home,
				QT_QPA_PLATFORM: "offscreen",
				XDG_CONFIG_HOME: path.join(home, ".config"),
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode === 0) return { changed: true };
	if (exitCode === 10) return { changed: false };
	const details = `${stdout}\n${stderr}`.trim();
	throw new Error(
		`KDE CommandsModel writer exited ${exitCode}${details ? `: ${details}` : ""}`,
	);
}

function readCommands(file, fsImpl) {
	try {
		return parseCommandsConfig(fsImpl.readFileSync(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return {};
		throw error;
	}
}

function matchingCommands(commands, name) {
	return Object.values(commands).filter((entry) => entry?.name === name);
}

/** Merge Haoshoku remote commands through KDE Connect's native config model. */
export async function configureKdeConnectCommands({
	home = homedir(),
	fsImpl = fs,
	logImpl = log,
	updateCommandsImpl = updateCommandsWithKde,
} = {}) {
	const kdeConnectDir = path.join(home, ".config", "kdeconnect");
	const trustedDevicesFile = path.join(kdeConnectDir, "trusted_devices");
	if (!fsImpl.existsSync(trustedDevicesFile)) {
		logImpl.warning(
			"No paired KDE Connect devices found. Pair a phone, then rerun haoshoku --kde-connect-commands.",
		);
		return { configured: [], unchanged: [], failed: [] };
	}
	assertPathType(kdeConnectDir, "directory", fsImpl);
	assertPathType(trustedDevicesFile, "file", fsImpl);

	const deviceIds = trustedDeviceIds(
		fsImpl.readFileSync(trustedDevicesFile, "utf8"),
	);
	if (deviceIds.length === 0) {
		logImpl.warning(
			"No paired KDE Connect devices found. Pair a phone, then rerun haoshoku --kde-connect-commands.",
		);
		return { configured: [], unchanged: [], failed: [] };
	}

	const result = { configured: [], unchanged: [], failed: [] };
	for (const deviceId of deviceIds) {
		try {
			const commandsFile = assertSafeDevicePaths(
				kdeConnectDir,
				deviceId,
				fsImpl,
			);
			const before = readCommands(commandsFile, fsImpl);
			const existing = matchingCommands(before, SCREENS_OFF_COMMAND.name);
			if (existing.length > 1) {
				throw new Error("multiple commands are named Screens Off");
			}
			if (existing[0]?.command === SCREENS_OFF_COMMAND.command) {
				result.unchanged.push(deviceId);
				logImpl.success(
					`KDE Connect Screens Off is already configured for ${deviceId}.`,
				);
				continue;
			}

			const update = await updateCommandsImpl({
				deviceId,
				name: SCREENS_OFF_COMMAND.name,
				command: SCREENS_OFF_COMMAND.command,
				home,
			});
			const after = readCommands(commandsFile, fsImpl);
			const configured = matchingCommands(after, SCREENS_OFF_COMMAND.name);
			if (
				configured.length !== 1 ||
				configured[0].command !== SCREENS_OFF_COMMAND.command
			) {
				throw new Error("KDE CommandsModel did not persist Screens Off");
			}
			(update.changed ? result.configured : result.unchanged).push(deviceId);
			logImpl.success(`Configured KDE Connect Screens Off for ${deviceId}.`);
		} catch (error) {
			result.failed.push(deviceId);
			logImpl.warning(
				`KDE Connect command setup failed for ${deviceId} (${error?.message ?? error}); existing config was left untouched.`,
			);
		}
	}
	return result;
}
