import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const profileHelper = path.join(
	import.meta.dir,
	"..",
	"configs",
	"scripts",
	"haoshoku-chromium-profiles",
);

describe("haoshoku-chromium-profiles", () => {
	let home;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-profiles-query-"));
	});

	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	async function run(args, chromiumProfiles) {
		if (chromiumProfiles !== undefined) {
			fs.writeFileSync(
				path.join(home, ".haoshoku.json"),
				JSON.stringify({ chromiumProfiles }),
			);
		}
		const proc = Bun.spawn(["bash", profileHelper, ...args], {
			env: { ...process.env, HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		});
		return {
			exitCode: await proc.exited,
			stdout: await new Response(proc.stdout).text(),
			stderr: await new Response(proc.stderr).text(),
		};
	}

	// Mutation caught: treating zero defaults as malformed loses custom profiles
	// and does not expose the documented Flux fallback through the query API.
	it("lists a valid zero-default registry and falls back to Flux", async () => {
		const chromiumProfiles = [
			{ id: "research", class: "chromium-research", monitor: "DP-2" },
		];
		const listed = await run(["list"], chromiumProfiles);
		const defaultProfile = await run(["default"], chromiumProfiles);

		expect(listed.exitCode).toBe(0);
		expect(JSON.parse(listed.stdout)).toEqual(chromiumProfiles);
		expect(defaultProfile.exitCode).toBe(0);
		expect(defaultProfile.stdout).toBe("flux\n");
	});

	// Mutation caught: legacy aliases that resolve only against a custom list
	// become unknown instead of using their shipped Flux/DeFi definitions.
	it("returns configured entries and shipped compatibility aliases", async () => {
		const chromiumProfiles = [
			{
				id: "research",
				class: "chromium-research",
				monitor: "DP-2",
				default: true,
			},
		];
		const configured = await run(["get", "research"], chromiumProfiles);
		const flux = await run(["get", "flux"], chromiumProfiles);
		const defi = await run(["get", "defi"], chromiumProfiles);

		expect(configured.exitCode).toBe(0);
		expect(JSON.parse(configured.stdout)).toEqual(chromiumProfiles[0]);
		expect(flux.exitCode).toBe(0);
		expect(JSON.parse(flux.stdout)).toEqual({
			id: "flux",
			class: "chromium-flux",
			monitor: "DP-1",
			default: true,
		});
		expect(defi.exitCode).toBe(0);
		expect(JSON.parse(defi.stdout)).toEqual({
			id: "defi",
			class: "chromium-defi",
			monitor: "DP-1",
		});
	});

	it("rejects multiple defaults by returning the shipped registry", async () => {
		const listed = await run(["list"], [
			{
				id: "flux",
				class: "chromium-flux",
				monitor: "DP-1",
				default: true,
			},
			{
				id: "research",
				class: "chromium-research",
				monitor: "DP-2",
				default: true,
			},
		]);

		expect(listed.exitCode).toBe(0);
		expect(JSON.parse(listed.stdout)).toEqual([
			{
				id: "flux",
				class: "chromium-flux",
				monitor: "DP-1",
				default: true,
			},
			{ id: "defi", class: "chromium-defi", monitor: "DP-1" },
		]);
	});
});
