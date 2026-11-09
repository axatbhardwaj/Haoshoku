import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const browserRouter = path.join(
	import.meta.dir,
	"..",
	"configs",
	"scripts",
	"haoshoku-browser",
);

describe("haoshoku-browser default-browser routing", () => {
	let directory;
	let call;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-chromium-"));
		call = path.join(directory, "special-workspace-call");
		const hyprctl = path.join(directory, "hyprctl");
		const specialWorkspace = path.join(directory, "haoshoku-special-workspace");

		fs.writeFileSync(
			hyprctl,
			`#!/usr/bin/env bash
if [[ "\${HYPR_REQUIRE_SIGNATURE:-}" == 1 && -z "\${HYPRLAND_INSTANCE_SIGNATURE:-}" ]]; then
  exit 1
fi
if [[ "$1 $2" == "clients -j" ]]; then
  printf '%s\\n' "$HYPR_CLIENTS"
fi
`,
		);
		fs.writeFileSync(
			specialWorkspace,
			`#!/usr/bin/env bash
printf '%s\\0' "$@" > "$ROUTER_CALL"
`,
		);
		fs.chmodSync(hyprctl, 0o755);
		fs.chmodSync(specialWorkspace, 0o755);
	});

	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	async function run(
		clients,
		urls,
		{ chromiumProfiles, env: extraEnv = {}, dropEnv = [] } = {},
	) {
		if (chromiumProfiles !== undefined) {
			fs.writeFileSync(
				path.join(directory, ".haoshoku.json"),
				JSON.stringify({ chromiumProfiles }),
			);
		}
		const env = {
			...process.env,
			HOME: directory,
			HYPR_CLIENTS: clients,
			PATH: `${directory}:${process.env.PATH}`,
			ROUTER_CALL: call,
			...extraEnv,
		};
		for (const key of dropEnv) {
			delete env[key];
		}
		const proc = Bun.spawn(["bash", browserRouter, ...urls], {
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		return {
			exitCode: await proc.exited,
			stderr: await new Response(proc.stderr).text(),
		};
	}

	function forwardedArguments() {
		return fs.readFileSync(call, "utf8").split("\0").filter(Boolean);
	}

	// A focused legacy custom profile must not divert URLs away from Flux.
	it("routes multiple URLs to Flux despite a more recently focused custom profile", async () => {
		const result = await run(
			JSON.stringify([
				{ class: "chromium-flux", focusHistoryID: -1 },
				{ class: "chromium-flux", focusHistoryID: 12 },
				{ class: "chromium-research", focusHistoryID: 3 },
			]),
			[
				"https://research.example/portfolio",
				"https://research.example/trade?pair=ETH%2FUSD",
			],
			{
				chromiumProfiles: [
					{ id: "flux", class: "chromium-flux", monitor: "DP-1", default: true },
					{ id: "research", class: "chromium-research", monitor: "DP-2" },
				],
			},
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://research.example/portfolio",
			"https://research.example/trade?pair=ETH%2FUSD",
		]);
	});

	// Existing custom defaults are preserved as config, not launch authority.
	it("ignores a focused secondary profile even when configured as default", async () => {
		const result = await run(
			JSON.stringify([
				{ class: "chromium-flux", focusHistoryID: 8 },
				{ class: "chromium-research", focusHistoryID: 2 },
			]),
			["https://research.example/brief"],
			{
				chromiumProfiles: [
					{
						id: "flux",
						class: "chromium-flux",
						monitor: "DP-1",
					},
					{
						id: "research",
						class: "chromium-research",
						monitor: "DP-2",
						default: true,
					},
				],
			},
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://research.example/brief",
		]);
	});

	// No running browser still means Flux, regardless of old defaults.
	it("uses Flux instead of a configured secondary default", async () => {
		const result = await run(
			JSON.stringify([{ class: "chromium-unmanaged", focusHistoryID: 0 }]),
			["https://default.example/"],
			{
				chromiumProfiles: [
					{
						id: "flux",
						class: "chromium-flux",
						monitor: "DP-1",
					},
					{
						id: "research",
						class: "chromium-research",
						monitor: "DP-2",
						default: true,
					},
				],
			},
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://default.example/",
		]);
	});

	// A registry without Flux cannot enable another managed directory.
	it("uses Flux when a zero-default custom profile is focused", async () => {
		const result = await run(
			JSON.stringify([{ class: "chromium-research", focusHistoryID: 0 }]),
			["https://research.example/zero-default"],
			{
				chromiumProfiles: [
					{
						id: "research",
						class: "chromium-research",
						monitor: "DP-2",
					},
				],
			},
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://research.example/zero-default",
		]);
	});

	// Mutation caught: choosing an arbitrary custom entry when no configured
	// default exists loses the explicit Flux compatibility fallback.
	it("falls back to Flux when a zero-default registry has no focused profile", async () => {
		const result = await run(
			JSON.stringify([{ class: "chromium-unmanaged", focusHistoryID: 0 }]),
			["https://fallback.example/zero-default"],
			{
				chromiumProfiles: [
					{
						id: "research",
						class: "chromium-research",
						monitor: "DP-2",
					},
				],
			},
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://fallback.example/zero-default",
		]);
	});

	// Mutation caught: trusting a malformed registry can route to an arbitrary
	// class; invalid configuration must restore the shipped Flux-only registry,
	// so a leftover retired DeFi window is no longer a routing target.
	it("falls back to the shipped registry when configured profiles are invalid", async () => {
		const invalidRegistry = [
			{
				id: "research;not-safe",
				class: "chromium-research",
				monitor: "DP-2",
				default: true,
			},
		];
		const result = await run(
			JSON.stringify([{ class: "chromium-defi", focusHistoryID: 0 }]),
			["https://fallback.example/"],
			{ chromiumProfiles: invalidRegistry },
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://fallback.example/",
		]);
	});

	// Mutation caught: treating a Flux window as newer than DeFi forwards the URL
	// to the wrong special workspace even though Flux owns the newest focus.
	it("routes a URL verbatim to Flux when Flux has the newest focus", async () => {
		const result = await run(
			JSON.stringify([
				{ class: "chromium-flux", focusHistoryID: 1 },
				{ class: "chromium-defi", focusHistoryID: 8 },
			]),
			["https://flux.example/research?q=one%20two"],
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://flux.example/research?q=one%20two",
		]);
	});

	// Mutation caught: no registered client falling through to an arbitrary profile
	// removes the deliberate Flux fallback for ordinary default-browser launches.
	it("falls back to Flux when no registered browser window is running", async () => {
		const result = await run(
			JSON.stringify([{ class: "chromium-notion", focusHistoryID: 0 }]),
			["https://fallback.example/"],
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://fallback.example/",
		]);
	});

	// Mutation caught: interpolating an unknown Hyprland class as shell code can
	// execute a client-controlled payload instead of ignoring that profile.
	it("ignores unknown profile classes without evaluating them as shell code", async () => {
		const marker = path.join(directory, "evaluated-unknown-profile");
		const result = await run(
			JSON.stringify([
				{
					class: `chromium-unknown$(touch ${marker})`,
					focusHistoryID: 0,
				},
			]),
			["https://safe.example/unknown-profile"],
		);

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(marker)).toBe(false);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://safe.example/unknown-profile",
		]);
	});

	// Mutation caught: evaluating a malformed Hyprland response can run embedded
	// shell syntax instead of safely taking the Flux fallback.
	it("handles malformed Hyprland JSON without evaluating it as shell code", async () => {
		const marker = path.join(directory, "evaluated-malformed-json");
		const result = await run(`not-json $(touch ${marker})`, [
			"https://safe.example/malformed-json",
		]);

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(marker)).toBe(false);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://safe.example/malformed-json",
		]);
	});

	// Portal callers without a compositor signature must still reach Flux.
	it("routes portal URLs to Flux when the Hyprland signature is unset", async () => {
		fs.mkdirSync(path.join(directory, "hypr", "abc123"), { recursive: true });
		const result = await run(
			JSON.stringify([
				{ class: "chromium-flux", focusHistoryID: 5 },
				{ class: "chromium-research", focusHistoryID: 1 },
			]),
			["https://recovered.example/"],
			{
				chromiumProfiles: [
					{ id: "flux", class: "chromium-flux", monitor: "DP-1", default: true },
					{ id: "research", class: "chromium-research", monitor: "DP-2" },
				],
				env: { HYPR_REQUIRE_SIGNATURE: "1", XDG_RUNTIME_DIR: directory },
				dropEnv: ["HYPRLAND_INSTANCE_SIGNATURE"],
			},
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://recovered.example/",
		]);
	});

	// Mutation caught: accepting jq's partial stdout after a parse failure can send
	// URLs to DeFi based on malformed client data instead of taking the Flux fallback.
	it("falls back to Flux when valid client JSON has malformed trailing data", async () => {
		const result = await run(
			`${JSON.stringify([
				{ class: "chromium-defi", focusHistoryID: 0 },
			])} trailing-garbage`,
			["https://safe.example/trailing-data"],
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser",
			"flux",
			"https://safe.example/trailing-data",
		]);
	});
});
