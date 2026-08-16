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
 *   non-interactive: --enable enables it, --yes accepts the install prompt).
 * - Installed but disabled → enable-only action. Upstream docs don't pin a
 *   subcommand for this, so we use the symmetric
 *   `omarchy plugin enable <id>`; re-running `plugin add` for an
 *   already-installed plugin would be wrong.
 * - Installed and enabled → no action.
 *
 * Haoshoku owns liveness (existence and enablement) and reconciles it every run.
 * `disableOnInstall` fires only when Haoshoku first creates a plugin and is never
 * re-applied, so a user who later re-enables a displaced widget is not overridden.
 * Haoshoku never removes a plugin; to stop installing one, remove it from the
 * manifest.
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
			snapshotUnavailable: false,
			installed: [],
			enabled: [],
			alreadyReady: [],
			failed: [],
			configured: [],
			configureFailed: [],
			manualAuthChecklist: [],
		};
	}

	const plugins =
		manifest ?? JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
	const manualAuthChecklist = plugins
		.filter((plugin) => plugin.manualAuth)
		.map((plugin) => ({ id: plugin.id, requirement: plugin.manualAuth }));
	const printManualAuthChecklist = () => {
		if (manualAuthChecklist.length > 0) {
			logImpl.info("Omarchy plugins needing manual auth:");
			for (const item of manualAuthChecklist) {
				logImpl.info(`  - ${item.id}: ${item.requirement}`);
			}
		}
	};

	let installed = [];
	let listOk = false;
	let snapshotFailureReason = "plugin list did not produce a trustworthy snapshot";
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
			if (
				parsed.some(
					(plugin) =>
						typeof plugin?.id === "string" && plugin.id.startsWith("omarchy."),
				)
			) {
				listOk = true;
			} else {
				snapshotFailureReason =
					"plugin list contained no first-party plugin id; the Omarchy shell scan may not be ready";
			}
		} else {
			snapshotFailureReason = `plugin list failed with exit code ${listed.exitCode}`;
		}
	} catch (err) {
		snapshotFailureReason = `plugin list returned untrustworthy data: ${err?.message ?? err}`;
	}

	if (!listOk) {
		logImpl.warning(
			`SKIPPING ALL OMARCHY PLUGIN WORK: ${snapshotFailureReason}. No plugin add, enable, or disable actions were attempted.`,
		);
		printManualAuthChecklist();
		return {
			snapshotUnavailable: true,
			installed: [],
			enabled: [],
			alreadyReady: [],
			failed: [],
			configured: [],
			configureFailed: [],
			manualAuthChecklist,
		};
	}

	const stateById = new Map(installed.map((plugin) => [plugin.id, plugin]));
	const installedIds = [];
	const enabledIds = [];
	const alreadyReady = [];
	const failed = [];
	const configured = [];
	const configureFailed = [];

	for (const plugin of plugins) {
		const state = stateById.get(plugin.id);
		try {
			if (!state) {
				let added;
				try {
					added = await runCommandImpl([
						"omarchy",
						"plugin",
						"add",
						plugin.url,
						"--enable",
						"--yes",
					]);
				} catch (err) {
					logImpl.warning(
						`Omarchy plugin ${plugin.id} install failed (${err?.message ?? err}) — continuing.`,
					);
					failed.push(plugin.id);
					continue;
				}
				if (added.exitCode === 0) {
					logImpl.success(`Installed Omarchy plugin ${plugin.id}.`);
					installedIds.push(plugin.id);
					let disableFailed = false;
					for (const targetId of plugin.disableOnInstall ?? []) {
						const targetState = stateById.get(targetId);
						if (!targetState?.enabled) continue;
						try {
							const disabled = await runCommandImpl([
								"omarchy",
								"plugin",
								"disable",
								targetId,
							]);
							if (disabled.exitCode !== 0) {
								disableFailed = true;
								configureFailed.push({
									id: plugin.id,
									action: "disable",
									targetId,
								});
								logImpl.warning(
									`Omarchy plugin ${plugin.id} disableOnInstall action failed for ${targetId} — keeping the installed plugin.`,
								);
							}
						} catch {
							disableFailed = true;
							configureFailed.push({
								id: plugin.id,
								action: "disable",
								targetId,
							});
							logImpl.warning(
								`Omarchy plugin ${plugin.id} disableOnInstall action failed for ${targetId} — keeping the installed plugin.`,
							);
						}
					}
					if (plugin.disableOnInstall !== undefined && !disableFailed) {
						configured.push(plugin.id);
					}
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

	printManualAuthChecklist();

	return {
		snapshotUnavailable: false,
		installed: installedIds,
		enabled: enabledIds,
		alreadyReady,
		failed,
		configured,
		configureFailed,
		manualAuthChecklist,
	};
}
