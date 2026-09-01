import fs from "node:fs";
import path from "node:path";
import { checkOmarchyV4 } from "../common/omarchy_version.js";
import { log } from "../common/utils.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
	PROJECT_ROOT,
	"configs",
	"omarchy",
	"appearance.json",
);
const THEME_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const BACKGROUND_PATTERN = /^[^/\\\n]+\.(?:jpe?g|png|webp)$/i;

async function runCaptured(argv, { cwd, env = process.env } = {}) {
	const child = Bun.spawn(argv, {
		cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stdout, stderr };
}

function validateManifest(manifest) {
	if (manifest?.schemaVersion !== 1) return "schemaVersion must be 1";
	if (!THEME_NAME_PATTERN.test(manifest?.theme?.name ?? "")) {
		return "theme.name must be a safe lowercase slug";
	}
	let repository;
	try {
		repository = new URL(manifest?.theme?.repository);
	} catch {
		return "theme.repository must be a valid HTTPS URL";
	}
	if (repository.protocol !== "https:") {
		return "theme.repository must be a valid HTTPS URL";
	}
	if (!REVISION_PATTERN.test(manifest?.theme?.revision ?? "")) {
		return "theme.revision must be a full 40-character Git commit";
	}
	const legacyRevisions = manifest?.theme?.legacyRevisions ?? [];
	if (
		!Array.isArray(legacyRevisions) ||
		legacyRevisions.some((revision) => !REVISION_PATTERN.test(revision))
	) {
		return "theme.legacyRevisions must contain only full Git commits";
	}
	if (!BACKGROUND_PATTERN.test(manifest?.background ?? "")) {
		return "background must be an image filename within the theme";
	}
	if (
		typeof manifest?.font !== "string" ||
		manifest.font.trim() !== manifest.font ||
		manifest.font.length === 0 ||
		manifest.font.includes("\n")
	) {
		return "font must be a non-empty single-line family name";
	}
	return null;
}

function normalizedRepository(value) {
	return value
		.trim()
		.replace(/\/+$/, "")
		.replace(/\.git$/, "");
}

function isLocalRepository(value) {
	const repository = value.trim();
	return (
		repository.startsWith("file://") ||
		repository.startsWith("~/") ||
		path.isAbsolute(repository) ||
		repository.startsWith("./") ||
		repository.startsWith("../")
	);
}

async function commandOk(runCommandImpl, argv, options = {}) {
	try {
		return await runCommandImpl(argv, options);
	} catch (error) {
		return {
			exitCode: 127,
			stdout: "",
			stderr: error?.message ?? String(error),
		};
	}
}

/**
 * Reconcile the portable Omarchy appearance manifest. Clean matching checkouts
 * advance to the pinned revision; matching checkouts with local edits are
 * preserved. Explicitly recognized legacy local clones are backed up and
 * replaced transactionally.
 */
export async function configureOmarchyAppearance({
	manifest,
	manifestPath = DEFAULT_MANIFEST_PATH,
	home = process.env.HOME,
	runCommandImpl = runCaptured,
	logImpl = log,
	env = process.env,
	versionResult,
	nowImpl = Date.now,
	renameImpl = fs.renameSync,
} = {}) {
	let appearance;
	try {
		appearance = manifest ?? JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (error) {
		logImpl.warning(
			`Omarchy appearance manifest could not be read: ${error.message}`,
		);
		return { status: "invalid-manifest", installed: false };
	}
	const validationError = validateManifest(appearance);
	if (validationError) {
		logImpl.warning(`Invalid Omarchy appearance manifest: ${validationError}.`);
		return { status: "invalid-manifest", installed: false };
	}

	const gate = await checkOmarchyV4({
		captureCommandImpl: async (_command, options) =>
			await runCommandImpl(["omarchy", "version"], options),
		env,
		logImpl,
		versionResult,
	});
	if (!gate.ok) return { status: "refused", installed: false };

	const { name, repository, revision, legacyRevisions = [] } = appearance.theme;
	const commandEnv = { ...env, HOME: home };
	const themesPath = path.join(home, ".config", "omarchy", "themes");
	const themePath = path.join(themesPath, name);
	let installed = false;
	let preservedLocalChanges = false;
	let legacyBackupPath;
	let installPinnedTheme = !fs.existsSync(themePath);
	let replaceLegacyTheme = false;

	if (fs.existsSync(themePath)) {
		const remote = await commandOk(
			runCommandImpl,
			["git", "remote", "get-url", "origin"],
			{ cwd: themePath, env: commandEnv },
		);
		if (
			remote.exitCode !== 0 ||
			normalizedRepository(remote.stdout) !== normalizedRepository(repository)
		) {
			if (remote.exitCode !== 0 || !isLocalRepository(remote.stdout)) {
				logImpl.warning(
					`Preserving ${themePath}: it is not the managed ${name} theme checkout.`,
				);
				return { status: "conflict", installed: false, themePath };
			}
			const head = await commandOk(
				runCommandImpl,
				["git", "rev-parse", "HEAD"],
				{ cwd: themePath, env: commandEnv },
			);
			const topLevel = await commandOk(
				runCommandImpl,
				["git", "rev-parse", "--show-toplevel"],
				{ cwd: themePath, env: commandEnv },
			);
			if (
				head.exitCode !== 0 ||
				!legacyRevisions.includes(head.stdout.trim()) ||
				topLevel.exitCode !== 0 ||
				path.resolve(topLevel.stdout.trim()) !== path.resolve(themePath)
			) {
				logImpl.warning(
					`Preserving ${themePath}: it is not the managed ${name} theme checkout.`,
				);
				return { status: "conflict", installed: false, themePath };
			}

			replaceLegacyTheme = true;
			installPinnedTheme = true;
		} else {
			const status = await commandOk(
				runCommandImpl,
				["git", "status", "--porcelain"],
				{ cwd: themePath, env: commandEnv },
			);
			if (status.exitCode !== 0) {
				logImpl.warning(
					`Could not inspect ${name}; preserving it without applying.`,
				);
				return { status: "conflict", installed: false, themePath };
			}
			if (status.stdout.trim()) {
				preservedLocalChanges = true;
				logImpl.warning(
					`Preserving local changes in the ${name} theme; applying the current checkout.`,
				);
			} else {
				const fetched = await commandOk(
					runCommandImpl,
					["git", "fetch", "--prune", "origin"],
					{ cwd: themePath, env: commandEnv },
				);
				const checkedOut =
					fetched.exitCode === 0
						? await commandOk(
								runCommandImpl,
								["git", "checkout", "--detach", revision],
								{ cwd: themePath, env: commandEnv },
							)
						: fetched;
				if (checkedOut.exitCode !== 0) {
					logImpl.warning(
						`Could not update ${name} to ${revision}; preserving the existing checkout.`,
					);
					return { status: "update-failed", installed: false, themePath };
				}
			}
		}
	}

	if (installPinnedTheme) {
		fs.mkdirSync(themesPath, { recursive: true });
		let stagingPath;
		try {
			stagingPath = fs.mkdtempSync(path.join(themesPath, `.haoshoku-${name}-`));
			const cloned = await commandOk(
				runCommandImpl,
				["git", "clone", repository, stagingPath],
				{ env: commandEnv },
			);
			const checkedOut =
				cloned.exitCode === 0
					? await commandOk(
							runCommandImpl,
							["git", "checkout", "--detach", revision],
							{ cwd: stagingPath, env: commandEnv },
						)
					: cloned;
			if (checkedOut.exitCode !== 0) {
				logImpl.warning(
					`Could not install the ${name} theme; no theme was changed.`,
				);
				return { status: "install-failed", installed: false, themePath };
			}

			const stagedBackgroundPath = path.join(
				stagingPath,
				"backgrounds",
				appearance.background,
			);
			if (!fs.existsSync(stagedBackgroundPath)) {
				logImpl.warning(`Theme background is missing: ${stagedBackgroundPath}`);
				return { status: "background-missing", installed: false, themePath };
			}

			if (replaceLegacyTheme) {
				const backupPrefix = `${themePath}.haoshoku-backup-${nowImpl()}`;
				legacyBackupPath = backupPrefix;
				for (let suffix = 1; fs.existsSync(legacyBackupPath); suffix += 1) {
					legacyBackupPath = `${backupPrefix}.${suffix}`;
				}
				renameImpl(themePath, legacyBackupPath);
				logImpl.warning(
					`Backed up the recognized legacy ${name} checkout to ${legacyBackupPath}.`,
				);
			}

			try {
				renameImpl(stagingPath, themePath);
			} catch (error) {
				if (legacyBackupPath && !fs.existsSync(themePath)) {
					renameImpl(legacyBackupPath, themePath);
					legacyBackupPath = undefined;
				}
				logImpl.warning(
					`Could not activate the installed ${name} theme: ${error.message}`,
				);
				return {
					status: "install-failed",
					installed: false,
					themePath,
					legacyBackupPath,
				};
			}
			installed = true;
		} finally {
			if (stagingPath && fs.existsSync(stagingPath)) {
				fs.rmSync(stagingPath, { recursive: true, force: true });
			}
		}
	}

	const backgroundPath = path.join(
		themePath,
		"backgrounds",
		appearance.background,
	);
	if (!fs.existsSync(backgroundPath)) {
		logImpl.warning(`Theme background is missing: ${backgroundPath}`);
		return { status: "background-missing", installed, themePath };
	}

	const themeHyprlandTpl = path.join(themePath, "themed", "hyprland.lua.tpl");
	if (fs.existsSync(themeHyprlandTpl)) {
		const userThemedDir = path.join(home, ".config", "omarchy", "themed");
		fs.mkdirSync(userThemedDir, { recursive: true });
		fs.copyFileSync(
			themeHyprlandTpl,
			path.join(userThemedDir, "hyprland.lua.tpl"),
		);
	}

	const commands = [
		["omarchy", "theme", "set", name],
		["omarchy", "theme", "bg", "set", backgroundPath],
		["omarchy", "font", "set", appearance.font],
	];
	for (const argv of commands) {
		const result = await commandOk(runCommandImpl, argv, { env: commandEnv });
		if (result.exitCode !== 0) {
			logImpl.warning(`Appearance command failed: ${argv.join(" ")}`);
			return {
				status: "apply-failed",
				installed,
				preservedLocalChanges,
				themePath,
			};
		}
	}
	logImpl.success(`Applied Omarchy theme ${name}, background, and font.`);
	return {
		status: "configured",
		installed,
		preservedLocalChanges,
		themePath,
		legacyBackupPath,
	};
}
