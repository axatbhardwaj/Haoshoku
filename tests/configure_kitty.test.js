import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	configureKitty,
	resolveKittyPaths,
} from "../src/helpers/configure_kitty.js";

describe("configureKitty", () => {
	let home;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-kitty-home-"));
	});

	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("honors XDG roots", () => {
		expect(
			resolveKittyPaths({
				home: "/h",
				env: { XDG_CONFIG_HOME: "/x/config" },
			}),
		).toEqual({
			configDir: "/x/config/kitty",
			xdgTerminalPreference: "/x/config/xdg-terminals.list",
		});
	});

	it("deploys Kitty config and both split sessions while selecting Kitty", async () => {
		await configureKitty({
			home,
			env: {},
			projectRoot: path.join(import.meta.dir, ".."),
		});

		const configDir = path.join(home, ".config", "kitty");
		for (const filename of ["kitty.conf", "haki.session", "agents.session"]) {
			expect(fs.readFileSync(path.join(configDir, filename), "utf8")).toBe(
				fs.readFileSync(
					path.join(import.meta.dir, "..", "configs", "kitty", filename),
					"utf8",
				),
			);
		}
		expect(
			fs.readFileSync(path.join(home, ".config", "xdg-terminals.list"), "utf8"),
		).toBe(
			"# Terminal emulator preference order for xdg-terminal-exec\n" +
				"# The first found and valid terminal will be used\n" +
				"kitty.desktop\n",
		);
	});

	it("lets the active Omarchy theme own Kitty opacity", async () => {
		const themeDir = path.join(home, ".config", "omarchy", "current", "theme");
		fs.mkdirSync(themeDir, { recursive: true });
		fs.writeFileSync(
			path.join(themeDir, "kitty.conf"),
			"background_opacity 0.77\nforeground #fdfffd\nbackground #010401\n",
		);

		await configureKitty({
			home,
			env: {},
			projectRoot: path.join(import.meta.dir, ".."),
		});

		const kitty = Bun.which("kitty");
		expect(kitty).not.toBeNull();
		const parsed = Bun.spawnSync(
			[
				kitty,
				"+runpy",
				"import json,sys; from kitty.config import load_config; o=load_config(sys.argv[1]); print(json.dumps({'background_opacity': o.background_opacity}))",
				path.join(home, ".config", "kitty", "kitty.conf"),
			],
			{
				env: { ...process.env, HOME: home },
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		expect(parsed.exitCode).toBe(0);
		expect(JSON.parse(parsed.stdout.toString())).toEqual({
			background_opacity: 0.77,
		});
	});

	it("guards the fish OSC fallback behind the active Omarchy theme", () => {
		const source = fs.readFileSync(
			path.join(import.meta.dir, "..", "configs", "fish", "config.fish"),
			"utf8",
		);
		expect(source).toContain(
			"if not test -r ~/.config/omarchy/current/theme/kitty.conf\n" +
				"        cat ~/.local/state/caelestia/sequences.txt 2>/dev/null\n" +
				"    end",
		);
	});

	it("captures the original preference once and is churn-free on rerun", async () => {
		const preference = path.join(home, ".config", "xdg-terminals.list");
		fs.mkdirSync(path.dirname(preference), { recursive: true });
		fs.writeFileSync(preference, "dev.warp.Warp.desktop\n");

		await configureKitty({ home, env: {} });
		const first = fs.readFileSync(preference, "utf8");
		expect(
			fs.readFileSync(`${preference}.haoshoku-first-capture`, "utf8"),
		).toBe("dev.warp.Warp.desktop\n");

		await configureKitty({ home, env: {} });
		expect(fs.readFileSync(preference, "utf8")).toBe(first);
		expect(fs.existsSync(`${preference}.tmp`)).toBe(false);
	});
});
