import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { checkOmarchyV4 } from "../common/omarchy_version.js";
import { log, safeCopyFile } from "../common/utils.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const DEFAULT_SHELL = {
	version: 1,
	idle: { screensaver: 150, lock: 300 },
	plugins: [],
};
const BUNDLED_TRAY = {
	id: "xzat.tray",
	files: ["Tray.qml", "TrayModel.js", "manifest.json"],
};

function resolvePaths({
	home = homedir(),
	projectRoot = PROJECT_ROOT,
	repoBarPath,
	manifestPath,
	liveShellPath,
	pluginsDir,
	repoPluginsDir,
} = {}) {
	return {
		repoBarPath:
			repoBarPath ?? path.join(projectRoot, "configs", "omarchy", "bar.json"),
		manifestPath:
			manifestPath ?? path.join(projectRoot, "common", "omarchy-plugins.json"),
		liveShellPath:
			liveShellPath ?? path.join(home, ".config", "omarchy", "shell.json"),
		pluginsDir: pluginsDir ?? path.join(home, ".config", "omarchy", "plugins"),
		repoPluginsDir:
			repoPluginsDir ?? path.join(projectRoot, "configs", "omarchy", "plugins"),
	};
}

function thirdPartyIds(bar) {
	if (
		!bar?.layout ||
		typeof bar.layout !== "object" ||
		Array.isArray(bar.layout)
	) {
		throw new Error("configs/omarchy/bar.json must contain a layout object");
	}

	const ids = [];
	for (const entries of Object.values(bar.layout)) {
		if (!Array.isArray(entries)) {
			throw new Error(
				"Every configs/omarchy/bar.json layout section must be an array",
			);
		}
		for (const entry of entries) {
			if (typeof entry?.id !== "string") {
				throw new Error(
					"Every configs/omarchy/bar.json layout entry must have an id",
				);
			}
			if (!entry.id.startsWith("omarchy.")) ids.push(entry.id);
		}
	}
	return [...new Set(ids)];
}

function availableMalformedBackup(fsImpl, liveShellPath, now) {
	const base = `${liveShellPath}.malformed.${now()}`;
	let candidate = base;
	let collision = 0;
	while (fsImpl.existsSync(candidate)) {
		collision += 1;
		candidate = `${base}.${collision}`;
	}
	return candidate;
}

function bundledTrayPaths(repoPluginsDir, pluginsDir) {
	return {
		source: path.join(repoPluginsDir, BUNDLED_TRAY.id),
		destination: path.join(pluginsDir, BUNDLED_TRAY.id),
	};
}

function hasCompleteBundle(fsImpl, directory) {
	return BUNDLED_TRAY.files.every((file) =>
		fsImpl.existsSync(path.join(directory, file)),
	);
}

function syncBundledTray({
	fsImpl,
	safeCopyPluginFileImpl,
	repoPluginsDir,
	pluginsDir,
	now,
}) {
	const { source, destination } = bundledTrayPaths(repoPluginsDir, pluginsDir);
	if (!hasCompleteBundle(fsImpl, source)) {
		throw new Error(
			`bundled ${BUNDLED_TRAY.id} source is incomplete at ${source}`,
		);
	}

	fsImpl.mkdirSync(destination, { recursive: true });
	let changed = false;
	for (const filename of BUNDLED_TRAY.files) {
		changed =
			safeCopyPluginFileImpl(
				path.join(source, filename),
				path.join(destination, filename),
				{
					fsImpl,
					now,
				},
			) || changed;
	}
	return changed;
}

function backupBundledTray({ fsImpl, logImpl, repoPluginsDir, pluginsDir }) {
	const { source, destination } = bundledTrayPaths(repoPluginsDir, pluginsDir);
	if (!hasCompleteBundle(fsImpl, destination)) {
		logImpl.warning(
			`Live bundled Omarchy plugin ${BUNDLED_TRAY.id} is incomplete at ${destination} — repository plugin backup left unchanged.`,
		);
		return false;
	}

	fsImpl.mkdirSync(source, { recursive: true });
	for (const filename of BUNDLED_TRAY.files) {
		fsImpl.copyFileSync(
			path.join(destination, filename),
			path.join(source, filename),
		);
	}
	return true;
}

