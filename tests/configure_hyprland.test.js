import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as hyprland from "../src/helpers/configure_hyprland.js";

describe("ensureLineInFile", () => {
	let tmpDir;
	let target;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-hypr-"));
		target = path.join(tmpDir, "hyprland.conf");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("appends the line when missing and adds a trailing newline", () => {
		fs.writeFileSync(target, "monitor=,preferred,auto,1\n");
		const appended = hyprland.ensureLineInFile(
			target,
			"source = ~/.config/hypr-ocean/conf.d/*.conf",
		);
		expect(appended).toBe(true);
		expect(fs.readFileSync(target, "utf8")).toBe(
			"monitor=,preferred,auto,1\nsource = ~/.config/hypr-ocean/conf.d/*.conf\n",
		);
	});

	it("is a no-op when the line already exists", () => {
		fs.writeFileSync(
			target,
			"monitor=,preferred,auto,1\nsource = ~/.config/hypr-ocean/conf.d/*.conf\n",
		);
		const appended = hyprland.ensureLineInFile(
			target,
			"source = ~/.config/hypr-ocean/conf.d/*.conf",
		);
		expect(appended).toBe(false);
		expect(fs.readFileSync(target, "utf8")).toBe(
			"monitor=,preferred,auto,1\nsource = ~/.config/hypr-ocean/conf.d/*.conf\n",
		);
	});

	it("inserts a missing trailing newline before appending", () => {
		fs.writeFileSync(target, "monitor=,preferred,auto,1"); // no trailing newline
		hyprland.ensureLineInFile(
			target,
			"source = ~/.config/hypr-ocean/conf.d/*.conf",
		);
		expect(fs.readFileSync(target, "utf8")).toBe(
			"monitor=,preferred,auto,1\nsource = ~/.config/hypr-ocean/conf.d/*.conf\n",
		);
	});

	it("throws if the file does not exist", () => {
		expect(() =>
			hyprland.ensureLineInFile(path.join(tmpDir, "missing"), "x"),
		).toThrow();
	});
});

describe("checkoutPinnedCaelestia", () => {
	it("throws when the pinned checkout command fails", async () => {
		const commands = [];
		expect(typeof hyprland.checkoutPinnedCaelestia).toBe("function");

		await expect(
			hyprland.checkoutPinnedCaelestia({
				cloneDir: "/tmp/caelestia",
				pinnedSha: "abc123",
				run: async (command, options) => {
					commands.push({ command, options });
					return false;
				},
			}),
		).rejects.toThrow("Failed to checkout pinned Caelestia commit abc123");

		expect(commands).toEqual([
			{
				command: "git checkout abc123",
				options: { cwd: "/tmp/caelestia" },
			},
		]);
	});

	it("skips checkout when the pin is main", async () => {
		let called = false;

		expect(typeof hyprland.checkoutPinnedCaelestia).toBe("function");

		const checkedOut = await hyprland.checkoutPinnedCaelestia({
			cloneDir: "/tmp/caelestia",
			pinnedSha: "main",
			run: async () => {
				called = true;
				return true;
			},
		});

		expect(checkedOut).toBe(false);
		expect(called).toBe(false);
	});
});
