import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

export const SCREENS_OFF_COMMAND = Object.freeze({
	id: "{c20e0ac6-3283-4764-8258-ce354ed323d9}",
	name: "Screens Off",
	command: "/usr/bin/hyprctl dispatch 'hl.dsp.dpms({ action = \"disable\" })'",
});

const SAFE_DEVICE_ID = /^[A-Za-z0-9_-]+$/;
let atomicWriteSequence = 0;

function readFileSnapshot(file, fsImpl) {
	try {
		const stat = fsImpl.lstatSync(file);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			throw new Error(`${file} is not a regular file`);
		}
		return {
			exists: true,
			content: fsImpl.readFileSync(file, "utf8"),
			mode: stat.mode & 0o777,
		};
	} catch (error) {
		if (error.code === "ENOENT") {
			return { exists: false, content: "", mode: 0o600 };
		}
		throw error;
	}
}

function snapshotStillMatches(file, snapshot, fsImpl) {
	const current = readFileSnapshot(file, fsImpl);
	return (
		current.exists === snapshot.exists && current.content === snapshot.content
	);
}

function atomicWrite(file, content, snapshot, fsImpl) {
	fsImpl.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = path.join(
		path.dirname(file),
		`.${path.basename(file)}.haoshoku-${process.pid}-${++atomicWriteSequence}`,
	);
	try {
		fsImpl.writeFileSync(temporary, content, {
			flag: "wx",
			mode: snapshot.mode,
		});
		if (!snapshotStillMatches(file, snapshot, fsImpl)) {
			throw new Error(`${file} changed while it was being updated`);
		}
		fsImpl.renameSync(temporary, file);
	} finally {
		if (fsImpl.existsSync(temporary)) fsImpl.rmSync(temporary, { force: true });
	}
}

function preferredEol(content) {
	if (/\r(?!\n)/.test(content)) {
		throw new Error("unsupported lone-CR line endings");
	}
	return content.includes("\r\n") ? "\r\n" : "\n";
}

export function setIniValue(content, sectionName, key, value) {
	const eol = preferredEol(content);
	const lines = content.match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? [];
	let currentSection = null;
	let targetSectionCount = 0;
	let targetSectionEnd = lines.length;
	const keyIndexes = [];

	for (const [index, rawLine] of lines.entries()) {
		const text = rawLine.replace(/\r?\n$/, "");
		const section = text.match(/^\[([^\]]+)\]$/);
		if (section) {
			if (currentSection === sectionName && targetSectionEnd === lines.length) {
				targetSectionEnd = index;
			}
			currentSection = section[1];
			if (currentSection === sectionName) {
				targetSectionCount += 1;
			}
			continue;
		}
		if (currentSection === sectionName && text.startsWith(`${key}=`)) {
			keyIndexes.push(index);
		}
	}

	if (targetSectionCount > 1) {
		throw new Error(`duplicate [${sectionName}] sections`);
	}
	if (keyIndexes.length > 1) {
		throw new Error(`duplicate ${key} keys in [${sectionName}]`);
	}
	if (keyIndexes.length === 1) {
		const index = keyIndexes[0];
		const ending = lines[index].match(/\r?\n$/)?.[0] ?? "";
		lines[index] = `${key}=${value}${ending}`;
		return lines.join("");
	}
	if (targetSectionCount === 1) {
		if (targetSectionEnd > 0 && !lines[targetSectionEnd - 1].endsWith("\n")) {
			lines[targetSectionEnd - 1] += eol;
		}
		lines.splice(targetSectionEnd, 0, `${key}=${value}${eol}`);
		return lines.join("");
	}

	let result = content;
	if (result !== "" && !result.endsWith("\n")) result += eol;
	if (result !== "" && !result.endsWith(`${eol}${eol}`)) result += eol;
	return `${result}[${sectionName}]${eol}${key}=${value}${eol}`;
}

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
		const section = rawLine.match(/^\[([^\]]+)\]$/);
		if (section) {
			inGeneral = section[1] === "General";
			continue;
		}
		if (inGeneral && rawLine.startsWith("commands=")) {
			values.push(rawLine.slice("commands=".length));
		}
	}
	if (values.length > 1)
		throw new Error("duplicate commands keys in [General]");
	return values.length === 0 ? {} : decodeCommandsValue(values[0]);
}

function encodeCommandsValue(commands) {
	return JSON.stringify(`@ByteArray(${JSON.stringify(commands)})`);
}

function trustedDeviceIds(content) {
	return [...content.matchAll(/^\[([^\]]+)\]\r?$/gm)]
		.map((match) => match[1])
		.filter((id) => SAFE_DEVICE_ID.test(id));
}

