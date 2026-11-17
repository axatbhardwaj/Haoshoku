import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { configureOmarchyAppearance } from "../src/helpers/configure_omarchy_appearance.js";

const SHIPPED_REVISION = "1f3a3d854699e8aa4e4c195e63ec74cc9ee55839";
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
const lua = Bun.which("lua5.4") ?? Bun.which("lua");

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
		expect(shippedManifest.theme.name).toBe("aurora");
		expect(shippedManifest.theme.repository).toBe(
			"https://github.com/axatbhardwaj/omarchy-aurora-theme.git",
		);
		expect(shippedManifest.theme.revision).toBe(SHIPPED_REVISION);
		expect(shippedManifest.theme.legacyRevisions).toEqual([]);
		expect(shippedManifest.background).toBe("0-aurora-lake.jpg");
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

const OBSIDIAN = {
	variant: "obsidian-glass",
	palette: { tint: "#080a0b", accent: "#86edb0" },
	glass: { t3Opacity: 0.92 },
};

describe("optional Obsidian Glass settings", () => {
	it.each([
		{ variant: "unknown" },
		{ ...OBSIDIAN, palette: { tint: "#ffffff" } },
		{ ...OBSIDIAN, palette: { tint: "#303030" } },
		{ ...OBSIDIAN, palette: { tint: "#003030" } },
		{ ...OBSIDIAN, palette: { tint: "#000000; exit" } },
		{ ...OBSIDIAN, palette: { accent: "#050505" } },
		{ ...OBSIDIAN, palette: { accent: "#808080" } },
		{ ...OBSIDIAN, palette: { surprise: "#000000" } },
		{ ...OBSIDIAN, glass: { t3Opacity: 0.7 } },
		{ ...OBSIDIAN, glass: { t3Opacity: "0.92" } },
		{ ...OBSIDIAN, glass: { t3Opacity: null } },
		{ ...OBSIDIAN, glass: { surfaceOpacity: 0.5 } },
		{ ...OBSIDIAN, unexpected: true },
		null,
	])("rejects invalid settings before any commands or writes: %j", async (style) => {
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
		expect(result.status).toBe("invalid-manifest");
		expect(calls).toEqual([]);
		expect(fs.readdirSync(home)).toEqual([]);
	});
});

function glassFixture() {
	const home = makeHome();
	const main = path.join(home, ".config/hypr/hyprland.lua");
	fs.mkdirSync(path.dirname(main), { recursive: true });
	fs.writeFileSync(main, "-- personal Hyprland config\n");
	const source = seedTheme(home);
	const template = path.join(home, ".config/omarchy/themed/hyprland.lua.tpl");
	const sourceTemplate =
		"hl.config({ decoration = { blur = { size = 24, passes = 4 }, shadow = { range = 24 } }, cursor = { size = 24 } })\n" +
		'o.window({ tag = "terminal" }, { opacity = "1 override 1 override" })\no.window("dev\\\\.zed\\\\.Zed", { opacity = "1 override 1 override" })\n';
	fs.mkdirSync(path.dirname(template), { recursive: true });
	fs.writeFileSync(template, "-- prior user template\n");
	fs.mkdirSync(path.join(source, "themed"));
	fs.writeFileSync(
		path.join(source, "themed/hyprland.lua.tpl"),
		sourceTemplate,
	);
	fs.writeFileSync(
		path.join(source, "colors.toml"),
		'mode = "dark"\nbackground = "#0a100d"\naccent = "#62e2a4"\nred = "#f0708e"\n',
	);
	fs.writeFileSync(
		path.join(source, "t3code.json"),
		JSON.stringify({
			version: 1,
			name: "Aurora",
			colors: {
				canvas: "#0a100d",
				text: "#fdfffd",
				sidebar: "#070c0a",
				error: "#e0587a",
			},
		}),
	);
	const wallpaper = path.join(home, "personal.png");
	fs.writeFileSync(wallpaper, "personal wallpaper");
	const current = path.join(home, ".local/state/omarchy/current");
	fs.mkdirSync(current, { recursive: true });
	fs.symlinkSync(wallpaper, path.join(current, "background"));
	const calls = [];
	const options = {
		manifest: { ...MANIFEST, style: OBSIDIAN },
		home,
		versionResult: VERSION_RESULT,
		logImpl: makeLog(),
		runCommandImpl: async (argv, commandOptions) => {
			calls.push({ argv, ...commandOptions });
			const stdout =
				argv[1] === "remote"
					? REPOSITORY
					: argv[1] === "rev-parse"
						? REVISION
						: "";
			return { exitCode: 0, stdout, stderr: "" };
		},
	};
	return {
		home,
		main,
		source,
		template,
		sourceTemplate,
		wallpaper,
		calls,
		options,
		derived: `${source}-obsidian-glass`,
	};
}

