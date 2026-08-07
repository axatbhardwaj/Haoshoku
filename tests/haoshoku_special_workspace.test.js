import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as chromiumProfileConfig from "../src/helpers/configure_chromium_profiles.js";

const script = path.join(
	import.meta.dir,
	"..",
	"configs",
	"scripts",
	"haoshoku-special-workspace",
);
const workspacesConfig = fs.readFileSync(
	path.join(import.meta.dir, "..", "configs", "omarchy", "workspaces.conf"),
	"utf8",
);
const caelestiaConfigDirectory = path.join(
	import.meta.dir,
	"..",
	"configs",
	"caelestia",
);

function configuredWorkspaceArgs(pattern) {
	const args = workspacesConfig.match(pattern)?.groups?.args;
	if (!args)
		throw new Error(`missing configured workspace command: ${pattern}`);
	return args.trim().split(/\s+/);
}

function configuredCaelestiaWorkspaceArgs(file) {
	const config = fs.readFileSync(
		path.join(caelestiaConfigDirectory, file),
		"utf8",
	);
	const args = config.match(
		/^exec-once = \/home\/xzat\/\.local\/bin\/haoshoku-special-workspace (?<args>.+)$/m,
	)?.groups?.args;
	if (!args) throw new Error(`missing Caelestia workspace login command: ${file}`);
	return args.trim().split(/\s+/);
}