function manifestUnknownIds(fsImpl, manifestPath, bar, bundledPluginDir) {
	const requiredPluginIds = thirdPartyIds(bar);
	const manifest = JSON.parse(fsImpl.readFileSync(manifestPath, "utf8"));
	if (!Array.isArray(manifest)) {
		throw new Error("common/omarchy-plugins.json must contain an array");
	}
	const manifestIds = new Set(manifest.map(({ id }) => id));
	if (hasCompleteBundle(fsImpl, bundledPluginDir))
		manifestIds.add(BUNDLED_TRAY.id);
	return {
		requiredPluginIds,
		unknownIds: requiredPluginIds.filter((id) => !manifestIds.has(id)),
	};
}

class ConcurrentShellChangeError extends Error {}

export async function configureOmarchyBar({
	fsImpl = fs,
	safeCopyFileImpl = safeCopyFile,
	safeCopyPluginFileImpl = safeCopyFile,
	logImpl = log,
	captureCommandImpl,
	env = process.env,
	versionResult,
	now = Date.now,
	...pathOptions
} = {}) {
	const gate = await checkOmarchyV4({
		captureCommandImpl,
		env,
		logImpl,
		versionResult,
	});
	if (!gate.ok)
		return { status: "refused", message: gate.message, changed: false };

	const {
		repoBarPath,
		manifestPath,
		liveShellPath,
		pluginsDir,
		repoPluginsDir,
	} = resolvePaths(pathOptions);
	if (!fsImpl.existsSync(repoBarPath)) {
		logImpl.warning(`No Omarchy bar source found at ${repoBarPath} — skipping`);
		return { status: "skipped", changed: false };
	}

	let repoBar;
	let requiredPluginIds;
	let unknownIds;
	try {
		repoBar = JSON.parse(fsImpl.readFileSync(repoBarPath, "utf8"));
		({ requiredPluginIds, unknownIds } = manifestUnknownIds(
			fsImpl,
			manifestPath,
			repoBar,
			path.join(repoPluginsDir, BUNDLED_TRAY.id),
		));
	} catch (error) {
		logImpl.warning(
			`Refusing Omarchy bar deployment: invalid bar or plugin manifest (${error instanceof Error ? error.message : String(error)}).`,
		);
		return { status: "refused", changed: false };
	}
	if (unknownIds.length > 0) {
		logImpl.warning(
			`Refusing Omarchy bar deployment: layout ids missing from common/omarchy-plugins.json: ${unknownIds.join(", ")}`,
		);
		return { status: "refused", changed: false, unknownIds };
	}
	let pluginChanged = false;
	if (requiredPluginIds.includes(BUNDLED_TRAY.id)) {
		pluginChanged = syncBundledTray({
			fsImpl,
			safeCopyPluginFileImpl,
			repoPluginsDir,
			pluginsDir,
			now,
		});
	}
	for (const id of requiredPluginIds) {
		if (!fsImpl.existsSync(path.join(pluginsDir, id))) {
			logImpl.warning(
				`Omarchy bar plugin ${id} is not installed; run haoshoku --omarchy-plugins first. The layout entry will remain inert until it is installed.`,
			);
		}
	}

	let live = { ...DEFAULT_SHELL, idle: { ...DEFAULT_SHELL.idle }, plugins: [] };
	let expectedLiveExists = fsImpl.existsSync(liveShellPath);
	let expectedLiveBytes = expectedLiveExists
		? fsImpl.readFileSync(liveShellPath)
		: null;
	if (expectedLiveExists) {
		try {
			live = JSON.parse(expectedLiveBytes.toString("utf8"));
			if (!live || typeof live !== "object" || Array.isArray(live)) {
				throw new Error("the top-level value must be an object");
			}
		} catch (err) {
			const backupPath = availableMalformedBackup(fsImpl, liveShellPath, now);
			fsImpl.renameSync(liveShellPath, backupPath);
			expectedLiveExists = false;
			expectedLiveBytes = null;
			live = { ...DEFAULT_SHELL, idle: { ...DEFAULT_SHELL.idle }, plugins: [] };
			logImpl.warning(
				`Malformed Omarchy shell.json at ${liveShellPath} (${err?.message ?? err}) — moved to ${backupPath}; rewriting from safe defaults.`,
			);
		}
	}

	if (live.version !== 1) {
		logImpl.warning(
			`Refusing Omarchy bar deployment: ${liveShellPath} uses unsupported schema version ${String(live.version)}.`,
		);
		return { status: "refused", changed: false };
	}

	const merged = { ...live, bar: repoBar, version: 1 };
	fsImpl.mkdirSync(path.dirname(liveShellPath), { recursive: true });
	const tempPath = `${liveShellPath}.haoshoku-tmp-${process.pid}-${now()}`;
	let changed;
	const assertLiveUnchanged = () => {
		let currentExists;
		let currentBytes = null;
		try {
			currentExists = fsImpl.existsSync(liveShellPath);
			if (currentExists) currentBytes = fsImpl.readFileSync(liveShellPath);
		} catch {
			throw new ConcurrentShellChangeError();
		}
		if (
			currentExists !== expectedLiveExists ||
			(currentExists && !currentBytes.equals(expectedLiveBytes))
		) {
			throw new ConcurrentShellChangeError();
		}
	};
	try {
		fsImpl.writeFileSync(tempPath, `${JSON.stringify(merged, null, "\t")}\n`);
		changed = safeCopyFileImpl(tempPath, liveShellPath, {
			now,
			atomic: true,
			fsImpl,
			beforeReplace: assertLiveUnchanged,
		});
	} catch (error) {
		if (!(error instanceof ConcurrentShellChangeError)) throw error;
		logImpl.warning(
			`Refusing Omarchy bar deployment: ${liveShellPath} changed while the layout was being prepared; leaving it untouched. Re-run the command to merge the latest state.`,
		);
		return { status: "refused", changed: false };
	} finally {
		fsImpl.rmSync(tempPath, { force: true });
	}

	if (changed) logImpl.success("Omarchy bar deployed to shell.json.");
	return { status: "configured", changed, pluginChanged };
}

