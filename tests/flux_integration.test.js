import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const desktopPath = path.join(
	repoRoot,
	"configs",
	"mimeapps",
	"applications",
	"chromium.desktop",
);
const wrapperPath = path.join(
	repoRoot,
	"configs",
	"scripts",
	"haoshoku-chromium-flux",
);
const bindingsPath = path.join(
	repoRoot,
	"configs",
	"omarchy",
	"haoshoku",
	"bindings.lua",
);
const scriptsPath = path.join(repoRoot, "configs", "scripts");

function filesUnder(directory) {
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return filesUnder(entryPath);
			return entry.isFile() ? [entryPath] : [];
		});
}

function sourceCommands(source) {
	const commands = [];
	let command = "";
	let commandLine = 1;

	for (const [index, line] of source.split(/\r?\n/).entries()) {
		const fragment = line.replace(/\s+#.*$/, "").trim();
		if (!command) commandLine = index + 1;
		const trailingBackslashes = fragment.match(/\\+$/)?.[0].length ?? 0;
		const continued = trailingBackslashes % 2 === 1;
		const part = continued ? fragment.slice(0, -1).trimEnd() : fragment;
		command = [command, part].filter(Boolean).join(" ");

		if (!continued) {
			if (command) commands.push({ command, line: commandLine });
			command = "";
		}
	}

	if (command) commands.push({ command, line: commandLine });
	return commands;
}

function fluxLaunchSitesInSource(source, sourceName) {
	return sourceCommands(source).flatMap(({ command, line }) => {
		if (
			command.startsWith("#") ||
			!/(?:^|\s)(?:\/usr\/bin\/)?brave-origin(?=\s|$)/.test(command) ||
			!/--user-data-dir=(?:"[^"]*brave-haoshoku\/flux"|'[^']*brave-haoshoku\/flux'|[^\s;]*brave-haoshoku\/flux)(?=\s|;|$)/.test(
				command,
			)
		)
			return [];

		return [{ command, source: `${sourceName}:${line}` }];
	});
}

function hasFluxClass(command) {
	return /(?:^|\s)(?:--class(?:=chromium-flux|=(?:"chromium-flux"|'chromium-flux')|\s+(?:chromium-flux|"chromium-flux"|'chromium-flux'))|"--class=chromium-flux"|'--class=chromium-flux')(?=\s|[;&|)]|$)/.test(
		command,
	);
}

