import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureOmarchyWorkspaces } from "../src/helpers/configure_omarchy_workspaces.js";

describe("configureOmarchyWorkspaces", () => {
	let home;
	const v4 = {
		env: {},
		captureCommandImpl: async () => ({
			exitCode: 0,
			stdout: "Omarchy 4.0.0\n",
		}),
	};
	const configureV4 = (options = {}) =>
		configureOmarchyWorkspaces({ home, ...v4, ...options });
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-workspaces-"));
		fs.mkdirSync(path.join(home, ".config", "hypr"), { recursive: true });
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("deploys Lua overlays to the v4 module paths and requires both", async () => {
		fs.writeFileSync(
			path.join(home, ".config", "hypr", "hyprland.lua"),
			"require(\"hypr.defaults\")\n",
		);

		await configureV4({ env: {} });

		const hyprDirectory = path.join(home, ".config", "hypr");
		expect(
			fs.readFileSync(path.join(hyprDirectory, "haoshoku", "bindings.lua")),
		).toEqual(
			fs.readFileSync(
				path.join(import.meta.dir, "..", "configs", "omarchy", "haoshoku", "bindings.lua"),
			),
		);
		expect(
			fs.readFileSync(path.join(hyprDirectory, "haoshoku", "workspaces.lua")),
		).toEqual(
			fs.readFileSync(
				path.join(
					import.meta.dir,
					"..",
					"configs",
					"omarchy",
					"haoshoku",
					"workspaces-pc.lua",
				),
			),
		);
		const main = fs.readFileSync(path.join(hyprDirectory, "hyprland.lua"), "utf8");
		expect(main).toContain('require("hypr.haoshoku.bindings")');
		expect(main).toContain('require("hypr.haoshoku.workspaces")');
		expect(
			fs.statSync(
				path.join(home, ".local", "bin", "haoshoku-special-workspace"),
			).mode & 0o111,
		).toBe(0o111);
	});

	it("refuses without writing when the v4 hyprland.lua entrypoint is absent", async () => {
		const result = await configureV4();

		expect(result).toEqual(
			expect.objectContaining({
				status: "refused",
				message: expect.stringContaining("hyprland.lua"),
			}),
		);
		expect(
			fs.existsSync(path.join(home, ".config", "hypr", "hyprland.lua")),
		).toBe(false);
		expect(fs.existsSync(path.join(home, ".config", "hypr", "haoshoku"))).toBe(
			false,
		);
		expect(fs.existsSync(path.join(home, ".local", "bin"))).toBe(false);
	});

	it("refuses Omarchy 3 before writing any workspace artifact", async () => {
		const main = path.join(home, ".config", "hypr", "hyprland.lua");
		fs.writeFileSync(main, "return {}\n");
		const result = await configureOmarchyWorkspaces({
			home,
			captureCommandImpl: async () => ({
				exitCode: 0,
				stdout: "Omarchy 3.8.5\n",
			}),
		});

		expect(result).toEqual(
			expect.objectContaining({ status: "refused", sourceChanged: false }),
		);
		expect(fs.readFileSync(main, "utf8")).toBe("return {}\n");
		expect(fs.existsSync(path.join(home, ".config", "hypr", "haoshoku"))).toBe(
			false,
		);
	});

	it("uses atomic overlay writes and leaves hyprland.lua untouched when workspace deployment fails", async () => {
		const hyprDirectory = path.join(home, ".config", "hypr");
		const workspaceDestination = path.join(
			hyprDirectory,
			"haoshoku",
			"workspaces.lua",
		);
		const liveDestinations = new Set([
			path.join(hyprDirectory, "haoshoku", "bindings.lua"),
			workspaceDestination,
			path.join(hyprDirectory, "hyprland.lua"),
			path.join(home, ".local", "bin", "haoshoku-special-workspace"),
		]);
		const writes = [];
		const atomicFs = {
			...fs,
			writeFileSync(file, ...args) {
				writes.push(file);
				if (liveDestinations.has(file))
					throw new Error(`non-atomic write to ${file}`);
				return fs.writeFileSync(file, ...args);
			},
		};

		fs.writeFileSync(path.join(hyprDirectory, "hyprland.lua"), "return {}\n");
		await configureV4({ fsImpl: atomicFs });
		expect(writes).not.toEqual(expect.arrayContaining([...liveDestinations]));

		const main = path.join(hyprDirectory, "hyprland.lua");
		fs.writeFileSync(main, "return { untouched = true }\n");
		fs.writeFileSync(workspaceDestination, "stale workspace module\n");
		const failingFs = {
			...fs,
			renameSync(from, to) {
				if (to === workspaceDestination)
					throw new Error("workspace rename failed");
				return fs.renameSync(from, to);
			},
		};

		await expect(
			configureV4({ fsImpl: failingFs }),
		).rejects.toThrow("workspace rename failed");
		expect(fs.readFileSync(main, "utf8")).toBe("return { untouched = true }\n");
	});

	it("deduplicates requires without rewriting a converged Lua deployment and uses collision-safe atomic backups", async () => {
		const hyprDirectory = path.join(home, ".config", "hypr");
		const overlayDirectory = path.join(hyprDirectory, "haoshoku");
		const destinations = [
			path.join(overlayDirectory, "bindings.lua"),
			path.join(overlayDirectory, "workspaces.lua"),
			path.join(home, ".local", "bin", "haoshoku-special-workspace"),
			path.join(hyprDirectory, "hyprland.lua"),
		];
		for (const destination of destinations.slice(0, -1)) {
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.writeFileSync(destination, `old ${path.basename(destination)}\n`);
			fs.writeFileSync(`${destination}.bak.42`, "previous collision\n");
		}
		fs.writeFileSync(
			destinations.at(-1),
			'return { foreign = true }\nrequire("hypr.haoshoku.bindings")\nrequire("hypr.haoshoku.bindings")\nrequire("hypr.haoshoku.workspaces")',
		);
		fs.writeFileSync(`${destinations.at(-1)}.bak.42`, "previous collision\n");

		const writes = [];
		const renames = [];
		const recordingFs = {
			...fs,
			writeFileSync(file, ...args) {
				writes.push(file);
				return fs.writeFileSync(file, ...args);
			},
			renameSync(from, to) {
				renames.push({ from, to });
				return fs.renameSync(from, to);
			},
		};

		await configureV4({
			fsImpl: recordingFs,
			now: () => 42,
		});

		for (const destination of destinations) {
			expect(fs.existsSync(`${destination}.bak.42`)).toBe(true);
			expect(fs.existsSync(`${destination}.bak.42.1`)).toBe(true);
		}
		const main = fs.readFileSync(destinations.at(-1), "utf8");
		expect(main).toContain("return { foreign = true }");
		expect(main.match(/require\("hypr\.haoshoku\.bindings"\)/g)).toHaveLength(1);
		expect(main.match(/require\("hypr\.haoshoku\.workspaces"\)/g)).toHaveLength(1);
		const requireLines = main
			.split(/\r?\n/)
			.filter((line) => line.startsWith('require("hypr.haoshoku.'));
		expect(requireLines).toHaveLength(2);
		expect(requireLines).toEqual([
			'require("hypr.haoshoku.bindings")',
			'require("hypr.haoshoku.workspaces")',
		]);
		expect(writes).not.toEqual(expect.arrayContaining(renames.map(({ to }) => to)));

		writes.length = 0;
		renames.length = 0;
		await configureV4({
			fsImpl: recordingFs,
			now: () => 42,
		});
		expect(writes).toEqual([]);
		expect(renames).toEqual([]);
	});

	it("rewrites reversed unique requires so bindings load before workspaces", async () => {
		const main = path.join(home, ".config", "hypr", "hyprland.lua");
		fs.writeFileSync(
			main,
			'require("hypr.defaults")\nrequire("hypr.haoshoku.workspaces")\nrequire("hypr.haoshoku.bindings")\n',
		);

		await configureV4();

		const requireLines = fs
			.readFileSync(main, "utf8")
			.split(/\r?\n/)
			.filter((line) => line.startsWith('require("hypr.haoshoku.'));
		expect(requireLines).toEqual([
			'require("hypr.haoshoku.bindings")',
			'require("hypr.haoshoku.workspaces")',
		]);
	});

	it("reloads and replays the exec-once workspace launcher in an active session with shell escaping", async () => {
		const quotedHome = `${home}'active`;
		fs.renameSync(home, quotedHome);
		home = quotedHome;
		const main = path.join(home, ".config", "hypr", "hyprland.lua");
		fs.writeFileSync(main, "return {}\n");
		const calls = [];

		const result = await configureV4({
			env: { HYPRLAND_INSTANCE_SIGNATURE: "active" },
			runCommandImpl: async (command) => {
				calls.push(command);
				return true;
			},
		});

		const script = path.join(
			home,
			".local",
			"bin",
			"haoshoku-special-workspace",
		);
		expect(calls).toEqual([
			"hyprctl reload",
			`'${script.replaceAll("'", "'\\''")}' numbered-login 7 kitty`,
		]);
		expect(result).toEqual(
			expect.objectContaining({ reloaded: true, replayed: true }),
		);
	});

});
