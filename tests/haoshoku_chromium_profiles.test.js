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

	// Custom registries stay on disk but cannot create a second managed profile.
	it("exposes only Flux without rewriting a custom registry", async () => {
		const chromiumProfiles = [
			{ id: "research", class: "chromium-research", monitor: "DP-2" },
		];
		const listed = await run(["list"], chromiumProfiles);
		const defaultProfile = await run(["default"], chromiumProfiles);

		expect(listed.exitCode).toBe(0);
		expect(JSON.parse(listed.stdout).map((profile) => profile.id)).toEqual([
			"flux",
		]);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(home, ".haoshoku.json"), "utf8"),
			).chromiumProfiles,
		).toEqual(chromiumProfiles);
		expect(defaultProfile.exitCode).toBe(0);
		expect(defaultProfile.stdout).toBe("flux\n");
	});

	// Neither old custom IDs nor DeFi may launch another data directory.
	it("rejects configured secondary IDs while retaining the Flux alias", async () => {
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

		expect(configured.exitCode).toBe(1);
		expect(configured.stdout).toBe("");
		expect(flux.exitCode).toBe(0);
		expect(JSON.parse(flux.stdout)).toEqual({
			id: "flux",
			class: "chromium-flux",
			monitor: "DP-1",
			default: true,
		});
		expect(defi.exitCode).toBe(1);
		expect(defi.stdout).toBe("");
	});

	it("keeps the Flux monitor but fixes its identity and default", async () => {
		const listed = await run(["list"], [
			{ id: "flux", class: "custom-flux", monitor: "DP-2" },
			{ id: "work", class: "chromium-work", monitor: "DP-1", default: true },
		]);
		expect(listed.exitCode).toBe(0);
		expect(JSON.parse(listed.stdout)).toEqual([
			{ id: "flux", class: "chromium-flux", monitor: "DP-2", default: true },
		]);
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
		]);
	});
});
