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
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("deploys Lua overlays to the v4 module paths and requires both", async () => {
		fs.writeFileSync(
			path.join(home, ".config", "hypr", "hyprland.lua"),
			"require(\"hypr.defaults\")\n",
		);

		await configureOmarchyWorkspaces({ home, env: {} });

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

	it("does not depend on the retired hyprland.conf", async () => {
		await expect(configureOmarchyWorkspaces({ home })).resolves.toEqual(
			expect.objectContaining({ sourceChanged: true }),
		);
		expect(
			fs.existsSync(path.join(home, ".config", "hypr", "hyprland.lua")),
		).toBe(true);
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

		await configureOmarchyWorkspaces({ home, fsImpl: atomicFs });
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
			configureOmarchyWorkspaces({ home, fsImpl: failingFs }),
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

		await configureOmarchyWorkspaces({
			home,
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
		await configureOmarchyWorkspaces({
			home,
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

		await configureOmarchyWorkspaces({ home });

		const requireLines = fs
			.readFileSync(main, "utf8")
			.split(/\r?\n/)
			.filter((line) => line.startsWith('require("hypr.haoshoku.'));
		expect(requireLines).toEqual([
			'require("hypr.haoshoku.bindings")',
			'require("hypr.haoshoku.workspaces")',
		]);
	});

});