describe("Obsidian Glass late precedence", () => {
	it.each([
		true,
		false,
	])("migrates or disables legacy owned state (enable %j)", async (enable) => {
		const f = glassFixture();
		const originalMain = fs.readFileSync(f.main, "utf8");
		const priorTemplate = fs.readFileSync(f.template, "utf8");
		const files = {
			"colors.toml": fs.readFileSync(
				path.join(f.source, "colors.toml"),
				"utf8",
			),
			"t3code.json": fs.readFileSync(
				path.join(f.source, "t3code.json"),
				"utf8",
			),
			"hyprland.lua.tpl":
				f.sourceTemplate +
				'\no.window("^com\\\\.t3tools\\\\.T3Code$", { opacity = "0.92 override 0.92 override" })\n',
		};
		fs.mkdirSync(f.derived);
		for (const [name, contents] of Object.entries(files))
			fs.writeFileSync(path.join(f.derived, name), contents);
		fs.writeFileSync(f.template, files["hyprland.lua.tpl"]);
		fs.writeFileSync(
			path.join(f.derived, ".haoshoku-obsidian.json"),
			JSON.stringify({
				owner: "haoshoku-obsidian-v1",
				source: f.source,
				active: true,
				priorTemplate,
				hashes: Object.fromEntries(
					Object.entries(files).map(([name, contents]) => [
						name,
						createHash("sha256").update(contents).digest("hex"),
					]),
				),
			}),
		);
		expect(
			(
				await configureOmarchyAppearance({
					...f.options,
					manifest: enable ? f.options.manifest : MANIFEST,
				})
			).status,
		).toBe("configured");
		if (enable) {
			expect(fs.readFileSync(f.main, "utf8")).not.toBe(originalMain);
			expect((await configureOmarchyAppearance(f.options)).status).toBe(
				"configured",
			);
			expect(
				(await configureOmarchyAppearance({ ...f.options, manifest: MANIFEST }))
					.status,
			).toBe("configured");
		}
		expect(fs.readFileSync(f.main, "utf8")).toBe(originalMain);
		expect(fs.readFileSync(f.template, "utf8")).toBe(priorTemplate);
	});

	it.each([
		"main-symlink",
		"unowned-loader",
	])("refuses %s before changing templates or applying", async (scenario) => {
		const f = glassFixture();
		if (scenario === "main-symlink") {
			fs.renameSync(f.main, `${f.main}.personal`);
			fs.symlinkSync(`${f.main}.personal`, f.main);
		} else
			fs.appendFileSync(
				f.main,
				"-- haoshoku-obsidian:begin\n-- custom content\n-- haoshoku-obsidian:end\n",
			);
		const before = fs.readFileSync(f.main, "utf8");
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"conflict",
		);
		expect(fs.readFileSync(f.main, "utf8")).toBe(before);
		expect(fs.readFileSync(f.template, "utf8")).toBe(
			"-- prior user template\n",
		);
		expect(f.calls.some(({ argv }) => argv[0] === "omarchy")).toBe(false);
	});

	(lua ? it : it.skip).each([3, 20, undefined])(
		"applies explicit settings after personal rules and the glass toggle (blur %j)",
		async (blurSize) => {
			const f = glassFixture();
			f.options.manifest.style = {
				...OBSIDIAN,
				glass: {
					t3Opacity: 0.904,
					...(blurSize === undefined ? {} : { blurSize }),
				},
			};
			fs.writeFileSync(
				f.main,
				`
dofile(${JSON.stringify(f.template)})
-- Personal config and persisted toggle run after the generated theme.
o.window("^com\\\\.t3tools\\\\.T3Code$", { opacity = "0.92 override 0.92 override" })
hl.config({ decoration = { blur = { enabled = true, size = 4, passes = 2,
  brightness = 0.75, xray = false }, shadow = { range = 13 } }, cursor = { size = 32 } })
o.window({ tag = "terminal" }, { opacity = "1 override 1 override" })
o.window("credential", { opacity = "1 override 1 override" })
`,
			);
			expect((await configureOmarchyAppearance(f.options)).status).toBe(
				"configured",
			);
			const execution = spawnSync(lua, ["-"], {
				encoding: "utf8",
				env: { ...process.env, HOME: f.home },
				input: `
local size, passes, enabled, brightness, xray, shadow, cursor
local opacity, terminal, credential
hl = { config = function(c)
  local d = c.decoration or {}; local b = d.blur or {}
  size = b.size or size; passes = b.passes or passes
  if b.enabled ~= nil then enabled = b.enabled end
  brightness = b.brightness or brightness
  if b.xray ~= nil then xray = b.xray end
  shadow = d.shadow and d.shadow.range or shadow
  cursor = c.cursor and c.cursor.size or cursor
end }
o = { window = function(match, rules)
  if type(match) == "table" then terminal = rules.opacity
  elseif match == "credential" then credential = rules.opacity
  elseif match:find("t3tools", 1, true) then opacity = rules.opacity end
end }
dofile(${JSON.stringify(f.main)})
print(size, passes, tostring(enabled), brightness, tostring(xray), shadow, cursor)
print(opacity); print(terminal); print(credential)
`,
			});
			expect(execution.stderr).toBe("");
			expect(execution.status).toBe(0);
			expect(
				execution.stdout
					.trim()
					.split("\n")
					.map((line) => line.split(/\s+/).join(" ")),
			).toEqual([
				`${blurSize ?? 4} 2 true 0.75 false 13 32`,
				"0.904 override 0.904 override",
				"1 override 1 override",
				"1 override 1 override",
			]);
		},
	);

	it("keeps unrelated main edits, remains idempotent and removes only its loader on disable", async () => {
		const f = glassFixture();
		const original = fs.readFileSync(f.main, "utf8");
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"configured",
		);
		const enabled = fs.readFileSync(f.main, "utf8");
		expect(enabled).not.toBe(original);
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"configured",
		);
		expect(fs.readFileSync(f.main, "utf8")).toBe(enabled);
		fs.appendFileSync(f.main, "-- unrelated later edit\n");
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"configured",
		);
		expect(fs.readFileSync(f.main, "utf8")).toBe(
			`${original}-- unrelated later edit\n${enabled.slice(original.length)}`,
		);
		expect(
			(await configureOmarchyAppearance({ ...f.options, manifest: MANIFEST }))
				.status,
		).toBe("configured");
		expect(fs.readFileSync(f.main, "utf8")).toBe(
			`${original}-- unrelated later edit\n`,
		);
		expect(fs.readFileSync(f.template, "utf8")).toBe(
			"-- prior user template\n",
		);
	});
});

