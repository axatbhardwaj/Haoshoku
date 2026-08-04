import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const router = path.join(
	import.meta.dir,
	"..",
	"configs",
	"scripts",
	"chromium",
);

describe("Chromium default-browser routing", () => {
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

	async function run(clients, urls) {
		const proc = Bun.spawn(["bash", router, ...urls], {
			env: {
				...process.env,
				HYPR_CLIENTS: clients,
				PATH: `${directory}:${process.env.PATH}`,
				ROUTER_CALL: call,
			},
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

	// Mutation caught: accepting a negative ID, choosing the largest ID, or taking
	// the first match sends default-browser URLs to a stale profile instead of the
	// registered profile with the smallest non-negative focus-history ID.
	it("routes multiple URLs to the registered window with the smallest focus history ID", async () => {
		const result = await run(
			JSON.stringify([
				{ class: "chromium-flux", focusHistoryID: -1 },
				{ class: "chromium-flux", focusHistoryID: 12 },
				{ class: "chromium-defi", focusHistoryID: 3 },
			]),
			[
				"https://app.defi.example/portfolio",
				"https://app.defi.example/trade?pair=ETH%2FUSD",
			],
		);

		expect(result.exitCode).toBe(0);
		expect(forwardedArguments()).toEqual([
			"browser-defi",
			"https://app.defi.example/portfolio",
			"https://app.defi.example/trade?pair=ETH%2FUSD",
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
			"browser-flux",
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
			"browser-flux",
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
			"browser-flux",
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
			"browser-flux",
			"https://safe.example/malformed-json",
		]);
	});
});
