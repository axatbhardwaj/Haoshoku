import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { installSuperpowers } from "../src/helpers/configure_claude.js";

describe("installSuperpowers()", () => {
	let tmpDir;
	let settingsPath;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-test-"));
		settingsPath = path.join(tmpDir, "settings.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	async function expectInvalidSettingsToRemainUntouched(content) {
		fs.writeFileSync(settingsPath, content);

		const messages = [];
		const originalError = console.error;
		const originalLog = console.log;
		console.error = (...args) => messages.push(args.join(" "));
		console.log = (...args) => messages.push(args.join(" "));
		try {
			await expect(installSuperpowers(settingsPath)).resolves.toBeUndefined();
		} finally {
			console.error = originalError;
			console.log = originalLog;
		}

		expect(fs.readFileSync(settingsPath, "utf-8")).toBe(content);
		expect(messages.join("\n")).toMatch(
			/must be an object.*fix it before retrying/i,
		);
		expect(messages.join("\n")).not.toMatch(/Superpowers plugin enabled/i);
	}

	it("enables the plugin when the key is missing", async () => {
		const initial = {
			permissions: { allow: [] },
			enabledPlugins: { "other@source": true },
		};
		fs.writeFileSync(settingsPath, `${JSON.stringify(initial, null, 2)}\n`);

		await installSuperpowers(settingsPath);

		const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		expect(result.enabledPlugins["superpowers@claude-plugins-official"]).toBe(
			true,
		);
		expect(result.enabledPlugins["other@source"]).toBe(true);
		expect(result.permissions).toEqual(initial.permissions);
	});

	it("is idempotent when the plugin is already enabled", async () => {
		const initial = {
			enabledPlugins: { "superpowers@claude-plugins-official": true },
		};
		const initialContent = `${JSON.stringify(initial, null, 2)}\n`;
		fs.writeFileSync(settingsPath, initialContent);

		await installSuperpowers(settingsPath);

		expect(fs.readFileSync(settingsPath, "utf-8")).toBe(initialContent);
	});

	it("creates missing parent directories and enables the plugin in fresh settings", async () => {
		settingsPath = path.join(
			tmpDir,
			"fresh-machine",
			".claude",
			"settings.json",
		);

		await installSuperpowers(settingsPath);

		const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		expect(result.enabledPlugins["superpowers@claude-plugins-official"]).toBe(
			true,
		);
	});

	it("returns without throwing when settings.json is not valid JSON", async () => {
		const malformed = "{ enabledPlugins: not valid json";
		fs.writeFileSync(settingsPath, malformed);

		const messages = [];
		const originalError = console.error;
		console.error = (...args) => messages.push(args.join(" "));
		try {
			await expect(installSuperpowers(settingsPath)).resolves.toBeUndefined();
		} finally {
			console.error = originalError;
		}

		// File is left untouched (no partial write / stub).
		expect(fs.readFileSync(settingsPath, "utf-8")).toBe(malformed);
		// A clear, actionable error was logged.
		expect(messages.join("\n")).toMatch(/settings\.json is not valid JSON/i);
		expect(messages.join("\n")).not.toMatch(/haoshoku --claude/);
	});

	for (const [name, value] of [
		["an array", []],
		["null", null],
		["a primitive", true],
	]) {
		it(`leaves settings.json untouched when its root is ${name}`, async () => {
			await expectInvalidSettingsToRemainUntouched(
				`${JSON.stringify(value, null, 2)}\n`,
			);
		});
	}

	for (const [name, value] of [
		["an array", []],
		["null", null],
		["a primitive", true],
	]) {
		it(`leaves settings.json untouched when enabledPlugins is ${name}`, async () => {
			await expectInvalidSettingsToRemainUntouched(
				`${JSON.stringify({ enabledPlugins: value }, null, 2)}\n`,
			);
		});
	}
});
