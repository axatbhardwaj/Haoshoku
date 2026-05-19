import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureLineInFile } from "../src/helpers/configure_hyprland.js";

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
		const appended = ensureLineInFile(
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
		const appended = ensureLineInFile(
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
		ensureLineInFile(
			target,
			"source = ~/.config/hypr-ocean/conf.d/*.conf",
		);
		expect(fs.readFileSync(target, "utf8")).toBe(
			"monitor=,preferred,auto,1\nsource = ~/.config/hypr-ocean/conf.d/*.conf\n",
		);
	});

	it("throws if the file does not exist", () => {
		expect(() => ensureLineInFile(path.join(tmpDir, "missing"), "x")).toThrow();
	});
});