describe("Obsidian Glass blur tuning", () => {
	(lua ? it : it.skip).each([1, 20, 64])(
		"applies global blur size %i without changing source, passes or unrelated sizes",
		async (blurSize) => {
			const f = glassFixture();
			f.options.manifest.style = {
				...OBSIDIAN,
				glass: { blurSize, t3Opacity: 0.904 },
			};
			expect((await configureOmarchyAppearance(f.options)).status).toBe(
				"configured",
			);
			const rendered = fs.readFileSync(f.template, "utf8");
			// Execute the generated Lua with a config collector; no compositor is touched.
			const execution = spawnSync(lua, ["-"], {
				encoding: "utf8",
				input: `
local blurSize, passes, shadow, cursor
hl = { config = function(c)
  local d = c.decoration or {}
  local b = d.blur or {}
  blurSize = b.size or blurSize
  passes = b.passes or passes
  shadow = d.shadow and d.shadow.range or shadow
  cursor = c.cursor and c.cursor.size or cursor
end }
o = { window = function() end }
${rendered}
print(blurSize, passes, shadow, cursor)
`,
			});
			expect(execution.status).toBe(0);
			expect(execution.stdout.trim().split(/\s+/)).toEqual([
				String(blurSize),
				"4",
				"24",
				"24",
			]);
			expect(rendered).toStartWith(f.sourceTemplate);
			expect(rendered).toContain('opacity = "0.904 override 0.904 override"');
			expect(
				fs.readFileSync(path.join(f.source, "themed/hyprland.lua.tpl"), "utf8"),
			).toBe(f.sourceTemplate);
			expect((await configureOmarchyAppearance(f.options)).status).toBe(
				"configured",
			);
			expect(fs.readFileSync(f.template, "utf8")).toBe(rendered);
			expect(
				fs
					.readdirSync(path.dirname(f.source))
					.filter((name) => name.includes("backup")),
			).toEqual([]);
			expect(
				(await configureOmarchyAppearance({ ...f.options, manifest: MANIFEST }))
					.status,
			).toBe("configured");
			expect(fs.readFileSync(f.template, "utf8")).toBe(
				"-- prior user template\n",
			);
		},
	);

	it("applies the opt-in preset with 9.6% transparency and rounded blur size 20", async () => {
		const f = glassFixture();
		const preset = JSON.parse(
			fs.readFileSync(
				path.resolve(
					import.meta.dir,
					"../configs/omarchy/appearance.obsidian-glass.json",
				),
				"utf8",
			),
		);
		f.options.manifest.style = preset.style;
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"configured",
		);
		const rendered = fs.readFileSync(f.template, "utf8");
		expect(rendered).toContain(
			"hl.config({ decoration = { blur = { size = 20 } } })",
		);
		expect(rendered).toContain('opacity = "0.904 override 0.904 override"');
	});

	it("leaves the source template byte-exact apart from the existing opacity addition when blur is absent", async () => {
		const f = glassFixture();
		f.options.manifest.style = { variant: "obsidian-glass" };
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"configured",
		);
		expect(fs.readFileSync(f.template, "utf8")).toBe(
			f.sourceTemplate +
				'\n-- Whole-window fallback: opacity also affects T3 text.\no.window("^com\\\\.t3tools\\\\.T3Code$", { opacity = "0.92 override 0.92 override" })\n',
		);
	});

	it.each([
		0,
		65,
		-1,
		20.4,
		"20",
		null,
		NaN,
		Infinity,
		-Infinity,
	])("rejects invalid blur size %j before commands or writes", async (blurSize) => {
		const home = makeHome();
		const calls = [];
		const warnings = [];
		const result = await configureOmarchyAppearance({
			manifest: { ...MANIFEST, style: { ...OBSIDIAN, glass: { blurSize } } },
			home,
			versionResult: VERSION_RESULT,
			logImpl: { ...makeLog(), warning: (message) => warnings.push(message) },
			runCommandImpl: async (argv) => {
				calls.push(argv);
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});
		expect(result.status).toBe("invalid-manifest");
		expect(warnings.join(" ")).toContain(
			"style.glass.blurSize must be an integer from 1 to 64",
		);
		expect(calls).toEqual([]);
		expect(fs.readdirSync(home)).toEqual([]);
	});
});