export async function backupOmarchyBar({
	fsImpl = fs,
	logImpl = log,
	...pathOptions
} = {}) {
	const {
		repoBarPath,
		manifestPath,
		liveShellPath,
		pluginsDir,
		repoPluginsDir,
	} = resolvePaths(pathOptions);
	if (!fsImpl.existsSync(liveShellPath)) {
		logImpl.warning(
			`No live Omarchy shell.json found at ${liveShellPath} — skipping`,
		);
		return { status: "skipped" };
	}

	let live;
	try {
		live = JSON.parse(fsImpl.readFileSync(liveShellPath, "utf8"));
	} catch (err) {
		logImpl.warning(
			`Could not parse live Omarchy shell.json at ${liveShellPath} (${err?.message ?? err}) — skipping`,
		);
		return { status: "skipped" };
	}
	if (
		!live ||
		typeof live !== "object" ||
		Array.isArray(live) ||
		!live.bar ||
		typeof live.bar !== "object" ||
		Array.isArray(live.bar)
	) {
		logImpl.warning(`No bar object found in ${liveShellPath} — skipping`);
		return { status: "skipped" };
	}
	try {
		const { unknownIds } = manifestUnknownIds(
			fsImpl,
			manifestPath,
			live.bar,
			path.join(pluginsDir, BUNDLED_TRAY.id),
		);
		if (unknownIds.length > 0) {
			logImpl.warning(
				`Captured Omarchy bar ids missing from common/omarchy-plugins.json: ${unknownIds.join(", ")}. Add them to the manifest before deploying this layout.`,
			);
		}
	} catch (error) {
		logImpl.warning(
			`Could not validate the captured Omarchy bar against common/omarchy-plugins.json (${error instanceof Error ? error.message : String(error)}); the capture will continue, but deployment may refuse it.`,
		);
	}

	fsImpl.mkdirSync(path.dirname(repoBarPath), { recursive: true });
	fsImpl.writeFileSync(
		repoBarPath,
		`${JSON.stringify(live.bar, null, "\t")}\n`,
	);
	let pluginBackedUp = false;
	if (thirdPartyIds(live.bar).includes(BUNDLED_TRAY.id)) {
		pluginBackedUp = backupBundledTray({
			fsImpl,
			logImpl,
			repoPluginsDir,
			pluginsDir,
		});
	}
	logImpl.success("Omarchy bar backed up to configs/omarchy/bar.json.");
	return { status: "backed-up", pluginBackedUp };
}
