import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureOmarchyWorkspaces } from "../src/helpers/configure_omarchy_workspaces.js";

describe("configureOmarchyWorkspaces", () => {
	let home;
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-workspaces-"));
		fs.mkdirSync(path.join(home, ".config", "hypr"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".config", "hypr", "hyprland.conf"),
			"source = ~/.config/hypr/monitors.conf\nsource = ~/.config/hypr/bindings.conf\n",
		);
		fs.writeFileSync(
			path.join(home, ".config", "hypr", "bindings.conf"),
			"stock Omarchy bindings\n",
		);
		fs.mkdirSync(
			path.join(home, ".local", "share", "omarchy", "config", "hypr"),
			{ recursive: true },
		);
		fs.writeFileSync(
			path.join(
				home,
				".local",
				"share",
				"omarchy",
				"config",
				"hypr",
				"bindings.conf",
			),
			"stock Omarchy bindings\n",
		);
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("deploys once, preserves the main config, and installs an executable helper", async () => {
		const first = await configureOmarchyWorkspaces({ home, env: {} });
		const second = await configureOmarchyWorkspaces({ home, env: {} });
		const main = fs.readFileSync(
			path.join(home, ".config", "hypr", "hyprland.conf"),
			"utf8",
		);
		expect(first).toEqual({
			bindingsFileRestored: false,
			overlayChanged: true,
			scriptChanged: true,
			sourceChanged: true,
			validated: false,
		});
		expect(second).toEqual({
			bindingsFileRestored: false,
			overlayChanged: false,
			scriptChanged: false,
			sourceChanged: false,
			validated: false,
		});
		expect(main).toContain("source = ~/.config/hypr/monitors.conf");
		expect(
			main.match(/source = ~\/\.config\/hypr\/haoshoku-workspaces\.conf/g),
		).toHaveLength(1);
		expect(
			fs.statSync(
				path.join(home, ".local", "bin", "haoshoku-special-workspace"),
			).mode & 0o111,
		).toBe(0o111);
	});

	it("backs up a differing managed overlay", async () => {
		const overlay = path.join(
			home,
			".config",
			"hypr",
			"haoshoku-workspaces.conf",
		);
		fs.writeFileSync(overlay, "old\n");
		await configureOmarchyWorkspaces({ home, env: {}, now: () => 42 });
		expect(fs.readFileSync(`${overlay}.bak.42`, "utf8")).toBe("old\n");
	});

	it("deploys app bindings to a separate managed file without replacing Omarchy bindings", async () => {
		const stock = path.join(home, ".config", "hypr", "bindings.conf");
		const managed = path.join(
			home,
			".config",
			"hypr",
			"haoshoku-bindings.conf",
		);

		await configureOmarchyWorkspaces({ home, env: {} });

		expect(fs.existsSync(managed)).toBe(true);
		if (!fs.existsSync(managed)) return;
		expect(fs.readFileSync(stock, "utf8")).toBe("stock Omarchy bindings\n");
		expect(fs.readFileSync(managed)).toEqual(
			fs.readFileSync(
				path.join(import.meta.dir, "..", "configs", "omarchy", "bindings.conf"),
			),
		);
	});

	it("backs up differing managed app bindings before replacement", async () => {
		const managed = path.join(
			home,
			".config",
			"hypr",
			"haoshoku-bindings.conf",
		);
		fs.writeFileSync(managed, "old app bindings\n");

		await configureOmarchyWorkspaces({ home, env: {}, now: () => 42 });

		expect(fs.existsSync(`${managed}.bak.42`)).toBe(true);
		if (!fs.existsSync(`${managed}.bak.42`)) return;
		expect(fs.readFileSync(`${managed}.bak.42`, "utf8")).toBe(
			"old app bindings\n",
		);
	});

	it("restores diverged Omarchy bindings with a backup and is idempotent", async () => {
		const bindings = path.join(home, ".config", "hypr", "bindings.conf");
		const stockBindings = path.join(
			home,
			".local",
			"share",
			"omarchy",
			"config",
			"hypr",
			"bindings.conf",
		);
		fs.writeFileSync(bindings, "diverged bindings\n");

		const first = await configureOmarchyWorkspaces({
			home,
			env: {},
			now: () => 42,
		});
		const second = await configureOmarchyWorkspaces({ home, env: {} });

		expect(fs.readFileSync(`${bindings}.bak.42`, "utf8")).toBe(
			"diverged bindings\n",
		);
		expect(fs.readFileSync(bindings)).toEqual(fs.readFileSync(stockBindings));
		expect(first.bindingsFileRestored).toBe(true);
		expect(second.bindingsFileRestored).toBe(false);
		console.info(
			"Bindings restore proof: bindings.conf.bak.42 created; first restored=true; second restored=false.",
		);
	});

	it("sources managed app bindings after Omarchy bindings and before workspace toggles", async () => {
		fs.writeFileSync(
			path.join(home, ".config", "hypr", "hyprland.conf"),
			"source = ~/.config/hypr/monitors.conf\nsource = ~/.config/hypr/bindings.conf\nsource = ~/.config/hypr/haoshoku-workspaces.conf\n",
		);
		await configureOmarchyWorkspaces({ home, env: {} });
		const main = fs.readFileSync(
			path.join(home, ".config", "hypr", "hyprland.conf"),
			"utf8",
		);
		const stockIndex = main.indexOf("source = ~/.config/hypr/bindings.conf");
		const managedIndex = main.indexOf(
			"source = ~/.config/hypr/haoshoku-bindings.conf",
		);
		const workspaceIndex = main.indexOf(
			"source = ~/.config/hypr/haoshoku-workspaces.conf",
		);

		expect(managedIndex).toBeGreaterThan(stockIndex);
		expect(managedIndex).toBeLessThan(workspaceIndex);
		expect(
			main.match(/source = ~\/\.config\/hypr\/haoshoku-bindings\.conf/g),
		).toHaveLength(1);
	});

	it("refuses to invent a non-Omarchy main config", async () => {
		fs.rmSync(path.join(home, ".config", "hypr", "hyprland.conf"));
		expect(configureOmarchyWorkspaces({ home, env: {} })).rejects.toThrow(
			"config not found",
		);
	});

	it("reloads and checks errors only in a live Hyprland session", async () => {
		const commands = [];
		const result = await configureOmarchyWorkspaces({
			home,
			env: { HYPRLAND_INSTANCE_SIGNATURE: "test" },
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});
		expect(commands).toEqual([
			"hyprctl reload",
			"hyprctl configerrors",
			`'${path.join(home, ".local", "bin", "haoshoku-special-workspace")}' numbered-login 7 kitty`,
		]);
		expect(result.validated).toBe(true);
	});

	it("shell-quotes the live workspace helper path", async () => {
		const originalHome = home;
		home = `${originalHome} space;$literal`;
		fs.renameSync(originalHome, home);
		const commandDirectory = path.join(home, "test-commands");
		const dispatchLog = path.join(home, "dispatches.log");
		fs.mkdirSync(commandDirectory);
		fs.writeFileSync(
			path.join(commandDirectory, "hyprctl"),
			`#!/usr/bin/env bash
if [[ "$1 $2" == "clients -j" ]]; then
  printf '%s\\n' '[]'
elif [[ "$1" == "dispatch" ]]; then
  printf '%s\\n' "$*" >> "$DISPATCH_LOG"
fi
`,
		);
		fs.chmodSync(path.join(commandDirectory, "hyprctl"), 0o755);
		const runCommandImpl = async (command) => {
			const proc = Bun.spawn(["bash", "-c", command], {
				env: {
					...process.env,
					DISPATCH_LOG: dispatchLog,
					PATH: `${commandDirectory}:${process.env.PATH}`,
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			return (await proc.exited) === 0;
		};

		await configureOmarchyWorkspaces({
			home,
			env: { HYPRLAND_INSTANCE_SIGNATURE: "test" },
			runCommandImpl,
		});

		expect(fs.readFileSync(dispatchLog, "utf8")).toContain(
			"dispatch exec [workspace 7 silent] uwsm-app -- kitty --class haoshoku-ws7",
		);
	});

	it("ensures exactly one workspace-7 terminal across repeated live installs", async () => {
		const commandDirectory = path.join(home, "test-commands");
		const clientsState = path.join(home, "clients.json");
		const dispatchLog = path.join(home, "dispatches.log");
		fs.mkdirSync(commandDirectory);
		fs.writeFileSync(clientsState, "[]\n");
		fs.writeFileSync(
			path.join(commandDirectory, "hyprctl"),
			`#!/usr/bin/env bash
if [[ "$1 $2" == "clients -j" ]]; then
  cat "$CLIENTS_STATE"
elif [[ "$1" == "dispatch" ]]; then
  printf '%s\\n' "$*" >> "$DISPATCH_LOG"
  if [[ "$2" == "exec" ]]; then
    printf '%s\\n' '[{"address":"0xinstall","class":"haoshoku-ws7","workspace":{"name":"7"}}]' > "$CLIENTS_STATE"
  fi
fi
`,
		);
		fs.chmodSync(path.join(commandDirectory, "hyprctl"), 0o755);
		let ensureRuns = 0;
		const runCommandImpl = async (command) => {
			if (command === "hyprctl reload" || command === "hyprctl configerrors")
				return true;
			if (!command.endsWith(" numbered-login 7 kitty")) return false;
			ensureRuns += 1;
			const proc = Bun.spawn(
				[
					path.join(home, ".local", "bin", "haoshoku-special-workspace"),
					"numbered-login",
					"7",
					"kitty",
				],
				{
					env: {
						...process.env,
						HOME: home,
						CLIENTS_STATE: clientsState,
						DISPATCH_LOG: dispatchLog,
						PATH: `${commandDirectory}:${process.env.PATH}`,
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			return (await proc.exited) === 0;
		};

		await configureOmarchyWorkspaces({
			home,
			env: { HYPRLAND_INSTANCE_SIGNATURE: "test" },
			runCommandImpl,
		});
		await configureOmarchyWorkspaces({
			home,
			env: { HYPRLAND_INSTANCE_SIGNATURE: "test" },
			runCommandImpl,
		});

		expect(ensureRuns).toBe(2);
		const dispatches = fs.readFileSync(dispatchLog, "utf8").trim().split("\n");
		expect(
			dispatches.filter((dispatch) => dispatch.startsWith("dispatch exec ")),
		).toHaveLength(1);
	});
});