describe("owned Obsidian Glass theme", () => {
	it("derives neutral colors, preserves source and wallpaper, and delegates apply to Omarchy", async () => {
		const f = glassFixture();
		const sourceColors = fs.readFileSync(
			path.join(f.source, "colors.toml"),
			"utf8",
		);
		const result = await configureOmarchyAppearance(f.options);
		expect(result.status).toBe("configured");
		expect(result.appliedTheme).toBe("elysian-obsidian-glass");
		const colors = Bun.TOML.parse(
			fs.readFileSync(path.join(f.derived, "colors.toml"), "utf8"),
		);
		expect(colors.background).toBe("#080a0b");
		expect(colors.accent).toBe("#86edb0");
		expect(colors.red).toBe("#f0708e");
		const t3 = JSON.parse(fs.readFileSync(path.join(f.derived, "t3code.json")));
		expect(t3.colors.canvas).toBe("#080a0b");
		expect(t3.colors.text).toBe("#f2f6f3");
		expect(t3.colors.error).toBe("#e0587a");
		const template = fs.readFileSync(f.template, "utf8");
		expect(template).toStartWith(f.sourceTemplate);
		expect(template).toContain(
			'o.window("^com\\\\.t3tools\\\\.T3Code$", { opacity = "0.92 override 0.92 override" })',
		);
		expect(fs.readFileSync(path.join(f.source, "colors.toml"), "utf8")).toBe(
			sourceColors,
		);
		expect(
			f.calls.some(({ argv }) => ["fetch", "checkout"].includes(argv[1])),
		).toBe(false);
		expect(
			f.calls
				.filter(({ argv }) => argv[0] === "omarchy")
				.map(({ argv }) => argv),
		).toEqual([
			["omarchy", "theme", "set", "elysian-obsidian-glass"],
			["omarchy", "theme", "bg", "set", f.wallpaper],
			["omarchy", "font", "set", MANIFEST.font],
		]);
		expect(
			f.calls.find(({ argv }) => argv[0] === "omarchy").env
				.OMARCHY_THEME_SKIP_BACKGROUND,
		).toBe("1");
	});

	it("reruns without backup churn, backs up settings changes, and restores the prior template on disable", async () => {
		const f = glassFixture();
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"configured",
		);
		const first = fs.readFileSync(path.join(f.derived, "t3code.json"), "utf8");
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"configured",
		);
		const themes = path.dirname(f.source);
		expect(
			fs.readdirSync(themes).filter((name) => name.includes("backup")),
		).toEqual([]);
		const changed = {
			...f.options,
			manifest: {
				...MANIFEST,
				style: {
					...OBSIDIAN,
					palette: { tint: "#101010", accent: "#9af5b0" },
					glass: { t3Opacity: 1 },
				},
			},
		};
		expect((await configureOmarchyAppearance(changed)).status).toBe(
			"configured",
		);
		const backups = fs
			.readdirSync(themes)
			.filter((name) => name.includes("backup"));
		expect(backups).toHaveLength(1);
		expect(
			fs.readFileSync(path.join(themes, backups[0], "t3code.json"), "utf8"),
		).toBe(first);
		expect(fs.readFileSync(f.template, "utf8")).toContain(
			'opacity = "1 override 1 override"',
		);
		f.calls.length = 0;
		expect(
			(await configureOmarchyAppearance({ ...f.options, manifest: MANIFEST }))
				.status,
		).toBe("configured");
		expect(fs.readFileSync(f.template, "utf8")).toBe(
			"-- prior user template\n",
		);
		expect(f.calls.map(({ argv }) => argv)).toContainEqual([
			"omarchy",
			"theme",
			"bg",
			"set",
			f.wallpaper,
		]);
		expect(fs.existsSync(f.derived)).toBe(false);
		// Disabling must retire ownership so future default runs behave normally.
		fs.writeFileSync(
			path.join(f.source, "themed/hyprland.lua.tpl"),
			"-- updated source template\n",
		);
		f.calls.length = 0;
		expect(
			(await configureOmarchyAppearance({ ...f.options, manifest: MANIFEST }))
				.status,
		).toBe("configured");
		expect(fs.readFileSync(f.template, "utf8")).toBe(
			"-- updated source template\n",
		);
		expect(f.calls.map(({ argv }) => argv)).toContainEqual([
			"omarchy",
			"theme",
			"bg",
			"set",
			path.join(f.source, "backgrounds", MANIFEST.background),
		]);
	});

	it.each([
		"unowned-directory",
		"symlink",
		"edited-output",
		"edited-template",
		"dirty-source",
		"wrong-revision",
		"invalid-input",
	])("preserves and refuses %s before apply", async (scenario) => {
		const f = glassFixture();
		if (scenario.startsWith("edited"))
			expect((await configureOmarchyAppearance(f.options)).status).toBe(
				"configured",
			);
		if (scenario === "unowned-directory") fs.mkdirSync(f.derived);
		if (scenario === "symlink") fs.symlinkSync(f.source, f.derived);
		if (scenario === "edited-output")
			fs.appendFileSync(path.join(f.derived, "colors.toml"), "# local edit\n");
		if (scenario === "edited-template")
			fs.appendFileSync(f.template, "-- local edit\n");
		if (scenario === "invalid-input")
			fs.writeFileSync(path.join(f.source, "t3code.json"), "{");
		if (["dirty-source", "wrong-revision"].includes(scenario)) {
			const run = f.options.runCommandImpl;
			f.options.runCommandImpl = async (argv, opts) =>
				argv[1] === (scenario === "dirty-source" ? "status" : "rev-parse")
					? { exitCode: 0, stdout: "changed", stderr: "" }
					: run(argv, opts);
		}
		const before = fs.readFileSync(f.template, "utf8");
		f.calls.length = 0;
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"conflict",
		);
		expect(f.calls.some(({ argv }) => argv[0] === "omarchy")).toBe(false);
		expect(fs.readFileSync(f.template, "utf8")).toBe(before);
		if (scenario === "edited-template")
			expect(
				(await configureOmarchyAppearance({ ...f.options, manifest: MANIFEST }))
					.status,
			).toBe("conflict");
	});
});

