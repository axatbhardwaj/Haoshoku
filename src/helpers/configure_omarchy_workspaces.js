import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { checkOmarchyV4 } from "../common/omarchy_version.js";
import {
	log,
	readDeviceType,
	runCommand,
	runCommandCapture,
} from "../common/utils.js";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const BINDINGS_REQUIRE = 'require("hypr.haoshoku.bindings")';
const WORKSPACES_REQUIRE = 'require("hypr.haoshoku.workspaces")';

function writeAtomically(fsImpl, destination, contents) {
	const temporary = path.join(
		path.dirname(destination),
		`.${path.basename(destination)}.tmp.${process.pid}`,
	);
	fsImpl.writeFileSync(temporary, contents);
	fsImpl.renameSync(temporary, destination);
}

function backupDestination(fsImpl, destination, now) {
	const base = `${destination}.bak.${now()}`;
	let candidate = base;
	let collision = 1;
	while (fsImpl.existsSync(candidate)) {
		candidate = `${base}.${collision}`;
		collision += 1;
	}
	return candidate;
}

function deployFile(fsImpl, source, destination, now) {
	const desired = fsImpl.readFileSync(source);
	if (
		fsImpl.existsSync(destination) &&
		fsImpl.readFileSync(destination).equals(desired)
	)
		return false;

	fsImpl.mkdirSync(path.dirname(destination), { recursive: true });
	if (fsImpl.existsSync(destination)) {
		writeAtomically(
			fsImpl,
			backupDestination(fsImpl, destination, now),
			fsImpl.readFileSync(destination),
		);
	}
	writeAtomically(fsImpl, destination, desired);
	return true;
}

function reconcileRequires(mainText) {
	const lines = mainText.split(/\r\n|\n|\r/);
	const bindingOccurrences = lines.filter(
		(line) => line === BINDINGS_REQUIRE,
	).length;
	const workspaceOccurrences = lines.filter(
		(line) => line === WORKSPACES_REQUIRE,
	).length;
	if (
		bindingOccurrences === 1 &&
		workspaceOccurrences === 1 &&
		lines.indexOf(BINDINGS_REQUIRE) < lines.indexOf(WORKSPACES_REQUIRE)
	)
		return { changed: false, text: mainText };

	const newline = mainText.includes("\r\n") ? "\r\n" : "\n";
	const unrelated = lines.filter(
		(line) => line !== BINDINGS_REQUIRE && line !== WORKSPACES_REQUIRE,
	);
	let text = unrelated.join(newline);
	if (text && !text.endsWith(newline)) text += newline;
	return {
		changed: true,
		text: `${text}${BINDINGS_REQUIRE}${newline}${WORKSPACES_REQUIRE}${newline}`,
	};
}

function shellEscape(value) {
	return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/**
 * Deploy the device-specific Omarchy v4 workspace overlay to its stable Lua
 * module name. Unknown device types fall back to `pc` through readDeviceType.
 */
export async function configureOmarchyWorkspaces({
	home = homedir(),
	projectRoot = ROOT,
	fsImpl = fs,
	now = Date.now,
	env = process.env,
	captureCommandImpl = runCommandCapture,
	runCommandImpl = runCommand,
	logImpl = log,
	versionResult,
} = {}) {
	const gate = await checkOmarchyV4({
		captureCommandImpl,
		env,
		logImpl,
		versionResult,
	});
	if (!gate.ok) {
		return {
			status: "refused",
			message: gate.message,
			bindingsChanged: false,
			overlayChanged: false,
			scriptChanged: false,
			sourceChanged: false,
			reloaded: false,
			replayed: false,
		};
	}

	const hyprDirectory = path.join(home, ".config", "hypr");
	const main = path.join(hyprDirectory, "hyprland.lua");
	if (!fsImpl.existsSync(main)) {
		const message = `Workspace deployment refused: Omarchy v4 Hyprland config not found at ${main}.`;
		logImpl.warning(message);
		return {
			status: "refused",
			message,
			bindingsChanged: false,
			overlayChanged: false,
			scriptChanged: false,
			sourceChanged: false,
			reloaded: false,
			replayed: false,
		};
	}

	const deviceType = readDeviceType(home);
	const sourceDirectory = path.join(
		projectRoot,
		"configs",
		"omarchy",
		"haoshoku",
	);
	const overlayDirectory = path.join(hyprDirectory, "haoshoku");
	const bindingsDestination = path.join(overlayDirectory, "bindings.lua");
	const workspacesDestination = path.join(overlayDirectory, "workspaces.lua");
	const scriptDestination = path.join(
		home,
		".local",
		"bin",
		"haoshoku-special-workspace",
	);

	const bindingsChanged = deployFile(
		fsImpl,
		path.join(sourceDirectory, "bindings.lua"),
		bindingsDestination,
		now,
	);
	const overlayChanged = deployFile(
		fsImpl,
		path.join(sourceDirectory, `workspaces-${deviceType}.lua`),
		workspacesDestination,
		now,
	);

	const scriptChanged = deployFile(
		fsImpl,
		path.join(projectRoot, "configs", "scripts", "haoshoku-special-workspace"),
		scriptDestination,
		now,
	);
	if (scriptChanged || (fsImpl.statSync(scriptDestination).mode & 0o111) !== 0o111)
		fsImpl.chmodSync(scriptDestination, 0o755);

	const mainText = fsImpl.readFileSync(main, "utf8");
	const requires = reconcileRequires(mainText);
	if (requires.changed) {
		writeAtomically(
			fsImpl,
			backupDestination(fsImpl, main, now),
			fsImpl.readFileSync(main),
		);
		writeAtomically(fsImpl, main, requires.text);
	}

	let reloaded = false;
	let replayed = false;
	if (env.HYPRLAND_INSTANCE_SIGNATURE) {
		reloaded = Boolean(await runCommandImpl("hyprctl reload"));
		replayed = Boolean(
			await runCommandImpl(
				`${shellEscape(scriptDestination)} numbered-login 7 kitty`,
			),
		);
	} else {
		logImpl.info(
			"Hyprland is not active; workspace reload and exec-once replay are deferred to login.",
		);
	}

	return {
		bindingsChanged,
		overlayChanged,
		scriptChanged,
		sourceChanged: requires.changed,
		reloaded,
		replayed,
	};
}
