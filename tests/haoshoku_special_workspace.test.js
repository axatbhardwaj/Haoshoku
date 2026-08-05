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
	it("resolves browser profile Chromium through PATH", () => {
		expect(fs.readFileSync(script, "utf8")).not.toContain("/usr/bin/chromium");
	});

	let directory;
	let log;
	let browserCall;
	let chromium;
	let focusedMonitorState;
	let specialMonitorState;
	let specialState;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-special-"));
		log = path.join(directory, "calls");
		browserCall = path.join(directory, "chromium-call");
		chromium = path.join(directory, "chromium");
		focusedMonitorState = path.join(directory, "focused-monitor-state");
		specialMonitorState = path.join(directory, "special-monitor-state");
		specialState = path.join(directory, "special-workspace-state");
		fs.writeFileSync(focusedMonitorState, "DP-1");
		fs.writeFileSync(specialMonitorState, "DP-1");
		const hyprctl = path.join(directory, "hyprctl");
		const uwsmApp = path.join(directory, "uwsm-app");
		fs.writeFileSync(
			hyprctl,
			`#!/usr/bin/env bash
if [[ -f "$SPECIAL_STATE" ]]; then state="$(< "$SPECIAL_STATE")"; else state=""; fi
focused_monitor="$(< "$FOCUSED_MONITOR_STATE")"
special_monitor="$(< "$SPECIAL_MONITOR_STATE")"
if [[ "$1 $2" == "clients -j" ]]; then
  printf '%s\\n' "$HYPR_CLIENTS"
elif [[ "$1 $2" == "monitors -j" ]]; then
  separator=""
  printf '['
  for monitor in DP-1 DP-2 HDMI-A-1; do
    if [[ "$monitor" == "$focused_monitor" ]]; then focused=true; else focused=false; fi
    if [[ -n "$state" && "$monitor" == "$special_monitor" ]]; then special="special:$state"; else special=""; fi
    printf '%s{"name":"%s","focused":%s,"specialWorkspace":{"name":"%s"}}' "$separator" "$monitor" "$focused" "$special"
    separator=,
  done
  printf ']\\n'
elif [[ "$1 $2" == "activeworkspace -j" ]]; then
  printf '{"name":"special:%s"}\\n' "$state"
elif [[ "$1" == "dispatch" && "$2" == "workspace" && "$3" == special:* ]]; then
  printf '%s' "\${3#special:}" > "$SPECIAL_STATE"
  printf '%s\\n' "$*" >> "$CALL_LOG"
elif [[ "$1" == "dispatch" && "$2" == "focusmonitor" ]]; then
  printf '%s' "$3" > "$FOCUSED_MONITOR_STATE"
  printf '%s\\n' "$*" >> "$CALL_LOG"
elif [[ "$1" == "dispatch" && "$2" == "togglespecialworkspace" ]]; then
  if [[ "$state" == "$3" ]]; then
    if [[ "$special_monitor" == "$focused_monitor" ]]; then
      : > "$SPECIAL_STATE"
    else
      printf '%s' "$focused_monitor" > "$SPECIAL_MONITOR_STATE"
    fi
  else
    printf '%s' "$3" > "$SPECIAL_STATE"
    printf '%s' "$focused_monitor" > "$SPECIAL_MONITOR_STATE"
  fi
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
		{
			clients = "[]",
			chromiumProfiles,
			focusedMonitor = "DP-1",
			visibleWorkspace,
			visibleMonitor = "DP-1",
		} = {},
	) {
		fs.writeFileSync(focusedMonitorState, focusedMonitor);
		if (visibleWorkspace !== undefined) {
			fs.writeFileSync(specialState, visibleWorkspace);
			fs.writeFileSync(specialMonitorState, visibleMonitor);
		}
		if (chromiumProfiles !== undefined) {
			fs.writeFileSync(
				path.join(directory, ".haoshoku.json"),
				JSON.stringify({ chromiumProfiles }),
			);
		}
		const proc = Bun.spawn([script, ...args], {
			env: {
				...process.env,
				HOME: directory,
				HYPR_CLIENTS: clients,
				BROWSER_CALL: browserCall,
				CALL_LOG: log,
				FOCUSED_MONITOR_STATE: focusedMonitorState,
				SPECIAL_STATE: specialState,
				SPECIAL_MONITOR_STATE: specialMonitorState,
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

	function dispatchCalls() {
		return fs.readFileSync(log, "utf8").trim().split("\n");
	}

	const fluxClient = JSON.stringify([{ class: "chromium-flux" }]);
	const agentsClient = JSON.stringify([{ class: "haoshoku-agents" }]);
	const forwardedUrl = "https://example.test/forwarded";

	it("forwards a generic browser URL without hiding it on the focused monitor", async () => {
		const result = await run(["browser", "flux", forwardedUrl], {
			clients: fluxClient,
			focusedMonitor: "DP-1",
			visibleWorkspace: "browser-flux",
			visibleMonitor: "DP-1",
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			forwardedUrl,
		]);
		expect(dispatchCalls()).toEqual(["chromium"]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-flux");
	});

	it("pulls a generic browser from another monitor after forwarding its URL", async () => {
		const result = await run(["browser", "flux", forwardedUrl], {
			clients: fluxClient,
			focusedMonitor: "DP-1",
			visibleWorkspace: "browser-flux",
			visibleMonitor: "DP-2",
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			forwardedUrl,
		]);
		expect(dispatchCalls()).toEqual([
			"chromium",
			"dispatch togglespecialworkspace browser-flux",
		]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-flux");
		expect(fs.readFileSync(specialMonitorState, "utf8")).toBe("DP-1");
	});

	it("keeps a visible browser workspace shown before launching its missing client", async () => {
		const result = await run(["browser", "flux", forwardedUrl], {
			focusedMonitor: "DP-1",
			visibleWorkspace: "browser-flux",
			visibleMonitor: "DP-1",
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
			forwardedUrl,
		]);
		expect(dispatchCalls()).not.toContain(
			"dispatch togglespecialworkspace browser-flux",
		);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-flux");
	});

	it("opens a hidden browser workspace on the focused monitor", async () => {
		const result = await run(["browser-toggle", "flux"], {
			clients: fluxClient,
			focusedMonitor: "DP-2",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch focusmonitor DP-2",
			"dispatch togglespecialworkspace browser-flux",
		]);
	});

	it("pulls a browser workspace from another monitor without hiding it", async () => {
		const result = await run(["browser-toggle", "flux"], {
			clients: fluxClient,
			focusedMonitor: "DP-2",
			visibleWorkspace: "browser-flux",
			visibleMonitor: "DP-1",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace browser-flux",
		]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-flux");
		expect(fs.readFileSync(specialMonitorState, "utf8")).toBe("DP-2");
	});

	it("hides a browser workspace visible on the focused monitor", async () => {
		const result = await run(["browser-toggle", "flux"], {
			clients: fluxClient,
			focusedMonitor: "DP-2",
			visibleWorkspace: "browser-flux",
			visibleMonitor: "DP-2",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace browser-flux",
		]);
	});

	it("falls back to the profile monitor when no monitor is focused", async () => {
		const result = await run(["browser-toggle", "flux"], {
			clients: fluxClient,
			chromiumProfiles: [
				{
					id: "flux",
					class: "chromium-flux",
					monitor: "HDMI-A-1",
					default: true,
				},
			],
			focusedMonitor: "",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch focusmonitor HDMI-A-1",
			"dispatch togglespecialworkspace browser-flux",
		]);
	});

	it("opens hidden agents on its pinned monitor", async () => {
		const result = await run(["agents"], {
			clients: agentsClient,
			focusedMonitor: "DP-1",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch focusmonitor DP-2",
			"dispatch togglespecialworkspace agents",
		]);
	});

	it("focuses visible agents on their monitor without moving them", async () => {
		const result = await run(["agents"], {
			clients: agentsClient,
			focusedMonitor: "DP-1",
			visibleWorkspace: "agents",
			visibleMonitor: "DP-2",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch focusmonitor DP-2",
		]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("agents");
		expect(fs.readFileSync(specialMonitorState, "utf8")).toBe("DP-2");
	});

	// Mutation caught: returning after cross-monitor focus leaves a visible
	// workspace empty when its client has died.
	it("relaunches missing agents after focusing their visible workspace", async () => {
		const kitty = path.join(directory, "kitty");
		fs.writeFileSync(
			kitty,
			`#!/usr/bin/env bash
printf 'kitty\\n' >> "$CALL_LOG"
`,
		);
		fs.chmodSync(kitty, 0o755);

		const result = await run(["agents"], {
			focusedMonitor: "DP-1",
			visibleWorkspace: "agents",
			visibleMonitor: "DP-2",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch focusmonitor DP-2",
			"dispatch exec [workspace special:agents silent] uwsm-app -- kitty --class haoshoku-agents bash -lc claude",
			"kitty",
		]);
	});

	it("hides agents visible on the focused monitor", async () => {
		const result = await run(["agents"], {
			clients: agentsClient,
			focusedMonitor: "DP-2",
			visibleWorkspace: "agents",
			visibleMonitor: "DP-2",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace agents",
		]);
	});

	// Mutation caught: directly backgrounding Chromium after revealing its workspace
	// lets it land on the active workspace; unescaped URL data can also become shell
	// syntax when Hyprland's string-based exec API is used.
	it("launches an absent browser through its special workspace with literal URL argv", async () => {
		const marker = path.join(directory, "hostile-url-executed");
		const hostileUrl = `https://example.test/has space;$(touch ${marker})?dollar=$HOME`;
		const result = await run(["browser-flux", hostileUrl]);

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
			(await run(["browser-toggle", "flux"])).exitCode,
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
			(await run(["browser-toggle", "defi"])).exitCode,
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
			{ chromiumProfiles },
		);

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/research`,
			"--class=chromium-research",
			"https://research.example/brief",
		]);
		expect(fs.readFileSync(log, "utf8")).toContain("dispatch focusmonitor DP-1");
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
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-research",
		]);
		expect(fs.readFileSync(log, "utf8")).toContain("dispatch focusmonitor DP-1");
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
			const result = await run([recipe, ...urls]);

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
				(await run(["browser-toggle", profile], { clients: client }))
					.exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe("");
			expect(fs.existsSync(browserCall)).toBe(false);
		});

		// Mutation caught: launching an already-running browser on a hidden
		// workspace creates a duplicate Chromium invocation instead of revealing it.
		it(`reveals a hidden existing ${profile} browser without Chromium`, async () => {
			expect(
				(await run(["browser-toggle", profile], { clients: client }))
					.exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			expect(fs.existsSync(browserCall)).toBe(false);
		});

		// Mutation caught: skipping the launch after revealing an empty workspace
		// leaves the requested profile without a Chromium client.
		it(`reveals and launches a missing ${profile} browser exactly once`, async () => {
			expect(
				(await run(["browser-toggle", profile])).exitCode,
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
				(await run(["browser", profile], { clients: client }))
					.exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			expect(fs.existsSync(browserCall)).toBe(false);
		});
	}

	// Mutation caught: confusing $monitor with $visible_monitor in the cross-monitor
	// branch focuses the pinned monitor instead of the workspace's visible monitor.
	it("focuses the monitor where a pinned workspace is actually visible", async () => {
		const result = await run(["agents"], {
			clients: agentsClient,
			focusedMonitor: "DP-1",
			visibleWorkspace: "agents",
			visibleMonitor: "HDMI-A-1",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual(["dispatch focusmonitor HDMI-A-1"]);
	});
});
