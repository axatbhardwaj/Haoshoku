import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.join(
	import.meta.dir,
	"..",
	"configs",
	"scripts",
	"haoshoku-special-workspace",
);

describe("haoshoku-special-workspace", () => {
	let directory;
	let log;
	let browserCall;
	let chromium;
	let specialState;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-special-"));
		log = path.join(directory, "calls");
		browserCall = path.join(directory, "chromium-call");
		chromium = path.join(directory, "chromium");
		specialState = path.join(directory, "special-workspace-state");
		const hyprctl = path.join(directory, "hyprctl");
		const uwsmApp = path.join(directory, "uwsm-app");
		fs.writeFileSync(
			hyprctl,
			`#!/usr/bin/env bash
if [[ -f "$SPECIAL_STATE" ]]; then state="$(< "$SPECIAL_STATE")"; else state=""; fi
if [[ "$1 $2" == "clients -j" ]]; then
  printf '%s\\n' "$HYPR_CLIENTS"
elif [[ "$1 $2" == "monitors -j" ]]; then
  printf '[{"specialWorkspace":{"name":"special:%s"}}]\\n' "$state"
elif [[ "$1 $2" == "activeworkspace -j" ]]; then
  printf '{"name":"special:%s"}\\n' "$state"
elif [[ "$1" == "dispatch" && "$2" == "workspace" && "$3" == special:* ]]; then
  printf '%s' "\${3#special:}" > "$SPECIAL_STATE"
  printf '%s\\n' "$*" >> "$CALL_LOG"
elif [[ "$1" == "dispatch" && "$2" == "togglespecialworkspace" ]]; then
  if [[ "$state" == "$3" ]]; then : > "$SPECIAL_STATE"; else printf '%s' "$3" > "$SPECIAL_STATE"; fi
  printf '%s\\n' "$*" >> "$CALL_LOG"
elif [[ "$1 $2" == "dispatch exec" ]]; then
  printf '%s\\n' "$*" >> "$CALL_LOG"
  bash -c "\${3#*] }"
else
  printf '%s\\n' "$*" >> "$CALL_LOG"
fi
`,
		);
		fs.writeFileSync(
			uwsmApp,
			`#!/usr/bin/env bash
exec "$@"
`,
		);
		fs.writeFileSync(
			chromium,
			`#!/usr/bin/env bash
printf 'chromium\\n' >> "$CALL_LOG"
printf '%s\\0' "$@" > "$BROWSER_CALL"
`,
		);
		fs.chmodSync(hyprctl, 0o755);
		fs.chmodSync(chromium, 0o755);
		fs.chmodSync(uwsmApp, 0o755);
	});
	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	async function run(
		args,
		{ clients = "[]", sandboxChromium = false, chromiumProfiles } = {},
	) {
		if (chromiumProfiles !== undefined) {
			fs.writeFileSync(
				path.join(directory, ".haoshoku.json"),
				JSON.stringify({ chromiumProfiles }),
			);
		}
		const command = sandboxChromium
			? [
					"bwrap",
					"--ro-bind",
					"/",
					"/",
					"--dev",
					"/dev",
					"--bind",
					directory,
					directory,
					"--bind",
					chromium,
					"/usr/bin/chromium",
					"--",
					script,
					...args,
				]
			: [script, ...args];
		const proc = Bun.spawn(command, {
			env: {
				...process.env,
				HOME: directory,
				HYPR_CLIENTS: clients,
				BROWSER_CALL: browserCall,
				CALL_LOG: log,
				SPECIAL_STATE: specialState,
				PATH: `${directory}:${process.env.PATH}`,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		return {
			exitCode: await proc.exited,
			stderr: await new Response(proc.stderr).text(),
		};
	}

	// Mutation caught: directly backgrounding Chromium after revealing its workspace
	// lets it land on the active workspace; unescaped URL data can also become shell
	// syntax when Hyprland's string-based exec API is used.
	it("launches an absent browser through its special workspace with literal URL argv", async () => {
		const marker = path.join(directory, "hostile-url-executed");
		const hostileUrl = `https://example.test/has space;$(touch ${marker})?dollar=$HOME`;
		const result = await run(["browser-flux", hostileUrl], {
			sandboxChromium: true,
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
			hostileUrl,
		]);
		expect(fs.existsSync(marker)).toBe(false);
		const calls = fs.readFileSync(log, "utf8").split("\n");
		const launchIndex = calls.findIndex((call) =>
			call.startsWith(
				"dispatch exec [workspace special:browser-flux silent] uwsm-app -- ",
			),
		);
		expect(launchIndex).toBeGreaterThan(
			calls.indexOf("dispatch togglespecialworkspace browser-flux"),
		);
		expect(launchIndex).toBeLessThan(calls.indexOf("chromium"));
	});

	async function chromiumArguments() {
		for (let attempt = 0; attempt < 20; attempt += 1) {
			if (fs.existsSync(browserCall))
				return fs.readFileSync(browserCall, "utf8").split("\0").filter(Boolean);
			await Bun.sleep(10);
		}
		throw new Error("Chromium was not invoked");
	}

	it("rejects unknown recipes without dispatching", async () => {
		const result = await run(["anything"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown workspace recipe");
		expect(fs.existsSync(log)).toBe(false);
	});

	it("opens Flux in its isolated Chromium profile and class", async () => {
		expect(
			(await run(["browser-toggle", "flux"], { sandboxChromium: true })).exitCode,
		).toBe(0);
		const calls = fs.readFileSync(log, "utf8");
		expect(calls).toContain("dispatch focusmonitor DP-1");
		expect(calls).toContain("dispatch togglespecialworkspace browser-flux");
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
		]);
	});

	it("opens DeFi in a different Chromium profile", async () => {
		expect(
			(await run(["browser-toggle", "defi"], { sandboxChromium: true })).exitCode,
		).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/defi`,
			"--class=chromium-defi",
		]);
	});

	// Mutation caught: hard-coding Flux and DeFi recipe branches rejects a valid
	// future profile instead of deriving its workspace and Chromium argv safely.
	it("opens a registered third profile through the generic browser command", async () => {
		const chromiumProfiles = [
			{
				id: "flux",
				class: "chromium-flux",
				monitor: "DP-1",
				default: true,
			},
			{
				id: "defi",
				class: "chromium-defi",
				monitor: "DP-1",
			},
			{
				id: "research",
				class: "chromium-research",
				monitor: "DP-2",
			},
		];
		const result = await run(
			["browser", "research", "https://research.example/brief"],
			{ chromiumProfiles, sandboxChromium: true },
		);

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/research`,
			"--class=chromium-research",
			"https://research.example/brief",
		]);
		expect(fs.readFileSync(log, "utf8")).toContain("dispatch focusmonitor DP-2");
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-research");
	});

	// Mutation caught: accepting an ID that is absent from the validated registry
	// starts an uncontrolled Chromium data directory instead of rejecting it.
	it("rejects unknown generic browser profile IDs before launching Chromium", async () => {
		const result = await run(
			["browser", "not-registered", "https://unsafe.example/"],
			{
				chromiumProfiles: [
					{
						id: "flux",
						class: "chromium-flux",
						monitor: "DP-1",
						default: true,
					},
				],
				sandboxChromium: true,
			},
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown browser profile");
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	// Mutation caught: resolving aliases only through a custom registry makes
	// existing Flux/DeFi shortcuts fail when that registry omits those IDs.
	it("uses shipped definitions for browser aliases omitted from a custom registry", async () => {
		const chromiumProfiles = [
			{
				id: "research",
				class: "chromium-research",
				monitor: "DP-2",
				default: true,
			},
		];

		for (const [recipe, id] of [
			["browser-flux", "flux"],
			["browser-defi", "defi"],
		]) {
			fs.rmSync(browserCall, { force: true });
			const result = await run([recipe], {
				chromiumProfiles,
				sandboxChromium: true,
			});

			expect(result.exitCode).toBe(0);
			expect(await chromiumArguments()).toEqual([
				`--user-data-dir=${directory}/.config/chromium-haoshoku/${id}`,
				`--class=chromium-${id}`,
			]);
		}
	});

	it("honors configured definitions for legacy browser aliases", async () => {
		const result = await run(["browser-flux"], {
			chromiumProfiles: [
				{
					id: "flux",
					class: "chromium-research",
					monitor: "DP-2",
					default: true,
				},
			],
			sandboxChromium: true,
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-research",
		]);
		expect(fs.readFileSync(log, "utf8")).toContain("dispatch focusmonitor DP-2");
	});

	for (const [recipe, profile] of [
		["browser-flux", "flux"],
		["browser-defi", "defi"],
	]) {
		// Mutation caught: sending a URL through the PATH-shadowed Chromium wrapper,
		// dropping an argument, or launching the wrong profile prevents the selected
		// browser workspace from opening the requested pages.
		it(`launches ${recipe} with every URL in its isolated profile when absent`, async () => {
			const urls = [
				"https://example.test/one?query=space%20kept",
				"https://example.test/two path#fragment",
			];
			const result = await run([recipe, ...urls], { sandboxChromium: true });

			expect(result.exitCode).toBe(0);
			expect(await chromiumArguments()).toEqual([
				`--user-data-dir=${directory}/.config/chromium-haoshoku/${profile}`,
				`--class=chromium-${profile}`,
				...urls,
			]);
		});

		// Mutation caught: retaining the launch-only class flag can cause Chromium
		// to miss the existing profile process instead of appending these URLs to it.
		it(`forwards URLs to the existing ${recipe} Chromium client before revealing it`, async () => {
			const urls = [
				"https://example.test/forward?one=1",
				"https://example.test/forward?two=2",
			];
			const result = await run([recipe, ...urls], {
				clients: JSON.stringify([{ class: `chromium-${profile}` }]),
				sandboxChromium: true,
			});

			expect(result.exitCode).toBe(0);
			expect(await chromiumArguments()).toEqual([
				`--user-data-dir=${directory}/.config/chromium-haoshoku/${profile}`,
				...urls,
			]);
			const calls = fs.readFileSync(log, "utf8").split("\n");
			expect(calls.indexOf("chromium")).toBeLessThan(
				calls.indexOf("dispatch focusmonitor DP-1"),
			);
			expect(fs.readFileSync(specialState, "utf8")).toBe(recipe);
		});
	}

	// Mutation caught: invoking Chromium with no URL creates a new browser
	// window instead of just revealing the registered profile's workspace.
	it("reveals an existing Flux browser without invoking Chromium when no URL is supplied", async () => {
		const result = await run(["browser-flux"], {
			clients: JSON.stringify([{ class: "chromium-flux" }]),
			sandboxChromium: true,
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
		expect(fs.readFileSync(log, "utf8").trim().split("\n")).toEqual([
			"dispatch focusmonitor DP-1",
			"dispatch togglespecialworkspace browser-flux",
		]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-flux");
	});

	it("rejects unexpected arguments for non-browser recipes", async () => {
		const result = await run(["music", "https://ambiguous.example/"]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("usage: haoshoku-special-workspace music");
	});

	for (const profile of ["flux", "defi"]) {
		const workspace = `browser-${profile}`;
		const client = JSON.stringify([{ class: `chromium-${profile}` }]);

		// Mutation caught: treating browser-toggle like the reveal-only browser
		// command makes an already visible workspace impossible to hide.
		it(`hides a visible ${profile} workspace through browser-toggle`, async () => {
			fs.writeFileSync(specialState, workspace);

			expect(
				(await run(["browser-toggle", profile], { clients: client, sandboxChromium: true }))
					.exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe("");
			expect(fs.existsSync(browserCall)).toBe(false);
		});

		// Mutation caught: launching an already-running browser on a hidden
		// workspace creates a duplicate Chromium invocation instead of revealing it.
		it(`reveals a hidden existing ${profile} browser without Chromium`, async () => {
			expect(
				(await run(["browser-toggle", profile], { clients: client, sandboxChromium: true }))
					.exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			expect(fs.existsSync(browserCall)).toBe(false);
		});

		// Mutation caught: skipping the launch after revealing an empty workspace
		// leaves the requested profile without a Chromium client.
		it(`reveals and launches a missing ${profile} browser exactly once`, async () => {
			expect(
				(await run(["browser-toggle", profile], { sandboxChromium: true })).exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			const calls = fs.readFileSync(log, "utf8").trim().split("\n");
			expect(calls.filter((call) => call === "chromium")).toHaveLength(1);
		});

		// Mutation caught: routing the generic browser command through toggle
		// behavior hides an already-visible workspace when no URL is provided.
		it(`keeps a visible ${profile} workspace revealed for browser with no URLs`, async () => {
			fs.writeFileSync(specialState, workspace);

			expect(
				(await run(["browser", profile], { clients: client, sandboxChromium: true }))
					.exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			expect(fs.existsSync(browserCall)).toBe(false);
		});
	}
});
