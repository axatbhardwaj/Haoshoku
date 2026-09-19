import fs from "node:fs";
import path from "node:path";
import { log } from "../common/utils.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const DEFAULT_MANIFEST_PATH = path.join(
	PROJECT_ROOT,
	"configs",
	"discord",
	"theme.json",
);
const DEFAULT_APPEARANCE_MANIFEST_PATH = path.join(
	PROJECT_ROOT,
	"configs",
	"omarchy",
	"appearance.json",
);
const THEME_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CSS_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.css$/;
const CLIENTS = [
	{ name: "Vesktop", dirName: "vesktop" },
	{ name: "Vencord", dirName: "Vencord" },
];

function validateManifest(manifest) {
	if (manifest?.schemaVersion !== 1) return "schemaVersion must be 1";
	if (
		typeof manifest?.source !== "string" ||
		manifest.source.length === 0 ||
		path.isAbsolute(manifest.source) ||
		manifest.source.split("/").some((segment) => segment === "..")
	) {
		return "source must be a relative path without `..`";
	}
	if (!CSS_BASENAME_PATTERN.test(path.basename(manifest.source))) {
		return "source must end in a safe *.css filename";
	}
	if (
		!Array.isArray(manifest?.enabledThemes) ||
		manifest.enabledThemes.some(
			(entry) => typeof entry !== "string" || !CSS_BASENAME_PATTERN.test(entry),
		)
	) {
		return "enabledThemes must be an array of safe `*.css` basenames";
	}
	return null;
}

function readSettings(settingsPath, clientName, logImpl) {
	let settings = {};
	if (!fs.existsSync(settingsPath)) {
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		return { settings };
	}
	try {
		settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
	} catch (error) {
		logImpl.warning(`Could not read ${clientName} settings: ${error.message}`);
		return { error: true };
	}
	if (
		settings === null ||
		typeof settings !== "object" ||
		Array.isArray(settings)
	) {
		logImpl.warning(
			`Could not read ${clientName} settings: expected a JSON object.`,
		);
		return { error: true };
	}
	return { settings };
}

/**
 * Deploy the Omarchy theme's Vencord CSS into Vesktop/Vencord from a
 * declarative manifest. The theme checkout itself is owned by
 * configureOmarchyAppearance; this helper only copies its CSS and sets
 * `enabledThemes`, preserving every other settings key.
 */
export async function configureDiscordTheme({
	manifest,
	manifestPath = DEFAULT_MANIFEST_PATH,
	appearanceManifestPath = DEFAULT_APPEARANCE_MANIFEST_PATH,
	home = process.env.HOME,
	logImpl = log,
} = {}) {
	let discord;
	try {
		discord = manifest ?? JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (error) {
		logImpl.warning(
			`Discord theme manifest could not be read: ${error.message}`,
		);
		return { status: "invalid-manifest" };
	}
	const validationError = validateManifest(discord);
	if (validationError) {
		logImpl.warning(`Invalid Discord theme manifest: ${validationError}.`);
		return { status: "invalid-manifest" };
	}

	let themeName;
	try {
		themeName = JSON.parse(fs.readFileSync(appearanceManifestPath, "utf8"))
			?.theme?.name;
	} catch (error) {
		logImpl.warning(
			`Omarchy appearance manifest could not be read: ${error.message}`,
		);
		return { status: "invalid-manifest" };
	}
	if (!THEME_NAME_PATTERN.test(themeName ?? "")) {
		logImpl.warning(
			"Invalid Omarchy appearance manifest: theme.name must be a safe lowercase slug.",
		);
		return { status: "invalid-manifest" };
	}

	const sourcePath = path.join(
		home,
		".config",
		"omarchy",
		"themes",
		themeName,
		discord.source,
	);
	if (!fs.existsSync(sourcePath)) {
		logImpl.warning(`Discord theme source is missing: ${sourcePath}`);
		return { status: "source-missing" };
	}

	const clients = [];
	for (const client of CLIENTS) {
		const clientPath = path.join(home, ".config", client.dirName);
		if (!fs.existsSync(clientPath)) {
			logImpl.info(`Skipping ${client.name}: ${clientPath} does not exist.`);
			continue;
		}
		const themesPath = path.join(clientPath, "themes");
		fs.mkdirSync(themesPath, { recursive: true });
		fs.copyFileSync(
			sourcePath,
			path.join(themesPath, path.basename(discord.source)),
		);

		const settingsPath = path.join(clientPath, "settings", "settings.json");
		const { settings, error } = readSettings(
			settingsPath,
			client.name,
			logImpl,
		);
		if (error) return { status: "settings-invalid", client: client.name };
		settings.enabledThemes = [...discord.enabledThemes];
		fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, "\t")}\n`);
		clients.push(client.name);
	}

	if (clients.length === 0) {
		logImpl.warning("No Vesktop or Vencord config directory found; nothing deployed.");
		return { status: "no-clients" };
	}
	logImpl.success(
		`Deployed the ${themeName} Discord theme to ${clients.join(" and ")}.`,
	);
	return { status: "configured", clients };
}
