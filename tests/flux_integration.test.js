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
