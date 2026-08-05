import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureOmazed } from "../src/helpers/configure_omazed.js";

const PROJECT_ROOT = path.join(import.meta.dir, "..");

describe("configureOmazed", () => {
	let home;
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-omazed-"));
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("skips when Omarchy or Omazed is unavailable", async () => {
		const commands = [];
		const result = await configureOmazed({
			home,
			commandExistsImpl: async (command) => command === "omarchy",
			runCommandImpl: async (command) => commands.push(command),
		});
		expect(result).toEqual({ configured: false, retiredLegacyTheme: false });
		expect(commands).toEqual([]);
		expect(
			fs.existsSync(path.join(home, ".local", "bin", "haoshoku-zed-glass")),
		).toBe(false);
		expect(
			fs.existsSync(
				path.join(
					home,
					".config",
					"omarchy",
					"hooks",
					"theme-set.d",
					"haoshoku-zed-glass",
				),
			),
		).toBe(false);
	});

	it("runs packaged setup then retires only the legacy Caelestia theme", async () => {
		const themes = path.join(home, ".config", "zed", "themes");
		const settings = path.join(home, ".config", "zed", "settings.json");
		fs.mkdirSync(themes, { recursive: true });
		fs.writeFileSync(path.join(themes, "caelestia.json"), "legacy");
		fs.writeFileSync(path.join(themes, "personal.json"), "keep");
		fs.writeFileSync(
			settings,
			'{"theme":{"mode":"system","dark":"Caelestia"},"autosave":"on_focus_change"}\n',
		);
		const commands = [];
		const result = await configureOmazed({
			home,
			commandExistsImpl: async () => true,
			runCommandImpl: async (command) => {
				commands.push(command);
				expect(JSON.parse(fs.readFileSync(settings, "utf8")).theme).toBe(
					"Omazed",
				);
				return true;
			},
			now: () => 42,
		});
		expect(commands).toEqual(["omazed setup"]);
		expect(result).toEqual({ configured: true, retiredLegacyTheme: true });
		expect(fs.existsSync(path.join(themes, "caelestia.json"))).toBe(false);
		expect(fs.readFileSync(path.join(themes, "personal.json"), "utf8")).toBe(
			"keep",
		);
		expect(JSON.parse(fs.readFileSync(settings, "utf8"))).toMatchObject({
			theme: "Omazed",
			autosave: "on_focus_change",
		});
		expect(fs.existsSync(`${settings}.bak.42`)).toBe(true);
	});

	it("preserves the existing Zed settings file mode", async () => {
		const settings = path.join(home, ".config", "zed", "settings.json");
		fs.mkdirSync(path.dirname(settings), { recursive: true });
		fs.writeFileSync(settings, '{"theme":"Caelestia"}\n');
		fs.chmodSync(settings, 0o600);

		await configureOmazed({
			home,
			projectRoot: PROJECT_ROOT,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => true,
		});

		expect(fs.statSync(settings).mode & 0o777).toBe(0o600);
	});

	it("deploys only the theme-set hook after packaged setup", async () => {
		const hookSource = path.join(
			PROJECT_ROOT,
			"configs",
			"omarchy",
			"hooks",
			"theme-set.d",
			"haoshoku-zed-glass",
		);
		const helperDestination = path.join(
			home,
			".local",
			"bin",
			"haoshoku-zed-glass",
		);
		const hookDestination = path.join(
			home,
			".config",
			"omarchy",
			"hooks",
			"theme-set.d",
			"haoshoku-zed-glass",
		);

		const result = await configureOmazed({
			home,
			projectRoot: PROJECT_ROOT,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => true,
		});

		expect(result).toEqual({ configured: true, retiredLegacyTheme: false });
		expect(fs.existsSync(helperDestination)).toBe(false);
		expect(fs.readFileSync(hookSource, "utf8")).toBe(
			'#!/bin/bash\n# Post-theme-set hook: restore Zed theme transparency and borders\n"$HOME/.local/bin/haoshoku-zed-glass" || true\n',
		);
		expect(fs.readFileSync(hookDestination, "utf8")).toBe(
			fs.readFileSync(hookSource, "utf8"),
		);
		expect(fs.statSync(hookDestination).mode & 0o777).toBe(0o755);
		expect(fs.statSync(hookSource).mode & 0o777).toBe(0o755);
		expect(
			fs.existsSync(
				path.join(home, ".config", "omarchy", "hooks", "theme-set"),
			),
		).toBe(false);
	});

	it("keeps the deployed hook unchanged on a second successful run", async () => {
		const hookDestination = path.join(
			home,
			".config",
			"omarchy",
			"hooks",
			"theme-set.d",
			"haoshoku-zed-glass",
		);
		const options = {
			home,
			projectRoot: PROJECT_ROOT,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => true,
			now: () => 42,
		};

		await configureOmazed(options);
		const hookContents = fs.readFileSync(hookDestination, "utf8");
		const hookMtime = fs.statSync(hookDestination).mtimeMs;

		await configureOmazed(options);

		expect(fs.readFileSync(hookDestination, "utf8")).toBe(hookContents);
		expect(fs.statSync(hookDestination).mtimeMs).toBe(hookMtime);
	});

	it("deploys the hook atomically through the injected filesystem", async () => {
		const hookDestination = path.join(
			home,
			".config",
			"omarchy",
			"hooks",
			"theme-set.d",
			"haoshoku-zed-glass",
		);
		const writes = [];
		const renames = [];
		const fsImpl = new Proxy(fs, {
			get(target, property) {
				if (property === "writeFileSync") {
					return (destination, ...args) => {
						writes.push(destination);
						return target.writeFileSync(destination, ...args);
					};
				}
				if (property === "renameSync") {
					return (source, destination) => {
						renames.push([source, destination]);
						return target.renameSync(source, destination);
					};
				}
				return Reflect.get(target, property);
			},
		});

		await configureOmazed({
			home,
			projectRoot: PROJECT_ROOT,
			fsImpl,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => true,
		});

		expect(writes).toContain(`${hookDestination}.haoshoku-tmp`);
		expect(renames).toContainEqual([
			`${hookDestination}.haoshoku-tmp`,
			hookDestination,
		]);
	});

	it("continues successfully when hook deployment fails", async () => {
		const themes = path.join(home, ".config", "zed", "themes");
		fs.mkdirSync(themes, { recursive: true });
		const legacyTheme = path.join(themes, "caelestia.json");
		fs.writeFileSync(legacyTheme, "legacy");
		const hookDestination = path.join(
			home,
			".config",
			"omarchy",
			"hooks",
			"theme-set.d",
			"haoshoku-zed-glass",
		);
		const fsImpl = new Proxy(fs, {
			get(target, property) {
				if (property === "chmodSync") {
					return (destination, mode) => {
						if (destination === hookDestination) {
							throw new Error("permission denied");
						}
						return target.chmodSync(destination, mode);
					};
				}
				return Reflect.get(target, property);
			},
		});

		const result = await configureOmazed({
			home,
			projectRoot: PROJECT_ROOT,
			fsImpl,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => true,
		});

		expect(result).toEqual({ configured: true, retiredLegacyTheme: true });
		expect(fs.existsSync(legacyTheme)).toBe(false);
	});

	it("does not overwrite the helper installed by installUserScripts", async () => {
		const homeWithSpaces = path.join(home, "space containing home");
		const helperDestination = path.join(
			homeWithSpaces,
			".local",
			"bin",
			"haoshoku-zed-glass",
		);
		const hookDestination = path.join(
			homeWithSpaces,
			".config",
			"omarchy",
			"hooks",
			"theme-set.d",
			"haoshoku-zed-glass",
		);
		const marker = path.join(homeWithSpaces, "hook-ran");
		fs.mkdirSync(path.dirname(helperDestination), { recursive: true });
		fs.writeFileSync(
			helperDestination,
			`#!/usr/bin/env bash\nprintf 'ran\\n' > ${JSON.stringify(marker)}\nexit 1\n`,
		);
		fs.chmodSync(helperDestination, 0o755);
		await configureOmazed({
			home: homeWithSpaces,
			projectRoot: PROJECT_ROOT,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => true,
		});

		const result = Bun.spawnSync(["/bin/bash", hookDestination], {
			env: { ...process.env, HOME: homeWithSpaces },
		});

		expect(fs.existsSync(marker)).toBe(true);
		expect(result.exitCode).toBe(0);
	});

	it("is idempotent after the legacy theme is gone", async () => {
		const options = {
			home,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => true,
		};
		expect(await configureOmazed(options)).toEqual({
			configured: true,
			retiredLegacyTheme: false,
		});
		expect(await configureOmazed(options)).toEqual({
			configured: true,
			retiredLegacyTheme: false,
		});
	});

	it("keeps the legacy theme when packaged setup fails", async () => {
		const themes = path.join(home, ".config", "zed", "themes");
		const settings = path.join(home, ".config", "zed", "settings.json");
		fs.mkdirSync(themes, { recursive: true });
		fs.writeFileSync(path.join(themes, "caelestia.json"), "legacy");
		const original =
			'{"theme":{"dark":"Caelestia"},"autosave":"on_focus_change"}\n';
		fs.writeFileSync(settings, original);
		const result = await configureOmazed({
			home,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => false,
		});
		expect(result).toEqual({ configured: false, retiredLegacyTheme: false });
		expect(fs.existsSync(path.join(themes, "caelestia.json"))).toBe(true);
		expect(fs.readFileSync(settings, "utf8")).toBe(original);
	});

	it("does not deploy glass files when packaged setup fails", async () => {
		const result = await configureOmazed({
			home,
			projectRoot: PROJECT_ROOT,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => false,
		});

		expect(result).toEqual({ configured: false, retiredLegacyTheme: false });
		expect(
			fs.existsSync(path.join(home, ".local", "bin", "haoshoku-zed-glass")),
		).toBe(false);
		expect(
			fs.existsSync(
				path.join(
					home,
					".config",
					"omarchy",
					"hooks",
					"theme-set.d",
					"haoshoku-zed-glass",
				),
			),
		).toBe(false);
	});
});

describe("Omazed installer wiring", () => {
	it("includes the packaged Omarchy application", () => {
		const packages = fs
			.readFileSync(
				path.join(import.meta.dir, "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);
		expect(packages).toContain("omazed");
	});

	it("configures Omazed only after Omarchy detection", () => {
		const installer = fs.readFileSync(
			path.join(import.meta.dir, "..", "src", "os_scripts", "cachyos.js"),
			"utf8",
		);
		expect(installer).toContain(
			'import { configureOmazed } from "../helpers/configure_omazed.js";',
		);
		expect(installer).toContain("if (isOmarchy) await configureOmazed();");
	});
});