describe("haoshoku-special-workspace", () => {
	it("resolves browser profile Chromium through PATH", () => {
		expect(fs.readFileSync(script, "utf8")).not.toContain("/usr/bin/chromium");
	});

	it("guards every special-workspace recipe configuration", () => {
		const recipeScript = fs.readFileSync(process.env.SCRIPT ?? script, "utf8");
		const recipeCaseBlock = recipeScript.match(
			/case "\$recipe" in\n(?<recipes>[\s\S]*?)\n\s*\*\)/,
		)?.groups?.recipes;
		expect(recipeCaseBlock).toBeDefined();

		const recipes = Object.fromEntries(
			[
				...recipeCaseBlock.matchAll(
					/^\s*(?<recipe>[^)\s]+)\)\s*workspace=(?<workspace>[^;]+);\s*monitor=(?<monitor>[^;]+)(?:;\s*follows_focus=(?<followsFocus>true|false))?\s*;;$/gm,
				),
			].map(({ groups }) => [
				groups.recipe,
				{
					workspace: groups.workspace.trim(),
					monitor: groups.monitor.trim(),
					followsFocus: groups.followsFocus === "true",
				},
			]),
		);
		const expectedRecipes = {
			haki: { workspace: "haki", monitor: "DP-2", followsFocus: false },
			assistants: {
				workspace: "assistants",
				monitor: "DP-2",
				followsFocus: false,
			},
			music: { workspace: "music", monitor: "DP-1", followsFocus: false },
			"1password": {
				workspace: "1password",
				monitor: "DP-1",
				followsFocus: false,
			},
			communication: {
				workspace: "communication",
				monitor: "HDMI-A-1",
				followsFocus: false,
			},
			stash: { workspace: "stash", monitor: "DP-1", followsFocus: false },
			x: { workspace: "x", monitor: "DP-2", followsFocus: false },
			youtube: { workspace: "youtube", monitor: "DP-1", followsFocus: true },
			crunchyroll: {
				workspace: "crunchyroll",
				monitor: "DP-1",
				followsFocus: true,
			},
			reanime: {
				workspace: "reanime",
				monitor: "DP-1",
				followsFocus: true,
			},
		};

		expect(Object.keys(recipes).sort()).toEqual(
			Object.keys(expectedRecipes).sort(),
		);
		for (const [recipe, expected] of Object.entries(expectedRecipes)) {
			expect({ [recipe]: recipes[recipe] }).toEqual({ [recipe]: expected });
		}
	});

	let directory;
	let log;
	let browserCall;
	let chromium;
	let claudeDesktop;
	let focusedMonitorState;
	let kittyCall;
	let specialMonitorState;
	let specialState;
	let tmuxLog;
	let tmuxState;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-special-"));
		log = path.join(directory, "calls");
		browserCall = path.join(directory, "chromium-call");
		chromium = path.join(directory, "chromium");
		claudeDesktop = path.join(directory, ["claude", "desktop"].join("-"));
		focusedMonitorState = path.join(directory, "focused-monitor-state");
		kittyCall = path.join(directory, "kitty-call");
		specialMonitorState = path.join(directory, "special-monitor-state");
		specialState = path.join(directory, "special-workspace-state");
		tmuxLog = path.join(directory, "tmux-call");
		tmuxState = path.join(directory, "tmux-session");
		fs.writeFileSync(focusedMonitorState, "DP-1");
		fs.writeFileSync(specialMonitorState, "DP-1");
		const hyprctl = path.join(directory, "hyprctl");
		const uwsmApp = path.join(directory, "uwsm-app");
		const helperDirectory = path.join(directory, ".local", "bin");
		fs.mkdirSync(helperDirectory, { recursive: true });
		const helper = path.join(helperDirectory, "haoshoku-claude-remote-control");
		const unitDirectory = path.join(directory, ".config", "systemd", "user");
		fs.mkdirSync(unitDirectory, { recursive: true });
		fs.writeFileSync(
			path.join(unitDirectory, "claude-remote-control@.service"),
			"[Service]\n",
		);
		const environmentDirectory = path.join(
			directory,
			".config",
			"haoshoku",
			"claude-remote-control",
		);
		fs.mkdirSync(environmentDirectory, { recursive: true });
		fs.writeFileSync(
			path.join(environmentDirectory, "haki.env"),
			`CLAUDE_REMOTE_CONTROL_ROOT=${JSON.stringify(directory)}\n`,
		);
		fs.writeFileSync(
			path.join(directory, ".haoshoku.json"),
			JSON.stringify({ claudeSessionName: "io-haki" }),
		);
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
		fs.writeFileSync(
			claudeDesktop,
			`#!/usr/bin/env bash
printf 'claude\n' >> "$CALL_LOG"
`,
		);
		fs.writeFileSync(
			helper,
			`#!/usr/bin/env bash
case "$1" in
  has-session|attach) exit 0 ;;
  *) exit 1 ;;
esac
`,
		);
		fs.writeFileSync(
			path.join(directory, "systemctl"),
			"#!/usr/bin/env bash\nexit 0\n",
		);
		fs.chmodSync(hyprctl, 0o755);
		fs.chmodSync(claudeDesktop, 0o755);
		fs.chmodSync(chromium, 0o755);
		fs.chmodSync(helper, 0o755);
		fs.chmodSync(path.join(directory, "systemctl"), 0o755);
		fs.chmodSync(uwsmApp, 0o755);
	});
	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	async function run(
		args,
		{
			clients = "[]",
			chromiumProfiles,
			env = {},
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
				KITTY_CALL: kittyCall,
				SPECIAL_STATE: specialState,
				SPECIAL_MONITOR_STATE: specialMonitorState,
				TMUX_LOG: tmuxLog,
				TMUX_STATE: tmuxState,
				PATH: `${directory}:${process.env.PATH}`,
				...env,
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

	function installKittyArgumentRecorder() {
		fs.writeFileSync(
			path.join(directory, "kitty"),
			'#!/usr/bin/env bash\nprintf \'%s\\0\' "$@" > "$KITTY_CALL"\n',
		);
		fs.chmodSync(path.join(directory, "kitty"), 0o755);
	}

	function kittyArguments() {
		if (!fs.existsSync(kittyCall)) return null;
		const argv = fs.readFileSync(kittyCall, "utf8").split("\0");
		if (argv.at(-1) === "") argv.pop();
		return argv;
	}

	function installRawSessionNameJqBypass() {
		const realJq = Bun.which("jq");
		if (!realJq) throw new Error("missing test dependency: jq");
		fs.writeFileSync(
			path.join(directory, "jq"),
			`#!/usr/bin/env bash
if (( $# > 0 )) && [[ "\${!#}" == "$HOME/.haoshoku.json" ]]; then
  printf '%s\\n' "$RAW_CLAUDE_SESSION_NAME"
else
  exec ${JSON.stringify(realJq)} "$@"
fi
`,
		);
		fs.chmodSync(path.join(directory, "jq"), 0o755);
	}

	function printableArguments(argv) {
		return argv?.map((argument) =>
			argument.length > 80
				? {
						length: argument.length,
						prefix: argument.slice(0, 24),
						suffix: argument.slice(-24),
					}
				: argument,
		);
	}

	const fluxClient = JSON.stringify([{ class: "chromium-flux" }]);
	const hakiClient = JSON.stringify([{ class: "haoshoku-haki" }]);
	const xClient = JSON.stringify([{ class: "chrome-x.com__-Default" }]);
	const forwardedUrl = "https://example.test/forwarded";
	const claudeClass = "com.anthropic.Claude";
	const chatgptClass = "chrome-chatgpt.com__-Default";

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

	it("forwards browser-toggle URLs while keeping a visible workspace shown", async () => {
		const urls = [
			"https://example.test/toggle-one",
			"https://example.test/toggle-two",
		];
		const result = await run(["browser-toggle", "flux", ...urls], {
			clients: fluxClient,
			focusedMonitor: "DP-2",
			visibleWorkspace: "browser-flux",
			visibleMonitor: "DP-2",
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			...urls,
		]);
		expect(dispatchCalls()).toEqual(["chromium"]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-flux");
	});

	// Mutation caught: a visible browser-toggle URL request must not hide an
	// empty workspace or launch Chromium outside its special workspace.
	it("launches a missing visible browser-toggle client through its special workspace", async () => {
		const result = await run(
			["browser-toggle", "flux", "https://example.test/missing-toggle-client"],
			{
				focusedMonitor: "DP-2",
				visibleWorkspace: "browser-flux",
				visibleMonitor: "DP-2",
			},
		);

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
			"https://example.test/missing-toggle-client",
		]);
		expect(dispatchCalls()).toEqual([
			"dispatch exec [workspace special:browser-flux silent] uwsm-app -- chromium --user-data-dir=" +
				`${directory}/.config/chromium-haoshoku/flux --class=chromium-flux https://example.test/missing-toggle-client `,
			"chromium",
		]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-flux");
	});

	// Mutation caught: removing the browser-client guard must not hide a visible
	// workspace whose registered profile client is absent.
	it("launches a missing visible browser-toggle client without a URL instead of hiding", async () => {
		const result = await run(["browser-toggle", "flux"], {
			clients: JSON.stringify([{ class: "some-other-window" }]),
			focusedMonitor: "DP-2",
			visibleWorkspace: "browser-flux",
			visibleMonitor: "DP-2",
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
		]);
		expect(dispatchCalls()).toEqual([
			"dispatch exec [workspace special:browser-flux silent] uwsm-app -- chromium --user-data-dir=" +
				`${directory}/.config/chromium-haoshoku/flux --class=chromium-flux `,
			"chromium",
		]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-flux");
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

	for (const recipe of ["youtube", "crunchyroll"]) {
		const clients = JSON.stringify([
			{
				class:
					recipe === "youtube"
						? "chrome-youtube.com__-Default"
						: "chrome-www.crunchyroll.com__-Default",
			},
		]);

		it(`opens hidden ${recipe} on the focused monitor`, async () => {
			const result = await run([recipe], {
				clients,
				focusedMonitor: "DP-2",
			});

			expect(result.exitCode).toBe(0);
			expect(dispatchCalls()).toContain("dispatch focusmonitor DP-2");
			expect(dispatchCalls()).toContain(
				`dispatch togglespecialworkspace ${recipe}`,
			);
		});

		it(`moves visible ${recipe} to the focused monitor`, async () => {
			const result = await run([recipe], {
				clients,
				focusedMonitor: "DP-2",
				visibleWorkspace: recipe,
				visibleMonitor: "DP-1",
			});

			expect(result.exitCode).toBe(0);
			expect(dispatchCalls()).toContain(
				`dispatch togglespecialworkspace ${recipe}`,
			);
			expect(fs.readFileSync(specialMonitorState, "utf8")).toBe("DP-2");
		});

		it(`hides ${recipe} visible on the focused monitor`, async () => {
			const result = await run([recipe], {
				clients,
				focusedMonitor: "DP-1",
				visibleWorkspace: recipe,
				visibleMonitor: "DP-1",
			});

			expect(result.exitCode).toBe(0);
			expect(dispatchCalls()).toContain(
				`dispatch togglespecialworkspace ${recipe}`,
			);
		});
	}

	it("falls back to DP-1 for youtube when no monitor is focused", async () => {
		const result = await run(["youtube"], {
			clients: JSON.stringify([{ class: "chrome-youtube.com__-Default" }]),
			focusedMonitor: "",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toContain("dispatch focusmonitor DP-1");
	});

	it("toggles Re:ANIME on the focused monitor without relaunching its exact client", async () => {
		const result = await run(["reanime"], {
			clients: JSON.stringify([{ class: "chrome-reanime.to__home-Default" }]),
			focusedMonitor: "DP-2",
		});

		expect({
			exitCode: result.exitCode,
			chromiumStarted: fs.existsSync(browserCall),
			dispatches: fs.existsSync(log) ? dispatchCalls() : [],
		}).toEqual({
			exitCode: 0,
			chromiumStarted: false,
			dispatches: [
				"dispatch focusmonitor DP-2",
				"dispatch togglespecialworkspace reanime",
			],
		});
	});

	it("opens the hidden Haki session on its pinned monitor", async () => {
		const result = await run(["haki"], {
			clients: hakiClient,
			focusedMonitor: "DP-1",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch focusmonitor DP-2",
			"dispatch togglespecialworkspace haki",
		]);
	});

	it("resumes the configured io-haki conversation locally and never touches systemd", async () => {
		const systemctlCall = path.join(directory, "systemctl-call");
		fs.writeFileSync(
			path.join(directory, "systemctl"),
			`#!/usr/bin/env bash
: > ${JSON.stringify(systemctlCall)}
exit 17
`,
		);
		fs.writeFileSync(
			path.join(directory, "kitty"),
			`#!/usr/bin/env bash
printf 'terminal:%s\\n' "$*" >> "$CALL_LOG"
shift 4
exec "$@"
`,
		);
		fs.writeFileSync(
			path.join(directory, "claude"),
			"#!/usr/bin/env bash\nprintf 'claude:started\\n' >> \"$CALL_LOG\"\n",
		);
		for (const executable of ["systemctl", "kitty", "claude"]) {
			fs.chmodSync(path.join(directory, executable), 0o755);
		}

		const result = await run(["haki"]);

		expect({
			exitCode: result.exitCode,
			stderr: result.stderr,
			dispatches: dispatchCalls(),
			systemctlCalled: fs.existsSync(systemctlCall),
		}).toEqual({
			exitCode: 0,
			stderr: "",
			dispatches: [
				"dispatch focusmonitor DP-2",
				"dispatch togglespecialworkspace haki",
				`dispatch exec [workspace special:haki silent] uwsm-app -- kitty --class haoshoku-haki -d ${directory} claude -r io-haki `,
				`terminal:--class haoshoku-haki -d ${directory} claude -r io-haki`,
				"claude:started",
			],
			systemctlCalled: false,
		});
	});

	it("honors a portable configured Haki session name", async () => {
		fs.writeFileSync(
			path.join(directory, ".haoshoku.json"),
			JSON.stringify({ claudeSessionName: "portable-haki" }),
		);
		fs.writeFileSync(
			path.join(directory, "kitty"),
			'#!/usr/bin/env bash\nprintf \'terminal:%s\\n\' "$*" >> "$CALL_LOG"\n',
		);
		fs.chmodSync(path.join(directory, "kitty"), 0o755);

		const result = await run(["haki"]);

		expect({
			exitCode: result.exitCode,
			stderr: result.stderr,
			dispatches: dispatchCalls(),
		}).toEqual({
			exitCode: 0,
			stderr: "",
			dispatches: [
				"dispatch focusmonitor DP-2",
				"dispatch togglespecialworkspace haki",
				`dispatch exec [workspace special:haki silent] uwsm-app -- kitty --class haoshoku-haki -d ${directory} claude -r portable-haki `,
				`terminal:--class haoshoku-haki -d ${directory} claude -r portable-haki`,
			],
		});
	});

	it("starts a useful plain Claude session when no Haki session is configured", async () => {
		fs.rmSync(path.join(directory, ".haoshoku.json"));
		fs.writeFileSync(
			path.join(directory, "kitty"),
			'#!/usr/bin/env bash\nprintf \'terminal:%s\\n\' "$*" >> "$CALL_LOG"\n',
		);
		fs.chmodSync(path.join(directory, "kitty"), 0o755);

		const result = await run(["haki"]);

		expect({
			exitCode: result.exitCode,
			stderr: result.stderr,
			dispatches: dispatchCalls(),
		}).toEqual({
			exitCode: 0,
			stderr: "",
			dispatches: [
				"dispatch focusmonitor DP-2",
				"dispatch togglespecialworkspace haki",
				`dispatch exec [workspace special:haki silent] uwsm-app -- kitty --class haoshoku-haki -d ${directory} claude `,
				`terminal:--class haoshoku-haki -d ${directory} claude`,
			],
		});
	});

	// Mutations caught: removing whole-stream cardinality admits multi-document
	// input; restoring jq's ^/$ anchors admits a trailing newline; dropping the
	// fallback diagnostic makes rejected names impossible to diagnose.
	it("maps awkward config inputs to one exact Haki launch argv", async () => {
		installKittyArgumentRecorder();
		const executionMarker = path.join(directory, "session-name-executed");
		const longSessionName = `long-${"a".repeat(8192)}`;
		const cases = [
			{ label: "single-letter", value: "A", accepted: true },
			{ label: "single-digit", value: "7", accepted: true },
			{ label: "hyphenated", value: "portable-haki", accepted: true },
			{ label: "underscored", value: "under_score", accepted: true },
			{
				label: "multi-document",
				rawConfig: '{"claudeSessionName":"first"}\n{"theme":"ocean"}\n',
				accepted: false,
			},
			{
				label: "newline",
				value: "portable-haki\n",
				accepted: false,
			},
			{ label: "space", value: "portable haki", accepted: false },
			{
				label: "semicolon",
				value: `portable; touch ${executionMarker}`,
				accepted: false,
			},
			{
				label: "command-substitution",
				value: `portable$(touch ${executionMarker})`,
				accepted: false,
			},
			{
				label: "backticks",
				value: `portable\`touch ${executionMarker}\``,
				accepted: false,
			},
			{
				label: "array-valued-key",
				value: ["first", "second"],
				accepted: false,
			},
			{
				label: "duplicate-key-across-stream",
				rawConfig:
					'{"claudeSessionName":"first"}\n{"claudeSessionName":"second"}\n',
				accepted: false,
			},
			{
				label: "top-level-array",
				rawConfig: '[{"claudeSessionName":"array-entry"}]\n',
				accepted: false,
			},
			{
				label: "very-long",
				value: longSessionName,
				accepted: true,
			},
		];
		const baseArgv = ["--class", "haoshoku-haki", "-d", directory, "claude"];
		const validator = chromiumProfileConfig.isValidClaudeSessionName;
		const observations = [];

		for (const testCase of cases) {
			const hasValue = Object.hasOwn(testCase, "value");
			fs.rmSync(executionMarker, { force: true });
			fs.rmSync(kittyCall, { force: true });
			fs.rmSync(log, { force: true });
			fs.writeFileSync(specialState, "");
			fs.writeFileSync(
				path.join(directory, ".haoshoku.json"),
				testCase.rawConfig ??
					JSON.stringify({ claudeSessionName: testCase.value }),
			);

			const result = await run(["haki"]);
			const argv = kittyArguments();
			const observation = {
				label: testCase.label,
				exitCode: result.exitCode,
				argv,
				jsAccepted: hasValue
					? typeof validator === "function"
						? validator(testCase.value)
						: "validator missing"
					: null,
				diagnostic:
					result.stderr === ""
						? ""
						: {
								namesKey: result.stderr.includes("claudeSessionName"),
								namesConfig: result.stderr.includes("~/.haoshoku.json"),
								namesValue: hasValue
									? result.stderr.includes(JSON.stringify(testCase.value))
									: null,
								actionable: result.stderr.includes("Set claudeSessionName"),
							},
				markerCreated: fs.existsSync(executionMarker),
			};
			observations.push(observation);
			console.log(
				`CORPUS_RESULT ${JSON.stringify({ ...observation, argv: printableArguments(argv) })}`,
			);
		}

		expect(observations).toEqual(
			cases.map((testCase) => {
				const hasValue = Object.hasOwn(testCase, "value");
				return {
					label: testCase.label,
					exitCode: 0,
					argv: testCase.accepted
						? [...baseArgv, "-r", testCase.value]
						: baseArgv,
					jsAccepted: hasValue ? testCase.accepted : null,
					diagnostic: testCase.accepted
						? ""
						: {
								namesKey: true,
								namesConfig: true,
								namesValue: hasValue ? true : null,
								actionable: true,
							},
					markerCreated: false,
				};
			}),
		);
	});

	// Mutation caught: this replaces the bounded jq lookup with arbitrary raw
	// output, so only launch's per-element quoting can preserve the final argv.
	it("preserves raw session-name elements when the jq bound is bypassed", async () => {
		installKittyArgumentRecorder();
		installRawSessionNameJqBypass();
		const executionMarker = path.join(directory, "quoting-bypass-executed");
		const cases = [
			{ label: "multi-line", value: "first\nsecond" },
			{ label: "space", value: "name with space" },
			{ label: "semicolon", value: `name; touch ${executionMarker}` },
			{
				label: "command-substitution",
				value: `name$(touch ${executionMarker})`,
			},
			{ label: "backticks", value: `name\`touch ${executionMarker}\`` },
		];
		const baseArgv = ["--class", "haoshoku-haki", "-d", directory, "claude"];
		const observations = [];

		for (const testCase of cases) {
			fs.rmSync(executionMarker, { force: true });
			fs.rmSync(kittyCall, { force: true });
			fs.rmSync(log, { force: true });
			fs.writeFileSync(specialState, "");

			const result = await run(["haki"], {
				env: { RAW_CLAUDE_SESSION_NAME: testCase.value },
			});
			const observation = {
				label: testCase.label,
				exitCode: result.exitCode,
				argv: kittyArguments(),
				stderr: result.stderr,
				markerCreated: fs.existsSync(executionMarker),
			};
			observations.push(observation);
			console.log(
				`QUOTING_BYPASS_RESULT ${JSON.stringify({ ...observation, argv: printableArguments(observation.argv) })}`,
			);
		}

		expect(observations).toEqual(
			cases.map((testCase) => ({
				label: testCase.label,
				exitCode: 0,
				argv: [...baseArgv, "-r", testCase.value],
				stderr: "",
				markerCreated: false,
			})),
		);
	});

	it("focuses visible Haki on its monitor without moving it", async () => {
		const result = await run(["haki"], {
			clients: hakiClient,
			focusedMonitor: "DP-1",
			visibleWorkspace: "haki",
			visibleMonitor: "DP-2",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual(["dispatch focusmonitor DP-2"]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("haki");
		expect(fs.readFileSync(specialMonitorState, "utf8")).toBe("DP-2");
	});

	// Mutation caught: returning after cross-monitor focus leaves a visible
	// workspace empty when its client has died.
	it("relaunches missing Haki after focusing its visible workspace", async () => {
		// The harness executes the dispatched command, so stub the terminal:
		// otherwise this launches a real interactive claude and hangs.
		fs.writeFileSync(
			path.join(directory, "kitty"),
			'#!/usr/bin/env bash\nprintf \'terminal:%s\\n\' "$*" >> "$CALL_LOG"\n',
		);
		fs.chmodSync(path.join(directory, "kitty"), 0o755);

		const result = await run(["haki"], {
			focusedMonitor: "DP-1",
			visibleWorkspace: "haki",
			visibleMonitor: "DP-2",
		});

		expect({
			exitCode: result.exitCode,
			stderr: result.stderr,
			dispatches: dispatchCalls(),
		}).toEqual({
			exitCode: 0,
			stderr: "",
			dispatches: [
				"dispatch focusmonitor DP-2",
				`dispatch exec [workspace special:haki silent] uwsm-app -- kitty --class haoshoku-haki -d ${directory} claude -r io-haki `,
				`terminal:--class haoshoku-haki -d ${directory} claude -r io-haki`,
			],
		});
	});

	it("hides Haki visible on the focused monitor", async () => {
		const systemctlCall = path.join(directory, "systemctl-call");
		fs.writeFileSync(
			path.join(directory, "systemctl"),
			`#!/usr/bin/env bash
: > ${JSON.stringify(systemctlCall)}
exit 17
`,
		);
		fs.chmodSync(path.join(directory, "systemctl"), 0o755);
		const result = await run(["haki"], {
			clients: hakiClient,
			focusedMonitor: "DP-2",
			visibleWorkspace: "haki",
			visibleMonitor: "DP-2",
		});

		expect({
			exitCode: result.exitCode,
			stderr: result.stderr,
			dispatches: dispatchCalls(),
			systemctlCalled: fs.existsSync(systemctlCall),
		}).toEqual({
			exitCode: 0,
			stderr: "",
			dispatches: ["dispatch togglespecialworkspace haki"],
			systemctlCalled: false,
		});
	});

	it("does not relaunch either assistant when both exact classes are present", async () => {
		const result = await run(["assistants"], {
			clients: JSON.stringify([
				{ class: claudeClass },
				{ class: chatgptClass },
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
		expect(
			dispatchCalls().filter((call) => call.startsWith("dispatch exec")),
		).toEqual([]);
	});

	it("launches only ChatGPT when Claude Desktop is already present", async () => {
		const result = await run(["assistants"], {
			clients: JSON.stringify([{ class: claudeClass }]),
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
			"--app=https://chatgpt.com",
		]);
		expect(dispatchCalls().filter((call) => call === "claude")).toHaveLength(0);
		expect(dispatchCalls().filter((call) => call === "chromium")).toHaveLength(
			1,
		);
	});

	it("launches only Claude Desktop when ChatGPT is already present", async () => {
		const result = await run(["assistants"], {
			clients: JSON.stringify([{ class: chatgptClass }]),
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
		expect(dispatchCalls().filter((call) => call === "claude")).toHaveLength(1);
		expect(dispatchCalls().filter((call) => call === "chromium")).toHaveLength(
			0,
		);
	});

	it("launches ChatGPT when a decoy replaces the class's literal dot", async () => {
		const result = await run(["assistants"], {
			clients: JSON.stringify([
				{ class: claudeClass },
				{ class: "chrome-chatgptXcom__-Default" },
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
			"--app=https://chatgpt.com",
		]);
	});

	for (const { recipe, url } of [
		{ recipe: "assistants", url: "https://chatgpt.com" },
		{ recipe: "x", url: "https://x.com/" },
		{ recipe: "youtube", url: "https://youtube.com/" },
		{ recipe: "crunchyroll", url: "https://www.crunchyroll.com/" },
	]) {
		// Mutation caught: omitting --class from this app launch lets it become
		// the Flux singleton owner that creates later plain windows as "chromium".
		it(`starts the Flux singleton owner with its registered class for ${recipe}`, async () => {
			await run(
				[recipe],
				recipe === "assistants"
					? { clients: JSON.stringify([{ class: claudeClass }]) }
					: undefined,
			);

			expect(await chromiumArguments()).toEqual([
				`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
				"--class=chromium-flux",
				`--app=${url}`,
			]);
		});
	}

	it("opens missing X on the portrait monitor with the Flux app profile", async () => {
		const result = await run(["x"]);

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
			"--app=https://x.com/",
		]);
		expect(dispatchCalls()).toContain("dispatch focusmonitor DP-2");
		expect(dispatchCalls()).toContain("dispatch togglespecialworkspace x");
		expect(fs.readFileSync(log, "utf8")).toContain(
			"dispatch exec [workspace special:x silent] uwsm-app -- chromium",
		);
	});

	it("does not relaunch X when its exact app-derived class is present", async () => {
		const result = await run(["x"], { clients: xClient });

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	it("launches X when a lookalike class differs at its literal dot", async () => {
		const result = await run(["x"], {
			clients: JSON.stringify([{ class: "chrome-xXcom__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
			"--app=https://x.com/",
		]);
	});

	for (const { recipe, className, decoyClass, url } of [
		{
			recipe: "youtube",
			className: "chrome-youtube.com__-Default",
			decoyClass: "chrome-youtubeXcom__-Default",
			url: "https://youtube.com/",
		},
		{
			recipe: "crunchyroll",
			className: "chrome-www.crunchyroll.com__-Default",
			decoyClass: "chrome-wwwXcrunchyrollXcom__-Default",
			url: "https://www.crunchyroll.com/",
		},
	]) {
		it(`opens missing ${recipe} on DP-1 with the Flux app profile`, async () => {
			const result = await run([recipe], { focusedMonitor: "" });

			expect(result.exitCode).toBe(0);
			expect(await chromiumArguments()).toEqual([
				`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
				"--class=chromium-flux",
				`--app=${url}`,
			]);
			expect(dispatchCalls()).toContain("dispatch focusmonitor DP-1");
			expect(dispatchCalls()).toContain(
				`dispatch togglespecialworkspace ${recipe}`,
			);
			expect(
				dispatchCalls().filter((call) => call === "chromium"),
			).toHaveLength(1);
		});

		it(`does not relaunch ${recipe} when its exact app-derived class is present`, async () => {
			const result = await run([recipe], {
				clients: JSON.stringify([{ class: className }]),
			});

			expect(result.exitCode).toBe(0);
			expect(fs.existsSync(browserCall)).toBe(false);
			expect(
				dispatchCalls().filter((call) => call === "chromium"),
			).toHaveLength(0);
		});

		it(`launches ${recipe} when dots in its class are replaced`, async () => {
			const result = await run([recipe], {
				clients: JSON.stringify([{ class: decoyClass }]),
			});

			expect(result.exitCode).toBe(0);
			expect(await chromiumArguments()).toEqual([
				`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
				"--class=chromium-flux",
				`--app=${url}`,
			]);
		});
	}

	it("launches a Re:ANIME lookalike through Flux with the exact app URL and class", async () => {
		const result = await run(["reanime"], {
			clients: JSON.stringify([{ class: "chrome-reanimeXto__home-Default" }]),
			focusedMonitor: "",
		});
		const calls = fs.existsSync(log) ? dispatchCalls() : [];

		expect({
			exitCode: result.exitCode,
			chromiumArguments: fs.existsSync(browserCall)
				? await chromiumArguments()
				: [],
			focusedFallback: calls.includes("dispatch focusmonitor DP-1"),
			toggled: calls.includes("dispatch togglespecialworkspace reanime"),
			chromiumLaunches: calls.filter((call) => call === "chromium").length,
		}).toEqual({
			exitCode: 0,
			chromiumArguments: [
				`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
				"--class=chromium-flux",
				"--app=https://reanime.to/home",
			],
			focusedFallback: true,
			toggled: true,
			chromiumLaunches: 1,
		});
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
		expect((await run(["browser-toggle", "flux"])).exitCode).toBe(0);
		const calls = fs.readFileSync(log, "utf8");
		expect(calls).toContain("dispatch focusmonitor DP-1");
		expect(calls).toContain("dispatch togglespecialworkspace browser-flux");
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
			"--class=chromium-flux",
		]);
	});

	it("opens DeFi in a different Chromium profile", async () => {
		expect((await run(["browser-toggle", "defi"])).exitCode).toBe(0);
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
		expect(fs.readFileSync(log, "utf8")).toContain(
			"dispatch focusmonitor DP-1",
		);
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
		expect(fs.readFileSync(log, "utf8")).toContain(
			"dispatch focusmonitor DP-1",
		);
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
				(await run(["browser-toggle", profile], { clients: client })).exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe("");
			expect(fs.existsSync(browserCall)).toBe(false);
		});

		// Mutation caught: launching an already-running browser on a hidden
		// workspace creates a duplicate Chromium invocation instead of revealing it.
		it(`reveals a hidden existing ${profile} browser without Chromium`, async () => {
			expect(
				(await run(["browser-toggle", profile], { clients: client })).exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			expect(fs.existsSync(browserCall)).toBe(false);
		});

		// Mutation caught: skipping the launch after revealing an empty workspace
		// leaves the requested profile without a Chromium client.
		it(`reveals and launches a missing ${profile} browser exactly once`, async () => {
			expect((await run(["browser-toggle", profile])).exitCode).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			const calls = fs.readFileSync(log, "utf8").trim().split("\n");
			expect(calls.filter((call) => call === "chromium")).toHaveLength(1);
		});

		// Mutation caught: routing the generic browser command through toggle
		// behavior hides an already-visible workspace when no URL is provided.
		it(`keeps a visible ${profile} workspace revealed for browser with no URLs`, async () => {
			fs.writeFileSync(specialState, workspace);

			expect(
				(await run(["browser", profile], { clients: client })).exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			expect(fs.existsSync(browserCall)).toBe(false);
		});
	}

	// Mutation caught: confusing $monitor with $visible_monitor in the cross-monitor
	// branch focuses the pinned monitor instead of the workspace's visible monitor.
	it("focuses the monitor where a pinned workspace is actually visible", async () => {
		const result = await run(["haki"], {
			clients: hakiClient,
			focusedMonitor: "DP-1",
			visibleWorkspace: "haki",
			visibleMonitor: "HDMI-A-1",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual(["dispatch focusmonitor HDMI-A-1"]);
	});

	it("does not relaunch WhatsApp when Chromium's app-derived class is already present", async () => {
		const result = await run(["communication"], {
			clients: JSON.stringify([
				{ class: "signal" },
				{ class: "chrome-web.whatsapp.com__-Default" },
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	it("does not relaunch Notion when Chromium's app-derived class is already present", async () => {
		const result = await run(["numbered", "10", "notion"], {
			clients: JSON.stringify([{ class: "chrome-www.notion.so__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	// Mutation caught: sharing the numbered keypress recipe with exec-once moves
	// focus to workspace 7 at login instead of leaving monitor defaults active.
	it("starts workspace-7 kitty without focus while SUPER+7 still focuses it", async () => {
		installKittyArgumentRecorder();
		const loginArgs = configuredWorkspaceArgs(
			/^exec-once = haoshoku-special-workspace (?<args>.+)$/m,
		);
		const shortcutArgs = configuredWorkspaceArgs(
			/^bindd = SUPER, code:16, [^,]+, exec, haoshoku-special-workspace (?<args>.+)$/m,
		);
		const launch = `dispatch exec [workspace 7 silent] uwsm-app -- kitty --class haoshoku-ws7 -d ${directory}`;

		const login = await run(loginArgs);

		expect(login.exitCode).toBe(0);
		expect(await kittyArguments()).toEqual([
			"--class",
			"haoshoku-ws7",
			"-d",
			directory,
		]);
		expect(dispatchCalls()).toEqual([launch]);

		fs.rmSync(log, { force: true });
		fs.rmSync(kittyCall, { force: true });
		const shortcut = await run(shortcutArgs, {
			clients: JSON.stringify([
				{
					address: "0x7abc",
					class: "haoshoku-ws7",
					workspace: { name: "7" },
				},
			]),
		});

		expect(shortcut.exitCode).toBe(0);
		expect(await kittyArguments()).toBeNull();
		expect(dispatchCalls()).toEqual(["dispatch workspace 7"]);
	});

	it("starts workspace-7 kitty only once across repeated login runs", async () => {
		installKittyArgumentRecorder();
		const loginArgs = configuredWorkspaceArgs(
			/^exec-once = haoshoku-special-workspace (?<args>.+)$/m,
		);

		const first = await run(loginArgs);
		const second = await run(loginArgs, {
			clients: JSON.stringify([
				{
					address: "0x7abc",
					class: "haoshoku-ws7",
					workspace: { name: "7" },
				},
			]),
		});

		expect(first.exitCode).toBe(0);
		expect(second.exitCode).toBe(0);
		expect(
			dispatchCalls().filter((call) => call.startsWith("dispatch exec ")),
		).toHaveLength(1);
		expect(dispatchCalls()).not.toContain("dispatch workspace 7");
	});

	for (const file of ["hypr-user-pc.conf", "hypr-user-laptop.conf"]) {
		it(`starts one workspace-7 kitty across repeated ${file} login runs`, async () => {
			installKittyArgumentRecorder();
			const loginArgs = configuredCaelestiaWorkspaceArgs(file);

			const first = await run(loginArgs);
			const second = await run(loginArgs, {
				clients: JSON.stringify([
					{
						address: "0x7abc",
						class: "haoshoku-ws7",
						workspace: { name: "7" },
					},
				]),
			});

			expect(first.exitCode).toBe(0);
			expect(second.exitCode).toBe(0);
			expect(
				dispatchCalls().filter((call) => call.startsWith("dispatch exec ")),
			).toHaveLength(1);
			expect(dispatchCalls()).not.toContain("dispatch workspace 7");
		});
	}

	// Mutation caught: omitting the dedicated class or home directory launches a
	// terminal that the workspace rule cannot route or that starts in an arbitrary cwd.
	it("launches a missing workspace-7 kitty with its dedicated class from home", async () => {
		installKittyArgumentRecorder();

		const result = await run(["numbered", "7", "kitty"]);

		expect(result.exitCode).toBe(0);
		expect(await kittyArguments()).toEqual([
			"--class",
			"haoshoku-ws7",
			"-d",
			directory,
		]);
		expect(dispatchCalls()).toEqual([
			"dispatch workspace 7",
			`dispatch exec [workspace 7 silent] uwsm-app -- kitty --class haoshoku-ws7 -d ${directory}`,
		]);
	});

	it("derives a numbered kitty class from its workspace", async () => {
		installKittyArgumentRecorder();

		const result = await run(["numbered", "8", "kitty"]);

		expect(result.exitCode).toBe(0);
		expect(await kittyArguments()).toEqual([
			"--class",
			"haoshoku-ws8",
			"-d",
			directory,
		]);
		expect(dispatchCalls()).toEqual([
			"dispatch workspace 8",
			`dispatch exec [workspace 8 silent] uwsm-app -- kitty --class haoshoku-ws8 -d ${directory}`,
		]);
	});

	// Mutation caught: probing the generic kitty class treats unrelated terminal
	// windows as the workspace-7 terminal and leaves workspace 7 empty.
	it("launches workspace-7 kitty when an unrelated kitty client exists", async () => {
		installKittyArgumentRecorder();

		const result = await run(["numbered", "7", "kitty"], {
			clients: JSON.stringify([{ class: "kitty" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(await kittyArguments()).toEqual([
			"--class",
			"haoshoku-ws7",
			"-d",
			directory,
		]);
		expect(dispatchCalls()).toEqual([
			"dispatch workspace 7",
			`dispatch exec [workspace 7 silent] uwsm-app -- kitty --class haoshoku-ws7 -d ${directory}`,
		]);
	});

	// Mutation caught: skipping the dedicated-class probe opens duplicate home
	// terminals every time the workspace-7 binding or login recipe runs.
	it("does not relaunch workspace-7 kitty when its dedicated client exists", async () => {
		installKittyArgumentRecorder();

		const result = await run(["numbered", "7", "kitty"], {
			clients: JSON.stringify([
				{
					address: "0x7abc",
					class: "haoshoku-ws7",
					workspace: { name: "7" },
				},
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(await kittyArguments()).toBeNull();
		expect(dispatchCalls()).toEqual(["dispatch workspace 7"]);
	});

	// Mutation caught: a class-only occupancy probe treats a stashed or manually
	// moved workspace-7 kitty as present and permanently leaves workspace 7 empty.
	it("reclaims a stranded workspace-7 kitty instead of launching another", async () => {
		installKittyArgumentRecorder();

		const result = await run(["numbered", "7", "kitty"], {
			clients: JSON.stringify([
				{
					address: "0x7abc",
					class: "haoshoku-ws7",
					workspace: { name: "special:stash" },
				},
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(await kittyArguments()).toBeNull();
		expect(dispatchCalls()).toEqual([
			"dispatch workspace 7",
			"dispatch movetoworkspacesilent 7,address:0x7abc",
		]);
	});

	it("launches Notion when a lookalike class differs at its literal dots", async () => {
		const result = await run(["numbered", "10", "notion"], {
			clients: JSON.stringify([{ class: "chrome-wwwXnotionXso__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/notion`,
			"--app=https://www.notion.so/",
		]);
	});

	it("does not relaunch Notion for its exact app-derived class", async () => {
		const result = await run(["numbered", "10", "notion"], {
			clients: JSON.stringify([{ class: "chrome-www.notion.so__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	it("launches missing Notion with its exact app argv", async () => {
		const result = await run(["numbered", "10", "notion"]);

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/notion`,
			"--app=https://www.notion.so/",
		]);
		expect(dispatchCalls().filter((call) => call === "chromium")).toHaveLength(
			1,
		);
	});

	it("does not give missing Notion a Chromium class flag", async () => {
		const result = await run(["numbered", "10", "notion"]);

		expect(result.exitCode).toBe(0);
		const argv = await chromiumArguments();
		expect(argv.some((argument) => argument.startsWith("--class"))).toBe(false);
	});

	it("launches a missing WhatsApp once into the communication workspace", async () => {
		const result = await run(["communication"], {
			clients: JSON.stringify([{ class: "signal" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/whatsapp`,
			"--app=https://web.whatsapp.com/",
		]);
		expect(dispatchCalls().filter((call) => call === "chromium")).toHaveLength(
			1,
		);
		expect(fs.readFileSync(log, "utf8")).toContain(
			"dispatch exec [workspace special:communication silent] uwsm-app -- chromium",
		);
	});

	it("launches WhatsApp when a lookalike class differs at its literal dots", async () => {
		const result = await run(["communication"], {
			clients: JSON.stringify([
				{ class: "signal" },
				{ class: "chrome-webXwhatsappXcom__-Default" },
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/chromium-haoshoku/whatsapp`,
			"--app=https://web.whatsapp.com/",
		]);
	});

	it("does not relaunch WhatsApp for its exact app-derived class", async () => {
		const result = await run(["communication"], {
			clients: JSON.stringify([
				{ class: "signal" },
				{ class: "chrome-web.whatsapp.com__-Default" },
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	it("continues launching a missing Signal into the communication workspace", async () => {
		const signalDesktop = path.join(directory, "signal-desktop");
		fs.writeFileSync(
			signalDesktop,
			`#!/usr/bin/env bash
printf 'signal-desktop\\n' >> "$CALL_LOG"
`,
		);
		fs.chmodSync(signalDesktop, 0o755);

		const result = await run(["communication"], {
			clients: JSON.stringify([{ class: "chrome-web.whatsapp.com__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toContain(
			"dispatch exec [workspace special:communication silent] uwsm-app -- signal-desktop ",
		);
		expect(dispatchCalls()).toContain("signal-desktop");
	});
});