async function reloadDevice(deviceId) {
	try {
		const child = Bun.spawn(
			[
				"gdbus",
				"call",
				"--session",
				"--dest",
				"org.kde.kdeconnect",
				"--object-path",
				`/modules/kdeconnect/devices/${deviceId}`,
				"--method",
				"org.kde.kdeconnect.device.setPluginEnabled",
				"kdeconnect_runcommand",
				"true",
			],
			{ stdout: "ignore", stderr: "ignore" },
		);
		return (await child.exited) === 0;
	} catch {
		return false;
	}
}

/** Merge the Haoshoku remote commands into every currently paired device. */
export async function configureKdeConnectCommands({
	home = homedir(),
	fsImpl = fs,
	logImpl = log,
	reloadDeviceImpl = reloadDevice,
} = {}) {
	const kdeConnectDir = path.join(home, ".config", "kdeconnect");
	const trustedDevicesFile = path.join(kdeConnectDir, "trusted_devices");
	if (!fsImpl.existsSync(trustedDevicesFile)) {
		logImpl.warning(
			"No paired KDE Connect devices found. Pair a phone, then rerun haoshoku --kde-connect-commands.",
		);
		return { configured: [], unchanged: [], failed: [], reloadPending: [] };
	}

	const deviceIds = trustedDeviceIds(
		fsImpl.readFileSync(trustedDevicesFile, "utf8"),
	);
	if (deviceIds.length === 0) {
		logImpl.warning(
			"No paired KDE Connect devices found. Pair a phone, then rerun haoshoku --kde-connect-commands.",
		);
		return { configured: [], unchanged: [], failed: [], reloadPending: [] };
	}

	const result = {
		configured: [],
		unchanged: [],
		failed: [],
		reloadPending: [],
	};
	for (const deviceId of deviceIds) {
		try {
			const deviceDir = path.join(kdeConnectDir, deviceId);
			const commandsFile = path.join(
				deviceDir,
				"kdeconnect_runcommand",
				"config",
			);
			const deviceConfigFile = path.join(deviceDir, "config");
			const commandsSnapshot = readFileSnapshot(commandsFile, fsImpl);
			const deviceSnapshot = readFileSnapshot(deviceConfigFile, fsImpl);
			const commands = parseCommandsConfig(commandsSnapshot.content);
			const existingNamedEntry = Object.entries(commands).find(
				([, entry]) => entry?.name === SCREENS_OFF_COMMAND.name,
			);
			const commandId = existingNamedEntry?.[0] ?? SCREENS_OFF_COMMAND.id;
			if (
				commandId === SCREENS_OFF_COMMAND.id &&
				commands[commandId]?.name !== undefined &&
				commands[commandId]?.name !== SCREENS_OFF_COMMAND.name
			) {
				throw new Error(`command id ${commandId} is already in use`);
			}
			commands[commandId] = {
				name: SCREENS_OFF_COMMAND.name,
				command: SCREENS_OFF_COMMAND.command,
			};
			const nextCommandsConfig = setIniValue(
				commandsSnapshot.content,
				"General",
				"commands",
				encodeCommandsValue(commands),
			);
			const nextDeviceConfig = setIniValue(
				deviceSnapshot.content,
				"Plugins",
				"kdeconnect_runcommandEnabled",
				"true",
			);
			const changed =
				nextCommandsConfig !== commandsSnapshot.content ||
				nextDeviceConfig !== deviceSnapshot.content;
			if (nextCommandsConfig !== commandsSnapshot.content) {
				atomicWrite(commandsFile, nextCommandsConfig, commandsSnapshot, fsImpl);
			}
			if (nextDeviceConfig !== deviceSnapshot.content) {
				atomicWrite(deviceConfigFile, nextDeviceConfig, deviceSnapshot, fsImpl);
			}

			(changed ? result.configured : result.unchanged).push(deviceId);
			const reloaded = await reloadDeviceImpl(deviceId);
			if (changed && !reloaded) {
				result.reloadPending.push(deviceId);
				logImpl.warning(
					`Configured Screens Off for ${deviceId}, but KDE Connect could not be refreshed. It will load after the daemon restarts.`,
				);
			} else if (changed) {
				logImpl.success(`Configured KDE Connect Screens Off for ${deviceId}.`);
			} else {
				logImpl.success(
					`KDE Connect Screens Off is already configured for ${deviceId}.`,
				);
			}
		} catch (error) {
			result.failed.push(deviceId);
			logImpl.warning(
				`KDE Connect command setup failed for ${deviceId} (${error?.message ?? error}); its config was preserved.`,
			);
		}
	}
	return result;
}
