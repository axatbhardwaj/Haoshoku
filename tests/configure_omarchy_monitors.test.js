import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureOmarchyMonitors } from "../src/helpers/configure_omarchy_monitors.js";

describe("configureOmarchyMonitors", () => {
	let home;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-monitors-"));
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("writes only monitors.conf and is idempotent", async () => {
		const first = await configureOmarchyMonitors({ home, env: {} });
		const second = await configureOmarchyMonitors({ home, env: {} });
		const hypr = path.join(home, ".config", "hypr");

		expect(first).toEqual({ changed: true, backup: null, validated: false });
		expect(second).toEqual({ changed: false, backup: null, validated: false });
		expect(fs.readdirSync(hypr)).toEqual(["monitors.conf"]);
		expect(fs.readFileSync(path.join(hypr, "monitors.conf"), "utf8")).toContain(
			"monitor = DP-1,     2560x1440@143.97, 1080x240, 1",
		);
	});

	it("backs up differing monitor content before replacement", async () => {
		const hypr = path.join(home, ".config", "hypr");
		fs.mkdirSync(hypr, { recursive: true });
		fs.writeFileSync(path.join(hypr, "monitors.conf"), "old layout\n");

		const result = await configureOmarchyMonitors({
			home,
			env: {},
			now: () => 1234,
		});

		expect(result.backup).toBe(path.join(hypr, "monitors.conf.bak.1234"));
		expect(fs.readFileSync(result.backup, "utf8")).toBe("old layout\n");
	});

	it("reloads and checks config errors in an active Hyprland session", async () => {
		const commands = [];
		const result = await configureOmarchyMonitors({
			home,
			env: { HYPRLAND_INSTANCE_SIGNATURE: "test" },
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(commands).toEqual(["hyprctl reload", "hyprctl configerrors"]);
		expect(result.validated).toBe(true);
	});
});