describe("generated wallpaper preservation", () => {
	it("keeps wallpaper bytes when Omarchy replaces its generated current-theme directory", async () => {
		const f = glassFixture();
		const current = path.join(f.home, ".local/state/omarchy/current");
		const generated = path.join(current, "theme");
		fs.mkdirSync(generated);
		const ephemeral = path.join(generated, "chosen.jpg");
		fs.writeFileSync(ephemeral, "keep this wallpaper");
		fs.unlinkSync(path.join(current, "background"));
		fs.symlinkSync(ephemeral, path.join(current, "background"));
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (argv, options) => {
			if (argv.slice(0, 3).join(" ") === "omarchy theme set")
				fs.rmSync(generated, { recursive: true });
			if (argv.slice(0, 4).join(" ") === "omarchy theme bg set") {
				if (!fs.existsSync(argv[4]))
					return { exitCode: 1, stdout: "", stderr: "background disappeared" };
				expect(fs.readFileSync(argv[4], "utf8")).toBe("keep this wallpaper");
			}
			return run(argv, options);
		};
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"configured",
		);
	});
});

describe("appearance changes during Git probes", () => {
	it.each([
		"template",
		"derived",
	])("preserves a %s edit made after preflight", async (target) => {
		const f = glassFixture();
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"configured",
		);
		const file =
			target === "template" ? f.template : path.join(f.derived, "colors.toml");
		const run = f.options.runCommandImpl;
		f.options.manifest = {
			...MANIFEST,
			style: { ...OBSIDIAN, glass: { t3Opacity: 1 } },
		};
		f.options.runCommandImpl = async (argv, options) => {
			if (argv[1] === "rev-parse")
				fs.appendFileSync(file, "\n-- concurrent edit\n");
			return run(argv, options);
		};
		f.calls.length = 0;
		expect((await configureOmarchyAppearance(f.options)).status).toBe(
			"conflict",
		);
		expect(fs.readFileSync(file, "utf8")).toEndWith("\n-- concurrent edit\n");
		expect(f.calls.some(({ argv }) => argv[0] === "omarchy")).toBe(false);
	});
});
