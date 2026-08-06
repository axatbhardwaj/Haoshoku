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
			!/(?:^|\s)(?:\/usr\/bin\/)?chromium(?=\s|$)/.test(command) ||
			!/--user-data-dir=(?:"[^"]*chromium-haoshoku\/flux"|'[^']*chromium-haoshoku\/flux'|[^\s;]*chromium-haoshoku\/flux)(?=\s|;|$)/.test(
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

describe("Flux Chromium integration", () => {
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
	});

	it("stamps every literal Flux-profile Chromium launch with the Flux class", () => {
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

	it("rejects suffixed Flux class values at literal launch sites", () => {
		const command =
			'chromium --user-data-dir="$HOME/.config/chromium-haoshoku/flux" --class=chromium-flux-wrong';
		const sites = fluxLaunchSitesInSource(command, "fixture");

		expect(sites).toHaveLength(1);
		expect(
			[
				"--class=chromium-flux",
				"--class chromium-flux",
				'"--class=chromium-flux"',
				'--class="chromium-flux"',
			].map((flag) => hasFluxClass(`chromium ${flag}`)),
		).toEqual([true, true, true, true]);
		expect(
			[
				"--class=chromium-flux-wrong",
				'--class="chromium-flux)wrong"',
				"--class='chromium-flux;wrong'",
			].map((flag) => hasFluxClass(`chromium ${flag}`)),
		).toEqual([false, false, false]);
		expect(sites.filter((site) => !hasFluxClass(site.command))).toEqual([
			{ command, source: "fixture:1" },
		]);
	});

	it("treats backslash-continued Flux launches as logical commands", () => {
		const classedCommand =
			'chromium --user-data-dir="$HOME/.config/chromium-haoshoku/flux" --class=chromium-flux';
		const classlessCommand =
			'chromium --user-data-dir="$HOME/.config/chromium-haoshoku/flux" --app=https://example.invalid/';
		const source = [
			"chromium \\",
			'  --user-data-dir="$HOME/.config/chromium-haoshoku/flux" \\',
			"  --class=chromium-flux",
			"chromium \\",
			'  --user-data-dir="$HOME/.config/chromium-haoshoku/flux" \\',
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
	it("injects the Flux class before forwarded Chromium arguments", async () => {
		const capturedArguments = path.join(directory, "chromium-arguments");
		const chromium = path.join(directory, "chromium");
		const isolatedWrapper = path.join(directory, "haoshoku-chromium-flux");
		fs.writeFileSync(
			chromium,
			`#!/usr/bin/env bash
printf '%s\\0' "$@" > "$CAPTURED_ARGUMENTS"
`,
		);
		fs.writeFileSync(
			isolatedWrapper,
			fs.readFileSync(wrapperPath, "utf8").replace("/usr/bin/chromium", chromium),
		);
		fs.chmodSync(chromium, 0o755);
		fs.chmodSync(isolatedWrapper, 0o755);

		const proc = Bun.spawn(
			[isolatedWrapper, "--class=caller-choice", "https://example.test/"],
			{
				env: {
					...process.env,
					CAPTURED_ARGUMENTS: capturedArguments,
					HOME: directory,
				},
			},
		);

		await proc.exited;
		expect(fs.readFileSync(capturedArguments, "utf8").split("\0").filter(Boolean)).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
			"--class=caller-choice",
			"https://example.test/",
		]);
	});
});
