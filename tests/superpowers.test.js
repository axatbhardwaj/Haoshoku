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

	it("does not throw or create a stub when settings.json is missing", async () => {
		await expect(installSuperpowers(settingsPath)).resolves.toBeUndefined();
		expect(fs.existsSync(settingsPath)).toBe(false);
	});
});
