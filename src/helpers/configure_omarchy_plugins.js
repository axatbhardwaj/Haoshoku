import fs from "node:fs";
import path from "node:path";
import { checkOmarchyV4 } from "../common/omarchy_version.js";
import { log } from "../common/utils.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
	PROJECT_ROOT,
	"common",
	"omarchy-plugins.json",
);

async function runOmarchyCommand(argv, { env = process.env } = {}) {
	const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", env });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stdout, stderr };
}

/**
 * Reconcile the plugin manifest in common/omarchy-plugins.json with the
 * plugins already known to `omarchy plugin list --json`.
 *
 * - Missing plugin → `omarchy plugin add <url> --enable --yes` (fully
 *   non-interactive: --enable enables it, --yes accepts the manifest's
 *   default bar placement).
 * - Installed but disabled → enable-only action. Upstream docs don't pin a
 *   subcommand for this, so we use the symmetric
 *   `omarchy plugin enable <id>`; re-running `plugin add` for an
 *   already-installed plugin would be wrong.
 * - Installed and enabled → no action.
 *
 * Per-plugin failures are non-fatal: each is logged and collected in the
 * returned summary. A manual-auth checklist is printed for every manifest
 * plugin that declares one, regardless of install state.
 */
export async function configureOmarchyPlugins({
	manifest,
	manifestPath = DEFAULT_MANIFEST_PATH,
	runCommandImpl = runOmarchyCommand,
	logImpl = log,
	env = process.env,
	versionResult,
} = {}) {
	const gate = await checkOmarchyV4({
		captureCommandImpl: async (_command, options) =>
			await runCommandImpl(["omarchy", "version"], options),
		env,
		logImpl,
		versionResult,
	});
	if (!gate.ok) {
		return {
			status: "refused",
			message: gate.message,
			installed: [],
			enabled: [],
			alreadyReady: [],
			failed: [],
			manualAuthChecklist: [],
		};
	}

	const plugins =
		manifest ?? JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

	let installed = [];
	try {
		const listed = await runCommandImpl([
			"omarchy",
			"plugin",
			"list",
			"--json",
		]);
		if (listed.exitCode === 0) {
			const parsed = JSON.parse(listed.stdout);
			if (!Array.isArray(parsed)) {
				throw new Error(
					`expected a JSON array from plugin list, got ${parsed === null ? "null" : typeof parsed}`,
				);
			}
			installed = parsed;
		} else {
			logImpl.warning(
				`omarchy plugin list failed (exit code ${listed.exitCode}) — treating all manifest plugins as missing.`,
			);
		}
	} catch (err) {
		logImpl.warning(
			`Could not list Omarchy plugins (${err?.message ?? err}) — treating all manifest plugins as missing.`,
		);
	}

	const stateById = new Map(installed.map((plugin) => [plugin.id, plugin]));
	const installedIds = [];
	const enabledIds = [];
	const alreadyReady = [];
	const failed = [];

	for (const plugin of plugins) {
		const state = stateById.get(plugin.id);
		try {
			if (!state) {
				const added = await runCommandImpl([
					"omarchy",
					"plugin",
					"add",
					plugin.url,
					"--enable",
					"--yes",
				]);
				if (added.exitCode === 0) {
					logImpl.success(`Installed Omarchy plugin ${plugin.id}.`);
					installedIds.push(plugin.id);
				} else {
					logImpl.warning(
						`Omarchy plugin ${plugin.id} install failed (exit code ${added.exitCode}) — continuing.`,
					);
					failed.push(plugin.id);
				}
			} else if (!state.enabled) {
				const enabled = await runCommandImpl([
					"omarchy",
					"plugin",
					"enable",
					plugin.id,
				]);
				if (enabled.exitCode === 0) {
					logImpl.success(`Enabled Omarchy plugin ${plugin.id}.`);
					enabledIds.push(plugin.id);
				} else {
					logImpl.warning(
						`Omarchy plugin ${plugin.id} enable failed (exit code ${enabled.exitCode}) — continuing.`,
					);
					failed.push(plugin.id);
				}
			} else {
				alreadyReady.push(plugin.id);
			}
		} catch (err) {
			logImpl.warning(
				`Omarchy plugin ${plugin.id} action failed (${err?.message ?? err}) — continuing.`,
			);
			failed.push(plugin.id);
		}
	}

	const manualAuthChecklist = plugins
		.filter((plugin) => plugin.manualAuth)
		.map((plugin) => ({ id: plugin.id, requirement: plugin.manualAuth }));
	if (manualAuthChecklist.length > 0) {
		logImpl.info("Omarchy plugins needing manual auth:");
		for (const item of manualAuthChecklist) {
			logImpl.info(`  - ${item.id}: ${item.requirement}`);
		}
	}

	return {
		installed: installedIds,
		enabled: enabledIds,
		alreadyReady,
		failed,
		manualAuthChecklist,
	};
}
