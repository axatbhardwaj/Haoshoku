import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	configureGhostty,
	resolveGhosttyPaths,
} from "../src/helpers/configure_ghostty.js";

describe("configureGhostty", () => {
	let home;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-ghostty-home-"));
	});

	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("honors XDG roots", () => {
		expect(
			resolveGhosttyPaths({
				home: "/h",
				env: { XDG_CONFIG_HOME: "/x/config" },
			}),
		).toEqual({
			configDir: "/x/config/ghostty",
			xdgTerminalPreference: "/x/config/xdg-terminals.list",
		});
	});

	it("deploys the Ghostty config while selecting Ghostty", async () => {
		await configureGhostty({
			home,
			env: {},
			projectRoot: path.join(import.meta.dir, ".."),
		});

		const configDir = path.join(home, ".config", "ghostty");
		expect(fs.readFileSync(path.join(configDir, "config"), "utf8")).toBe(
			fs.readFileSync(
				path.join(import.meta.dir, "..", "configs", "ghostty", "config"),
				"utf8",
			),
		);
		expect(
			fs.readFileSync(path.join(home, ".config", "xdg-terminals.list"), "utf8"),
		).toBe(
			"# Terminal emulator preference order for xdg-terminal-exec\n" +
				"# The first found and valid terminal will be used\n" +
				"com.mitchellh.ghostty.desktop\n",
		);
	});

	it("follows the active Omarchy theme while owning background opacity", async () => {
		await configureGhostty({
			home,
			env: {},
			projectRoot: path.join(import.meta.dir, ".."),
		});

		const deployedConfig = fs.readFileSync(
			path.join(home, ".config", "ghostty", "config"),
			"utf8",
		);
		expect(deployedConfig).toMatch(
			/^config-file = \?"~\/\.local\/state\/omarchy\/current\/theme\/ghostty\.conf"[ \t]*$/m,
		);
		const opacity = deployedConfig.match(
			/^background-opacity[ \t]*=[ \t]*(\S+)[ \t]*$/m,
		);
		expect(opacity).not.toBeNull();
		expect(opacity[1]).toBe("0.70");
	});

	it("guards the fish OSC fallback behind the active Omarchy theme", () => {
		const source = fs.readFileSync(
			path.join(import.meta.dir, "..", "configs", "fish", "config.fish"),
			"utf8",
		);
		expect(source).toContain(
			"if not test -r ~/.local/state/omarchy/current/theme/ghostty.conf\n" +
				"        cat ~/.local/state/caelestia/sequences.txt 2>/dev/null\n" +
				"    end",
		);
	});

	it("captures the original preference once and is churn-free on rerun", async () => {
		const preference = path.join(home, ".config", "xdg-terminals.list");
		fs.mkdirSync(path.dirname(preference), { recursive: true });
		fs.writeFileSync(preference, "dev.warp.Warp.desktop\n");

		await configureGhostty({ home, env: {} });
		const first = fs.readFileSync(preference, "utf8");
		expect(
			fs.readFileSync(`${preference}.haoshoku-first-capture`, "utf8"),
		).toBe("dev.warp.Warp.desktop\n");

		await configureGhostty({ home, env: {} });
		expect(fs.readFileSync(preference, "utf8")).toBe(first);
		expect(fs.existsSync(`${preference}.tmp`)).toBe(false);
	});
});
