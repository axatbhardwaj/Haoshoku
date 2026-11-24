import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { configureOmarchyAppearance } from "../src/helpers/configure_omarchy_appearance.js";

const SHIPPED_REVISION = "4375f6e4c306b9712e957cae8295deabd7c07e34";
const REVISION = "e7600f5e2bf248ee976059f9a11a13c4856f7138";
const LEGACY_REVISION = "42845dc048632425bc566b993f25145f05e840f1";
const PRIOR_REVISION = "29356fb68d2070d847a259de0f310b055df55823";
const GLASS_REVISION = "3836bba29cf33c28fcca2f49aa1a098b2eb94662";
const REPOSITORY = "https://github.com/axatbhardwaj/omarchy-elysian-theme.git";
const MANIFEST = {
	schemaVersion: 1,
	theme: {
		name: "elysian",
		repository: REPOSITORY,
		revision: REVISION,
		legacyRevisions: [LEGACY_REVISION, PRIOR_REVISION, GLASS_REVISION],
	},
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
		if (
			path.dirname(home) !== fs.realpathSync(os.tmpdir()) ||
			!path.basename(home).startsWith("haoshoku-appearance-") ||
			!fs.lstatSync(home).isDirectory()
		)
			throw new Error("Unsafe fixture cleanup");
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
	it.each([{ variant: "obsidian-glass" }, null])(
		"rejects removed custom style requests before any commands (style=%j)",
		async (style) => {
			const home = makeHome();
			const calls = [];
			const result = await configureOmarchyAppearance({
				manifest: { ...MANIFEST, style },
				home,
				versionResult: VERSION_RESULT,
				logImpl: makeLog(),
				runCommandImpl: async (argv) => {
					calls.push(argv);
					return { exitCode: 0, stdout: "", stderr: "" };
				},
			});
			expect(result).toEqual({ status: "invalid-manifest", installed: false });
			expect(calls).toEqual([]);
			expect(fs.readdirSync(home)).toEqual([]);
		},
	);

	it("ships the released Omarchy 4 theme revision and legacy migration identity", () => {
		const shippedManifest = JSON.parse(
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
		expect(shippedManifest.iconTheme).toBe("Yaru-olive");
		expect(shippedManifest.theme.name).toBe("aurora");
		expect(shippedManifest.theme.repository).toBe(
			"https://github.com/axatbhardwaj/omarchy-aurora-theme.git",
		);
		expect(shippedManifest.theme.revision).toBe(SHIPPED_REVISION);
		expect(shippedManifest.theme.legacyRevisions).toEqual([]);
		expect(shippedManifest.background).toBe("0-aurora-lake.jpg");
	});

	it.each(["../outside", null, ""])("rejects invalid iconTheme %j before setup", async (iconTheme) => {
		const calls = [];
		const result = await configureOmarchyAppearance({
			manifest: { ...MANIFEST, iconTheme },
			home: makeHome(),
			versionResult: VERSION_RESULT,
			logImpl: makeLog(),
			runCommandImpl: async (argv) => {
				calls.push(argv);
				return { exitCode: 1, stdout: "", stderr: "" };
			},
		});
		expect(result.status).toBe("invalid-manifest");
		expect(calls).toEqual([]);
	});

	it("applies the requested installed icon theme after Omarchy finishes", async () => {
		const home = makeHome();
		seedTheme(home);
		const iconPath = path.join(home, ".icons", "Papirus-Dark");
		fs.mkdirSync(iconPath, { recursive: true });
		fs.writeFileSync(path.join(iconPath, "index.theme"), "[Icon Theme]\n");
		const calls = [];
		const result = await configureOmarchyAppearance({
			manifest: { ...MANIFEST, iconTheme: "Papirus-Dark" },
			home,
			versionResult: VERSION_RESULT,
			logImpl: makeLog(),
			runCommandImpl: async (argv) => {
				calls.push(argv);
				const stdout = argv[1] === "remote" ? REPOSITORY : "";
				return { exitCode: 0, stdout, stderr: "" };
			},
		});
		expect(result.status).toBe("configured");
		expect(calls.at(-1)).toEqual([
			"gsettings",
			"set",
			"org.gnome.desktop.interface",
			"icon-theme",
			"Papirus-Dark",
		]);
	});

	it("changes only icons from the CLI and rejects missing themes and conflicting modes", () => {
		const home = makeHome();
		const dataHome = path.join(home, "data");
		const iconPath = path.join(dataHome, "icons", "Papirus-Dark");
		fs.mkdirSync(iconPath, { recursive: true });
		fs.writeFileSync(path.join(iconPath, "index.theme"), "[Icon Theme]\n");
		fs.writeFileSync(
			path.join(home, "gsettings"),
			'#!/bin/sh\nprintf "%s\\n" "$@" >> "$HOME/calls"\n',
			{ mode: 0o755 },
		);
		const run = (...args) =>
			Bun.spawnSync([process.execPath, "haoshoku.js", ...args], {
				env: {
					...process.env,
					HOME: home,
					PATH: home,
					XDG_DATA_HOME: dataHome,
					XDG_DATA_DIRS: dataHome,
				},
			});
		const result = run("--icon-theme", "Papirus-Dark");
		expect(result.exitCode).toBe(0);
		const missing = run("--icon-theme", "Missing");
		expect(missing.exitCode).toBe(1);
		expect(missing.stdout.toString() + missing.stderr.toString()).toContain(
			"Missing",
		);
		expect(run("--icon-theme=", "--omarchy-appearance").exitCode).toBe(2);
		expect(run("--icon-theme=").exitCode).toBe(1);
		expect(
			fs.readFileSync(path.join(home, "calls"), "utf8").trim().split("\n"),
		).toEqual([
			"set",
			"org.gnome.desktop.interface",
			"icon-theme",
			"Papirus-Dark",
		]);
	});

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
					fs.mkdirSync(path.join(clonePath, "themed"));
					fs.writeFileSync(
						path.join(clonePath, "backgrounds", MANIFEST.background),
						"wallpaper",
					);
					fs.writeFileSync(
						path.join(clonePath, "themed", "hyprland.lua.tpl"),
						"size = 24\n",
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
		expect(
			fs.readFileSync(
				path.join(home, ".config", "omarchy", "themed", "hyprland.lua.tpl"),
				"utf8",
			),
		).toBe("size = 24\n");
		const checkout = calls.find(({ argv }) => argv[1] === "checkout");
		expect(checkout.argv).toEqual(["git", "checkout", "--detach", REVISION]);
		expect(calls.some(({ argv }) => argv[0] === "gsettings")).toBe(false);
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

	it("backs up and replaces a recognized legacy checkout from a local origin", async () => {
		const home = makeHome();
		const themePath = seedTheme(home);
		fs.writeFileSync(path.join(themePath, "local-change.txt"), "keep me");
		const calls = [];
		const result = await configureOmarchyAppearance({
			manifest: MANIFEST,
			home,
			versionResult: VERSION_RESULT,
			nowImpl: () => 1234567890,
			logImpl: makeLog(),
			runCommandImpl: async (argv, options = {}) => {
				calls.push({ argv, cwd: options.cwd });
				if (argv.join(" ") === "git remote get-url origin") {
					return {
						exitCode: 0,
						stdout: "/home/example/omarchy-elysian-theme\n",
						stderr: "",
					};
				}
				if (argv.join(" ") === "git rev-parse HEAD") {
					return { exitCode: 0, stdout: `${LEGACY_REVISION}\n`, stderr: "" };
				}
				if (argv.join(" ") === "git rev-parse --show-toplevel") {
					return { exitCode: 0, stdout: `${themePath}\n`, stderr: "" };
				}
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

		const legacyBackupPath = `${themePath}.haoshoku-backup-1234567890`;
		expect(result).toEqual(
			expect.objectContaining({
				status: "configured",
				installed: true,
				legacyBackupPath,
			}),
		);
		expect(
			fs.readFileSync(path.join(legacyBackupPath, "local-change.txt"), "utf8"),
		).toBe("keep me");
		expect(fs.existsSync(path.join(themePath, "local-change.txt"))).toBe(false);
		expect(calls.map(({ argv }) => argv)).toContainEqual([
			"git",
			"checkout",
			"--detach",
			REVISION,
		]);
	});

	it("restores a recognized legacy checkout when the replacement clone fails", async () => {
		const home = makeHome();
		const themePath = seedTheme(home);
		fs.writeFileSync(path.join(themePath, "local-change.txt"), "keep me");
		const result = await configureOmarchyAppearance({
			manifest: MANIFEST,
			home,
			versionResult: VERSION_RESULT,
			nowImpl: () => 1234567890,
			logImpl: makeLog(),
			runCommandImpl: async (argv) => {
				if (argv.join(" ") === "git remote get-url origin") {
					return { exitCode: 0, stdout: "/missing/local/theme\n", stderr: "" };
				}
				if (argv.join(" ") === "git rev-parse HEAD") {
					return { exitCode: 0, stdout: `${LEGACY_REVISION}\n`, stderr: "" };
				}
				if (argv.join(" ") === "git rev-parse --show-toplevel") {
					return { exitCode: 0, stdout: `${themePath}\n`, stderr: "" };
				}
				if (argv[0] === "git" && argv[1] === "clone") {
					return { exitCode: 1, stdout: "", stderr: "clone failed" };
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});

		expect(result.status).toBe("install-failed");
		expect(
			fs.readFileSync(path.join(themePath, "local-change.txt"), "utf8"),
		).toBe("keep me");
		expect(fs.existsSync(`${themePath}.haoshoku-backup-1234567890`)).toBe(
			false,
		);
	});

	it("restores a recognized legacy checkout when the final directory swap fails", async () => {
		const home = makeHome();
		const themePath = seedTheme(home);
		fs.writeFileSync(path.join(themePath, "local-change.txt"), "keep me");
		let renameCount = 0;
		const result = await configureOmarchyAppearance({
			manifest: MANIFEST,
			home,
			versionResult: VERSION_RESULT,
			nowImpl: () => 1234567890,
			renameImpl: (source, destination) => {
				renameCount += 1;
				if (renameCount === 2) throw new Error("swap failed");
				fs.renameSync(source, destination);
			},
			logImpl: makeLog(),
			runCommandImpl: async (argv) => {
				if (argv.join(" ") === "git remote get-url origin") {
					return { exitCode: 0, stdout: "/missing/local/theme\n", stderr: "" };
				}
				if (argv.join(" ") === "git rev-parse HEAD") {
					return { exitCode: 0, stdout: `${LEGACY_REVISION}\n`, stderr: "" };
				}
				if (argv.join(" ") === "git rev-parse --show-toplevel") {
					return { exitCode: 0, stdout: `${themePath}\n`, stderr: "" };
				}
				if (argv[0] === "git" && argv[1] === "clone") {
					const clonePath = argv.at(-1);
					fs.mkdirSync(path.join(clonePath, "backgrounds"), {
						recursive: true,
					});
					fs.writeFileSync(
						path.join(clonePath, "backgrounds", MANIFEST.background),
						"wallpaper",
					);
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});

		expect(result.status).toBe("install-failed");
		expect(
			fs.readFileSync(path.join(themePath, "local-change.txt"), "utf8"),
		).toBe("keep me");
		expect(fs.existsSync(`${themePath}.haoshoku-backup-1234567890`)).toBe(
			false,
		);
	});

	it("keeps the legacy checkout active when the staged background is missing", async () => {
		const home = makeHome();
		const themePath = seedTheme(home);
		fs.writeFileSync(path.join(themePath, "local-change.txt"), "keep me");
		const result = await configureOmarchyAppearance({
			manifest: MANIFEST,
			home,
			versionResult: VERSION_RESULT,
			nowImpl: () => 1234567890,
			logImpl: makeLog(),
			runCommandImpl: async (argv) => {
				if (argv.join(" ") === "git remote get-url origin") {
					return { exitCode: 0, stdout: "/missing/local/theme\n", stderr: "" };
				}
				if (argv.join(" ") === "git rev-parse HEAD") {
					return { exitCode: 0, stdout: `${LEGACY_REVISION}\n`, stderr: "" };
				}
				if (argv.join(" ") === "git rev-parse --show-toplevel") {
					return { exitCode: 0, stdout: `${themePath}\n`, stderr: "" };
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});

		expect(result.status).toBe("background-missing");
		expect(
			fs.readFileSync(path.join(themePath, "local-change.txt"), "utf8"),
		).toBe("keep me");
		expect(fs.existsSync(`${themePath}.haoshoku-backup-1234567890`)).toBe(
			false,
		);
	});

	it("refuses an HTTPS fork even when it points at a recognized legacy revision", async () => {
		const home = makeHome();
		const themePath = seedTheme(home);
		const result = await configureOmarchyAppearance({
			manifest: MANIFEST,
			home,
			versionResult: VERSION_RESULT,
			logImpl: makeLog(),
			runCommandImpl: async (argv) => {
				if (argv.join(" ") === "git remote get-url origin") {
					return {
						exitCode: 0,
						stdout: "https://example.com/fork/omarchy-elysian-theme.git\n",
						stderr: "",
					};
				}
				if (argv.join(" ") === "git rev-parse HEAD") {
					return { exitCode: 0, stdout: `${LEGACY_REVISION}\n`, stderr: "" };
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});

		expect(result.status).toBe("conflict");
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
