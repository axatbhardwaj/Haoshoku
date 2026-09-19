import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { configureDiscordTheme } from "../src/helpers/configure_discord_theme.js";

const MANIFEST = {
	schemaVersion: 1,
	source: "vencord/aurora.theme.css",
	enabledThemes: ["aurora.theme.css"],
};
const CSS = ":root {\n\t--aurora: #7dd3c0;\n}\n";
const temporaryHomes = [];

afterEach(() => {
	for (const home of temporaryHomes.splice(0)) {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

function makeHome() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-discord-"));
	temporaryHomes.push(home);
	return home;
}

function makeLog() {
	return {
		info() {},
		success() {},
		warning() {},
		error() {},
		dim() {},
	};
}

function writeAppearance(home, themeName = "aurora") {
	const appearancePath = path.join(home, "appearance.json");
	fs.writeFileSync(
		appearancePath,
		JSON.stringify({ theme: { name: themeName } }),
	);
	return appearancePath;
}

function seedCheckout(home, { themeName = "aurora", css = CSS } = {}) {
	const sourcePath = path.join(
		home,
		".config",
		"omarchy",
		"themes",
		themeName,
		MANIFEST.source,
	);
	fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
	fs.writeFileSync(sourcePath, css);
	return sourcePath;
}

function seedClient(home, dirName, { settings } = {}) {
	const clientPath = path.join(home, ".config", dirName);
	fs.mkdirSync(clientPath, { recursive: true });
	if (settings !== undefined) {
		const settingsPath = path.join(clientPath, "settings", "settings.json");
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, "\t")}\n`);
	}
	return clientPath;
}

function readSettings(home, dirName) {
	return JSON.parse(
		fs.readFileSync(
			path.join(home, ".config", dirName, "settings", "settings.json"),
			"utf8",
		),
	);
}

describe("Discord theme configurator", () => {
	it("configures both clients, copies the CSS, and sets enabledThemes", async () => {
		const home = makeHome();
		const sourcePath = seedCheckout(home);
		seedClient(home, "vesktop", {
			settings: { autoUpdate: true, enabledThemes: ["other.theme.css"] },
		});
		seedClient(home, "Vencord");

		const result = await configureDiscordTheme({
			manifest: MANIFEST,
			appearanceManifestPath: writeAppearance(home),
			home,
			logImpl: makeLog(),
		});

		expect(result).toEqual({
			status: "configured",
			clients: ["Vesktop", "Vencord"],
		});
		for (const dirName of ["vesktop", "Vencord"]) {
			expect(
				fs.readFileSync(
					path.join(home, ".config", dirName, "themes", "aurora.theme.css"),
					"utf8",
				),
			).toBe(fs.readFileSync(sourcePath, "utf8"));
			expect(readSettings(home, dirName).enabledThemes).toEqual([
				"aurora.theme.css",
			]);
		}
		expect(readSettings(home, "vesktop").autoUpdate).toBe(true);
		const raw = fs.readFileSync(
			path.join(home, ".config", "vesktop", "settings", "settings.json"),
			"utf8",
		);
		expect(raw.endsWith("\n")).toBe(true);
		expect(raw).toContain("\t");
	});

	it("skips a missing client and still configures the present one", async () => {
		const home = makeHome();
		seedCheckout(home);
		seedClient(home, "vesktop");
		const infos = [];
		const logImpl = { ...makeLog(), info: (message) => infos.push(message) };

		const result = await configureDiscordTheme({
			manifest: MANIFEST,
			appearanceManifestPath: writeAppearance(home),
			home,
			logImpl,
		});

		expect(result).toEqual({ status: "configured", clients: ["Vesktop"] });
		expect(
			fs.existsSync(
				path.join(home, ".config", "vesktop", "themes", "aurora.theme.css"),
			),
		).toBe(true);
		expect(fs.existsSync(path.join(home, ".config", "Vencord"))).toBe(false);
		expect(infos.some((message) => message.includes("Vencord"))).toBe(true);
	});

	it("returns no-clients when neither Vesktop nor Vencord exists", async () => {
		const home = makeHome();
		seedCheckout(home);

		const result = await configureDiscordTheme({
			manifest: MANIFEST,
			appearanceManifestPath: writeAppearance(home),
			home,
			logImpl: makeLog(),
		});

		expect(result).toEqual({ status: "no-clients" });
	});

	it("rejects invalid manifests without touching the filesystem", async () => {
		const invalid = [
			{ ...MANIFEST, schemaVersion: 2 },
			{ ...MANIFEST, source: "../outside.css" },
			{ ...MANIFEST, source: "/absolute.css" },
			{ ...MANIFEST, source: "" },
			{ ...MANIFEST, enabledThemes: "aurora.theme.css" },
			{ ...MANIFEST, enabledThemes: ["../outside.css"] },
			{ ...MANIFEST, enabledThemes: ["theme.txt"] },
			{ ...MANIFEST, enabledThemes: ["a/b.css"] },
			{},
		];
		for (const manifest of invalid) {
			const home = makeHome();
			seedCheckout(home);
			seedClient(home, "vesktop");

			const result = await configureDiscordTheme({
				manifest,
				appearanceManifestPath: writeAppearance(home),
				home,
				logImpl: makeLog(),
			});

			expect(result).toEqual({ status: "invalid-manifest" });
			expect(
				fs.existsSync(path.join(home, ".config", "vesktop", "themes")),
			).toBe(false);
		}
	});

	it("returns source-missing when the checkout lacks the CSS", async () => {
		const home = makeHome();
		seedClient(home, "vesktop");

		const result = await configureDiscordTheme({
			manifest: MANIFEST,
			appearanceManifestPath: writeAppearance(home),
			home,
			logImpl: makeLog(),
		});

		expect(result).toEqual({ status: "source-missing" });
		expect(fs.existsSync(path.join(home, ".config", "vesktop", "themes"))).toBe(
			false,
		);
		expect(
			fs.existsSync(
				path.join(home, ".config", "vesktop", "settings", "settings.json"),
			),
		).toBe(false);
	});

	it("preserves every other settings key when setting enabledThemes", async () => {
		const home = makeHome();
		seedCheckout(home);
		seedClient(home, "vesktop", {
			settings: {
				autoUpdate: true,
				frameless: false,
				plugins: { CommandsAPI: { enabled: true } },
			},
		});

		const result = await configureDiscordTheme({
			manifest: MANIFEST,
			appearanceManifestPath: writeAppearance(home),
			home,
			logImpl: makeLog(),
		});

		expect(result.status).toBe("configured");
		expect(readSettings(home, "vesktop")).toEqual({
			autoUpdate: true,
			frameless: false,
			plugins: { CommandsAPI: { enabled: true } },
			enabledThemes: ["aurora.theme.css"],
		});
	});

	it("ships a valid Discord theme manifest for the pinned appearance", async () => {
		const home = makeHome();
		const shippedManifest = JSON.parse(
			fs.readFileSync(
				path.resolve(import.meta.dir, "..", "configs", "discord", "theme.json"),
				"utf8",
			),
		);
		const shippedAppearance = JSON.parse(
			fs.readFileSync(
				path.resolve(
					import.meta.dir,
					"..",
					"configs",
					"omarchy",
					"appearance.json",
				),
				"utf8",
			),
		);
		seedCheckout(home, { themeName: shippedAppearance.theme.name });
		seedClient(home, "vesktop");

		const result = await configureDiscordTheme({ home, logImpl: makeLog() });

		expect(result).toEqual({ status: "configured", clients: ["Vesktop"] });
		expect(shippedManifest).toEqual(MANIFEST);
		expect(readSettings(home, "vesktop").enabledThemes).toEqual(
			shippedManifest.enabledThemes,
		);
	});
});
