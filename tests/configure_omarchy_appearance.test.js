import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { configureOmarchyAppearance } from "../src/helpers/configure_omarchy_appearance.js";

const REVISION = "a89efc5a56879423c18e79a375d640b2d42d2829";
const REPOSITORY = "https://github.com/axatbhardwaj/omarchy-elysian-theme.git";
const MANIFEST = {
	schemaVersion: 1,
	theme: { name: "elysian", repository: REPOSITORY, revision: REVISION },
	background: "1-verdant-mountain.jpg",
	font: "JetBrainsMono Nerd Font",
};
const VERSION_RESULT = {
	exitCode: 0,
	stdout: "Omarchy 4.0.0\n",
	stderr: "",
};
const temporaryHomes = [];

afterEach(() => {
	for (const home of temporaryHomes.splice(0)) {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

function makeHome() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-appearance-"));
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

function seedTheme(home) {
	const themePath = path.join(home, ".config", "omarchy", "themes", "elysian");
	fs.mkdirSync(path.join(themePath, ".git"), { recursive: true });
	fs.mkdirSync(path.join(themePath, "backgrounds"), { recursive: true });
	fs.writeFileSync(
		path.join(themePath, "backgrounds", MANIFEST.background),
		"wallpaper",
	);
	return themePath;
}

describe("Omarchy appearance configurator", () => {
	it("installs the pinned theme and applies its background and font", async () => {
		const home = makeHome();
		const calls = [];
		const result = await configureOmarchyAppearance({
			manifest: MANIFEST,
			home,
			versionResult: VERSION_RESULT,
			logImpl: makeLog(),
			runCommandImpl: async (argv, options = {}) => {
				calls.push({ argv, cwd: options.cwd });
				if (argv[0] === "git" && argv[1] === "clone") {
					const clonePath = argv.at(-1);
					fs.mkdirSync(path.join(clonePath, ".git"), { recursive: true });
					fs.mkdirSync(path.join(clonePath, "backgrounds"));
					fs.writeFileSync(
						path.join(clonePath, "backgrounds", MANIFEST.background),
						"wallpaper",
					);
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});

		const themePath = path.join(
			home,
			".config",
			"omarchy",
			"themes",
			"elysian",
		);
		expect(result).toEqual(
			expect.objectContaining({ status: "configured", installed: true }),
		);
		expect(fs.existsSync(themePath)).toBe(true);
		expect(calls.map(({ argv }) => argv)).toContainEqual([
			"omarchy",
			"theme",
			"set",
			"elysian",
		]);
		expect(calls.map(({ argv }) => argv)).toContainEqual([
			"omarchy",
			"theme",
			"bg",
			"set",
			path.join(themePath, "backgrounds", MANIFEST.background),
		]);
		expect(calls.map(({ argv }) => argv)).toContainEqual([
			"omarchy",
			"font",
			"set",
			MANIFEST.font,
		]);
		const checkout = calls.find(({ argv }) => argv[1] === "checkout");
		expect(checkout.argv).toEqual(["git", "checkout", "--detach", REVISION]);
		expect(checkout.cwd).toContain(".haoshoku-elysian-");
	});

	it("preserves and applies a matching theme checkout with local changes", async () => {
		const home = makeHome();
		const themePath = seedTheme(home);
		const calls = [];
		const result = await configureOmarchyAppearance({
			manifest: MANIFEST,
			home,
			versionResult: VERSION_RESULT,
			logImpl: makeLog(),
			runCommandImpl: async (argv, options = {}) => {
				calls.push({ argv, cwd: options.cwd });
				if (argv.join(" ") === "git remote get-url origin") {
					return { exitCode: 0, stdout: `${REPOSITORY}\n`, stderr: "" };
				}
				if (argv.join(" ") === "git status --porcelain") {
					return { exitCode: 0, stdout: " M colors.toml\n", stderr: "" };
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});

		expect(result).toEqual(
			expect.objectContaining({
				status: "configured",
				installed: false,
				preservedLocalChanges: true,
			}),
		);
		expect(calls.some(({ argv }) => argv[1] === "clone")).toBe(false);
		expect(calls.some(({ argv }) => argv[1] === "fetch")).toBe(false);
		expect(calls.some(({ argv }) => argv[1] === "checkout")).toBe(false);
		expect(calls.map(({ argv }) => argv)).toContainEqual([
			"omarchy",
			"theme",
			"set",
			"elysian",
		]);
		expect(fs.existsSync(themePath)).toBe(true);
	});

	it("refuses to overwrite an existing theme from another source", async () => {
		const home = makeHome();
		seedTheme(home);
		const calls = [];
		const result = await configureOmarchyAppearance({
			manifest: MANIFEST,
			home,
			versionResult: VERSION_RESULT,
			logImpl: makeLog(),
			runCommandImpl: async (argv, options = {}) => {
				calls.push({ argv, cwd: options.cwd });
				if (argv.join(" ") === "git remote get-url origin") {
					return {
						exitCode: 0,
						stdout: "https://example.com/someone-elses-theme.git\n",
						stderr: "",
					};
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});

		expect(result.status).toBe("conflict");
		expect(calls.some(({ argv }) => argv[0] === "omarchy")).toBe(false);
	});

	it("rejects unsafe manifest paths before running commands", async () => {
		const calls = [];
		const result = await configureOmarchyAppearance({
			manifest: { ...MANIFEST, background: "../outside.jpg" },
			home: makeHome(),
			versionResult: VERSION_RESULT,
			logImpl: makeLog(),
			runCommandImpl: async (argv) => {
				calls.push(argv);
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});

		expect(result.status).toBe("invalid-manifest");
		expect(calls).toEqual([]);
	});
});