describe("Flux Brave Origin integration", () => {
	let directory;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-flux-wrapper-"));
	});

	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	it("keeps the desktop Exec command paired with the deployed wrapper", () => {
		expect(fs.existsSync(desktopPath)).toBe(true);
		expect(fs.existsSync(wrapperPath)).toBe(true);

		const execLine = fs
			.readFileSync(desktopPath, "utf8")
			.split("\n")
			.find((line) => line.startsWith("Exec="));
		expect(execLine).toBeDefined();
		const execFirstField = execLine
			.slice("Exec=".length)
			.trim()
			.match(/^\S+/)?.[0];
		expect(execFirstField).toBeDefined();
		expect(execFirstField).toMatch(/^\S+$/);
		expect(path.isAbsolute(execFirstField)).toBe(false);
		expect(execFirstField).toBe(path.basename(wrapperPath));
		const desktop = fs.readFileSync(desktopPath, "utf8");
		expect(desktop).toContain("Name=Brave Origin");
		expect(desktop).toContain(
			"Comment=Brave Origin pinned to the flux profile so web apps share one session",
		);
		expect(desktop).toContain("Icon=brave-origin");
	});

	it("resolves the wrapped Brave Origin binary through PATH", () => {
		expect(fs.readFileSync(wrapperPath, "utf8")).not.toContain(
			"/usr/bin/brave-origin",
		);
	});

	it("routes every focus-aware web app through an explicit Brave profile", () => {
		const bindings = fs.readFileSync(bindingsPath, "utf8");
		const webApps = bindings.slice(
			bindings.indexOf("-- Web apps"),
			bindings.indexOf("-- CTRL SHIFT SUPER", bindings.indexOf("-- Web apps")),
		);
		const bindingsByChord = new Map(
			[
				...webApps.matchAll(
					/o\.bind\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"((?:\\.|[^"])*)"\s*\)/gs,
				),
			].map(([, chord, description, command]) => [
				chord,
				{ command: command.replaceAll('\\"', '"'), description },
			]),
		);

		expect(bindingsByChord.get("SUPER + P")).toEqual({
			description: "Google Photos",
			command:
				'omarchy-launch-or-focus "brave-photos\\\\.google\\\\.com__-Default" "haoshoku-chromium-flux --app=https://photos.google.com/"',
		});
		expect(bindingsByChord.get("SUPER + SHIFT + ALT + A")).toEqual({
			description: "Grok",
			command:
				'omarchy-launch-or-focus "brave-grok\\\\.com__-Default" "haoshoku-chromium-flux --app=https://grok.com"',
		});
		expect(bindingsByChord.get("SUPER + SHIFT + ALT + G")).toEqual({
			description: "WhatsApp",
			command:
				'omarchy-launch-or-focus "brave-web\\\\.whatsapp\\\\.com__-Default" "brave-origin --user-data-dir=$HOME/.config/brave-haoshoku/whatsapp --app=https://web.whatsapp.com/"',
		});
		expect(bindingsByChord.get("SUPER + SHIFT + ALT + X")?.command).toBe(
			'omarchy-launch-webapp "https://x.com/compose/post"',
		);
		expect(bindings).not.toContain("Chromium");
	});

	it("stamps every literal Flux-profile Brave Origin launch with the Flux class", () => {
		const fluxLaunchSites = filesUnder(scriptsPath).flatMap((file) =>
			fluxLaunchSitesInSource(
				fs.readFileSync(file, "utf8"),
				path.relative(repoRoot, file),
			),
		);

		expect(fluxLaunchSites.length).toBeGreaterThan(0);
		expect(
			fluxLaunchSites.filter(({ command }) => !hasFluxClass(command)),
		).toEqual([]);
	});

	it("includes bare Brave Origin Flux launches in the class guard", () => {
		const command =
			'brave-origin --user-data-dir="$HOME/.config/brave-haoshoku/flux" --app=https://example.invalid/';

		expect(fluxLaunchSitesInSource(command, "fixture")).toEqual([
			{ command, source: "fixture:1" },
		]);
	});

	it("rejects suffixed Flux class values at literal launch sites", () => {
		const command =
			'/usr/bin/brave-origin --user-data-dir="$HOME/.config/brave-haoshoku/flux" --class=chromium-flux-wrong';
		const sites = fluxLaunchSitesInSource(command, "fixture");

		expect(sites).toHaveLength(1);
		expect(
			[
				"--class=chromium-flux",
				"--class chromium-flux",
				'"--class=chromium-flux"',
				'--class="chromium-flux"',
			].map((flag) => hasFluxClass(`/usr/bin/brave-origin ${flag}`)),
		).toEqual([true, true, true, true]);
		expect(
			[
				"--class=chromium-flux-wrong",
				'--class="chromium-flux)wrong"',
				"--class='chromium-flux;wrong'",
			].map((flag) => hasFluxClass(`/usr/bin/brave-origin ${flag}`)),
		).toEqual([false, false, false]);
		expect(sites.filter((site) => !hasFluxClass(site.command))).toEqual([
			{ command, source: "fixture:1" },
		]);
	});

	it("treats backslash-continued Flux launches as logical commands", () => {
		const classedCommand =
			'/usr/bin/brave-origin --user-data-dir="$HOME/.config/brave-haoshoku/flux" --class=chromium-flux';
		const classlessCommand =
			'/usr/bin/brave-origin --user-data-dir="$HOME/.config/brave-haoshoku/flux" --app=https://example.invalid/';
		const source = [
			"/usr/bin/brave-origin \\",
			'  --user-data-dir="$HOME/.config/brave-haoshoku/flux" \\',
			"  --class=chromium-flux",
			"/usr/bin/brave-origin \\",
			'  --user-data-dir="$HOME/.config/brave-haoshoku/flux" \\',
			"  --app=https://example.invalid/",
		].join("\n");
		const sites = fluxLaunchSitesInSource(source, "fixture");

		expect(sites).toEqual([
			{ command: classedCommand, source: "fixture:1" },
			{ command: classlessCommand, source: "fixture:4" },
		]);
		expect(sites.filter((site) => !hasFluxClass(site.command))).toEqual([
			{ command: classlessCommand, source: "fixture:4" },
		]);
	});

	// Mutation caught: placing the injected class after "$@" prevents an
	// explicit caller class from taking precedence; omitting it leaves a Flux
	// singleton owner unable to stamp later plain windows with chromium-flux.
	it("injects the Flux class before forwarded Brave Origin arguments", async () => {
		const capturedArguments = path.join(directory, "brave-origin-arguments");
		const braveOrigin = path.join(directory, "brave-origin");
		const isolatedWrapper = path.join(directory, "haoshoku-chromium-flux");
		fs.writeFileSync(
			braveOrigin,
			`#!/usr/bin/env bash
printf '%s\\0' "$@" > "$CAPTURED_ARGUMENTS"
`,
		);
		fs.writeFileSync(
			isolatedWrapper,
			fs.readFileSync(wrapperPath, "utf8"),
		);
		fs.chmodSync(braveOrigin, 0o755);
		fs.chmodSync(isolatedWrapper, 0o755);

		const proc = Bun.spawn(
			[isolatedWrapper, "--class=caller-choice", "https://example.test/"],
			{
				env: {
					...process.env,
					CAPTURED_ARGUMENTS: capturedArguments,
					HOME: directory,
					PATH: `${directory}:${process.env.PATH}`,
				},
			},
		);

		await proc.exited;
		expect(fs.readFileSync(capturedArguments, "utf8").split("\0").filter(Boolean)).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
			"--class=chromium-flux",
			"--class=caller-choice",
			"https://example.test/",
		]);
	});
});
