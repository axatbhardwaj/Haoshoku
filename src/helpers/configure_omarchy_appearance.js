import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { PROJECT_ROOT } from "../common/paths.js";
import { checkOmarchyV4 } from "../common/omarchy_version.js";
import { log } from "../common/utils.js";

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

const OBSIDIAN_DEFAULTS = {
	variant: "obsidian-glass",
	palette: { tint: "#080a0b", accent: "#86edb0" },
	glass: { t3Opacity: 0.92 },
};

function hasOnlyKeys(value, keys) {
	return (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).every((key) => keys.includes(key))
	);
}

function luminance(hex) {
	return hex
		.slice(1)
		.match(/../g)
		.map((part) => {
			const channel = Number.parseInt(part, 16) / 255;
			return channel <= 0.04045
				? channel / 12.92
				: ((channel + 0.055) / 1.055) ** 2.4;
		})
		.reduce(
			(sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index],
			0,
		);
}

function validateStyle(style) {
	if (
		!hasOnlyKeys(style, ["variant", "palette", "glass"]) ||
		style.variant !== "obsidian-glass"
	) {
		return "style must select obsidian-glass with only palette and glass settings";
	}
	if (
		style.palette !== undefined &&
		!hasOnlyKeys(style.palette, ["tint", "accent"])
	) {
		return "style.palette supports only tint and accent";
	}
	if (style.glass !== undefined && !hasOnlyKeys(style.glass, ["t3Opacity"])) {
		return "style.glass supports only t3Opacity";
	}
	const { tint, accent } = { ...OBSIDIAN_DEFAULTS.palette, ...style.palette };
	if (
		![tint, accent].every(
			(color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color),
		)
	) {
		return "style colors must be six-digit hex RGB values";
	}
	if (
		tint
			.slice(1)
			.match(/../g)
			.some((part) => Number.parseInt(part, 16) > 48)
	) {
		return "style.palette.tint channels must be at most 48 for readable dark glass";
	}
	if (
		(luminance(accent) + 0.05) /
			(luminance(mixColor(tint, accent, 0.13)) + 0.05) <
		4.5
	) {
		return "style.palette.accent must contrast with the selected surface by at least 4.5:1";
	}
	const opacity = Object.hasOwn(style.glass ?? {}, "t3Opacity")
		? style.glass.t3Opacity
		: OBSIDIAN_DEFAULTS.glass.t3Opacity;
	if (
		typeof opacity !== "number" ||
		!Number.isFinite(opacity) ||
		opacity < 0.9 ||
		opacity > 1
	) {
		return "style.glass.t3Opacity must be a number from 0.90 to 1";
	}
	return null;
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
	return Object.hasOwn(manifest, "style")
		? validateStyle(manifest.style)
		: null;
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

const GLASS_MARKER = ".haoshoku-obsidian.json";
const GLASS_FILES = ["colors.toml", "t3code.json", "hyprland.lua.tpl"];
const digest = (text) => createHash("sha256").update(text).digest("hex");

function readRegularFile(file) {
	if (!fs.lstatSync(file).isFile())
		throw new Error(`Not a regular file: ${file}`);
	return fs.readFileSync(file, "utf8");
}

function readGlassState(derivedPath, templatePath, source) {
	if (!fs.lstatSync(derivedPath, { throwIfNoEntry: false })) return null;
	if (!fs.lstatSync(derivedPath).isDirectory())
		throw new Error("Derived theme is not an owned directory");
	const state = JSON.parse(
		readRegularFile(path.join(derivedPath, GLASS_MARKER)),
	);
	if (
		state.owner !== "haoshoku-obsidian-v1" ||
		state.source !== source ||
		typeof state.active !== "boolean" ||
		!(
			state.priorTemplate === null || typeof state.priorTemplate === "string"
		) ||
		fs.readdirSync(derivedPath).sort().join() !==
			[...GLASS_FILES, GLASS_MARKER].sort().join() ||
		GLASS_FILES.some(
			(file) =>
				digest(readRegularFile(path.join(derivedPath, file))) !==
				state.hashes?.[file],
		)
	) {
		throw new Error(
			"Derived theme contains unowned or edited files; preserving it",
		);
	}
	if (
		state.active &&
		digest(readRegularFile(templatePath)) !== state.hashes["hyprland.lua.tpl"]
	) {
		throw new Error("Hyprland template changed since apply; preserving it");
	}
	return state;
}

function mixColor(start, end, fraction) {
	return (
		"#" +
		[1, 3, 5]
			.map((index) =>
				Math.round(
					Number.parseInt(start.slice(index, index + 2), 16) * (1 - fraction) +
						Number.parseInt(end.slice(index, index + 2), 16) * fraction,
				)
					.toString(16)
					.padStart(2, "0"),
			)
			.join("")
	);
}

function glassFiles(themePath, style) {
	const { tint, accent } = { ...OBSIDIAN_DEFAULTS.palette, ...style.palette };
	const opacity = style.glass?.t3Opacity ?? OBSIDIAN_DEFAULTS.glass.t3Opacity;
	const colors = Bun.TOML.parse(
		readRegularFile(path.join(themePath, "colors.toml")),
	);
	const t3 = JSON.parse(readRegularFile(path.join(themePath, "t3code.json")));
	const template = readRegularFile(
		path.join(themePath, "themed/hyprland.lua.tpl"),
	);
	if (
		!colors.background ||
		!colors.accent ||
		t3.version !== 1 ||
		!t3.colors ||
		typeof t3.colors !== "object" ||
		Array.isArray(t3.colors)
	) {
		throw new Error(
			"Source theme lacks a supported palette, T3 theme or Hyprland template",
		);
	}
	const surface = mixColor(tint, "#ffffff", 0.04);
	const dark = mixColor(tint, "#000000", 0.3);
	const selected = mixColor(tint, accent, 0.13);
	Object.assign(colors, {
		accent,
		selection: accent,
		selection_foreground: tint,
		background: tint,
		dark_background: dark,
		darker_background: mixColor(tint, "#000000", 0.5),
		lighter_background: surface,
		foreground: "#f2f6f3",
		muted: "#b6c5bd",
		dark_foreground: "#56615b",
		light_foreground: "#f2f6f3",
		bright_foreground: "#ffffff",
		hyprland_active_border: `rgba(${accent.slice(1)}ee)`,
		hyprland_inactive_border: "rgba(56615b99)",
	});
	Object.assign(t3, { name: "Obsidian Glass", canvas: tint, accent });
	for (const [value, keys] of [
		[
			tint,
			"canvas chrome toolbar codeBackground terminalBackground accentForeground messageActionForeground",
		],
		[dark, "sidebar surfaceOverlay"],
		[
			surface,
			"toolbarControl toolbarControlHover surface surfaceRaised secondary muted messageSurface sidebarControlSurface sidebarRowHover",
		],
		[
			selected,
			"accentSurface sidebarRowActive sidebarRowSelected terminalSelection",
		],
		[
			"#f2f6f3",
			"text toolbarForeground toolbarControlForeground secondaryForeground messageForeground codeForeground sidebarForeground terminalForeground",
		],
		[
			"#b6c5bd",
			"textMuted mutedForeground placeholder secondaryLabel iconMuted sidebarMutedForeground",
		],
		[
			"#39433e",
			"border toolbarBorder input sidebarBorder terminalScrollbar terminalScrollbarHover",
		],
		[
			accent,
			"accent focus accentSurfaceForeground messageAction messageActionHover terminalCursor",
		],
	])
		for (const key of keys.split(" ")) t3.colors[key] = value;
	return {
		"colors.toml": `${Object.entries(colors)
			.map(([key, value]) => {
				if (!/^[a-z_]+$/.test(key) || typeof value !== "string")
					throw new Error("Unsupported source palette entry");
				return `${key} = ${JSON.stringify(value)}`;
			})
			.join("\n")}\n`,
		"t3code.json": `${JSON.stringify(t3, null, 2)}\n`,
		"hyprland.lua.tpl":
			template +
			`\n-- Whole-window fallback: opacity also affects T3 text.\no.window("^com\\\\.t3tools\\\\.T3Code$", { opacity = "${opacity} override ${opacity} override" })\n`,
	};
}

// Omarchy replaces current/theme on apply; keep any selected media there alive.
function planWallpaper(home, fallback) {
	const current = path.join(home, ".local/state/omarchy/current");
	const link = path.join(current, "background");
	if (!fs.existsSync(link)) return { file: fallback };
	const file = fs.realpathSync(link);
	const relative = path.relative(path.join(current, "theme"), file);
	if (relative.startsWith("..") || path.isAbsolute(relative)) return { file };
	const contents = fs.readFileSync(file);
	const directory = path.join(
		home,
		".config/omarchy/backgrounds/haoshoku-preserved",
	);
	const existingDirectory = fs.lstatSync(directory, { throwIfNoEntry: false });
	if (existingDirectory && !existingDirectory.isDirectory())
		throw new Error("Wallpaper backup directory is not a directory");
	const saved = path.join(
		directory,
		`${digest(contents)}${path.extname(file)}`,
	);
	if (fs.lstatSync(saved, { throwIfNoEntry: false })) {
		if (
			!fs.lstatSync(saved).isFile() ||
			!fs.readFileSync(saved).equals(contents)
		)
			throw new Error("Wallpaper backup collision; preserving it");
		return { file: saved };
	}
	return { file: saved, contents };
}

function writeTemplate(templatePath, contents) {
	if (contents === null) {
		fs.unlinkSync(templatePath);
		return;
	}
	if (fs.existsSync(templatePath) && readRegularFile(templatePath) === contents)
		return;
	fs.mkdirSync(path.dirname(templatePath), { recursive: true });
	const temporary = fs.mkdtempSync(
		path.join(path.dirname(templatePath), ".haoshoku-glass-"),
	);
	try {
		fs.writeFileSync(path.join(temporary, "template"), contents);
		fs.renameSync(path.join(temporary, "template"), templatePath);
	} finally {
		fs.rmSync(temporary, { recursive: true });
	}
}

function materializeGlass({
	themePath,
	derivedPath,
	templatePath,
	style,
	state,
	nowImpl,
	renameImpl,
}) {
	const files = glassFiles(themePath, style);
	const priorTemplate = state?.active
		? state.priorTemplate
		: fs.lstatSync(templatePath, { throwIfNoEntry: false })
			? readRegularFile(templatePath)
			: null;
	const nextState = {
		owner: "haoshoku-obsidian-v1",
		source: themePath,
		active: true,
		priorTemplate,
		hashes: Object.fromEntries(
			Object.entries(files).map(([file, contents]) => [file, digest(contents)]),
		),
	};
	if (JSON.stringify(state) !== JSON.stringify(nextState)) {
		const staging = fs.mkdtempSync(
			path.join(path.dirname(derivedPath), ".haoshoku-obsidian-"),
		);
		let backup;
		try {
			for (const [file, contents] of Object.entries(files))
				fs.writeFileSync(path.join(staging, file), contents);
			fs.writeFileSync(
				path.join(staging, GLASS_MARKER),
				`${JSON.stringify(nextState, null, 2)}\n`,
			);
			if (state) {
				const prefix = `${derivedPath}.haoshoku-backup-${nowImpl()}`;
				backup = prefix;
				for (let n = 1; fs.existsSync(backup); n++) backup = `${prefix}.${n}`;
				renameImpl(derivedPath, backup);
			}
			try {
				renameImpl(staging, derivedPath);
			} catch (error) {
				if (backup) renameImpl(backup, derivedPath);
				throw error;
			}
			try {
				writeTemplate(templatePath, files["hyprland.lua.tpl"]);
			} catch (error) {
				renameImpl(derivedPath, staging);
				if (backup) renameImpl(backup, derivedPath);
				throw error;
			}
		} finally {
			if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
		}
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
	const derivedPath = `${themePath}-obsidian-glass`;
	const templatePath = path.join(
		home,
		".config/omarchy/themed/hyprland.lua.tpl",
	);
	let glassState;
	try {
		if (
			appearance.style ||
			fs.existsSync(path.join(derivedPath, GLASS_MARKER))
		) {
			glassState = readGlassState(derivedPath, templatePath, themePath);
		}
	} catch (error) {
		logImpl.warning(`Preserving Obsidian Glass state: ${error.message}`);
		return { status: "conflict", installed: false, themePath };
	}
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

			if (appearance.style)
				return { status: "conflict", installed: false, themePath };
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
			if (appearance.style) {
				const head = await commandOk(
					runCommandImpl,
					["git", "rev-parse", "HEAD"],
					{ cwd: themePath, env: commandEnv },
				);
				if (
					status.stdout.trim() ||
					head.exitCode !== 0 ||
					head.stdout.trim() !== revision
				) {
					logImpl.warning(
						"Obsidian Glass requires a clean source theme at its pinned revision; no source changes were made.",
					);
					return { status: "conflict", installed: false, themePath };
				}
			} else if (status.stdout.trim()) {
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

	let appliedTheme = name;
	const restoringGlass = glassState?.active && !appearance.style;
	const preserveWallpaper = Boolean(appearance.style || glassState);
	let wallpaper = { file: backgroundPath };

	try {
		// Git probes may yield to other configuration writers; verify ownership again.
		if (appearance.style || glassState) {
			const confirmedState = readGlassState(
				derivedPath,
				templatePath,
				themePath,
			);
			if (
				JSON.stringify(confirmedState) !== JSON.stringify(glassState ?? null)
			) {
				throw new Error("Obsidian Glass ownership changed during preflight");
			}
		}
		if (preserveWallpaper) {
			commandEnv.OMARCHY_THEME_SKIP_BACKGROUND = "1";
			wallpaper = planWallpaper(home, backgroundPath);
		}
		if (appearance.style) {
			materializeGlass({
				themePath,
				derivedPath,
				templatePath,
				style: appearance.style,
				state: glassState,
				nowImpl,
				renameImpl,
			});
			appliedTheme = path.basename(derivedPath);
		} else if (restoringGlass) {
			writeTemplate(templatePath, glassState.priorTemplate);
			try {
				writeTemplate(
					path.join(derivedPath, GLASS_MARKER),
					`${JSON.stringify({ ...glassState, active: false }, null, 2)}\n`,
				);
			} catch (error) {
				writeTemplate(
					templatePath,
					readRegularFile(path.join(derivedPath, "hyprland.lua.tpl")),
				);
				throw error;
			}
		} else if (!glassState) {
			const themeHyprlandTpl = path.join(themePath, "themed/hyprland.lua.tpl");
			if (fs.existsSync(themeHyprlandTpl))
				writeTemplate(templatePath, readRegularFile(themeHyprlandTpl));
		}
	} catch (error) {
		logImpl.warning(
			`Could not prepare Obsidian Glass appearance: ${error.message}`,
		);
		return { status: "conflict", installed, themePath };
	}
	try {
		if (wallpaper.contents) {
			fs.mkdirSync(path.dirname(wallpaper.file), { recursive: true });
			fs.writeFileSync(wallpaper.file, wallpaper.contents, { flag: "wx" });
		}
	} catch (error) {
		logImpl.warning(
			`Could not preserve the selected wallpaper: ${error.message}`,
		);
		return { status: "conflict", installed, themePath };
	}
	const commands = [
		["omarchy", "theme", "set", appliedTheme],
		["omarchy", "theme", "bg", "set", wallpaper.file],
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
	logImpl.success(
		`Applied Omarchy theme ${appliedTheme}, background, and font.`,
	);
	return {
		status: "configured",
		appliedTheme,
		installed,
		preservedLocalChanges,
		themePath,
		legacyBackupPath,
	};
}
