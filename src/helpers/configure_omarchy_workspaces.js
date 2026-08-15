import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readDeviceType } from "../common/utils.js";

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

/**
 * Deploy the device-specific Omarchy v4 workspace overlay to its stable Lua
 * module name. Unknown device types fall back to `pc` through readDeviceType.
 */
export async function configureOmarchyWorkspaces({
	home = homedir(),
	projectRoot = ROOT,
	fsImpl = fs,
	now = Date.now,
} = {}) {
	const deviceType = readDeviceType(home);
	const sourceDirectory = path.join(
		projectRoot,
		"configs",
		"omarchy",
		"haoshoku",
	);
	const hyprDirectory = path.join(home, ".config", "hypr");
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

	const main = path.join(hyprDirectory, "hyprland.lua");
	const mainText = fsImpl.existsSync(main)
		? fsImpl.readFileSync(main, "utf8")
		: "";
	const requires = reconcileRequires(mainText);
	if (requires.changed) {
		if (fsImpl.existsSync(main))
			writeAtomically(
				fsImpl,
				backupDestination(fsImpl, main, now),
				fsImpl.readFileSync(main),
			);
		writeAtomically(fsImpl, main, requires.text);
	}

	return { bindingsChanged, overlayChanged, scriptChanged, sourceChanged: requires.changed };
}
