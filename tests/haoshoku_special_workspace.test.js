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
const claudeLocal = path.join(
	import.meta.dir,
	"..",
	"configs",
	"scripts",
	"haoshoku-claude-local",
);
describe("haoshoku-special-workspace", () => {
	it("resolves browser profile Brave Origin through PATH", () => {
		const source = fs.readFileSync(script, "utf8");
		expect(source).not.toContain("/usr/bin/brave-origin");
		expect(source).not.toContain("/usr/bin/chromium");
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
			agents: {
				workspace: "agents",
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
			jiohotstar: {
				workspace: "jiohotstar",
				monitor: "DP-1",
				followsFocus: true,
			},
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
			twitch: { workspace: "twitch", monitor: "DP-1", followsFocus: true },
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
	let rawDispatchLog;
	let browserCall;
	let clientState;
	let chromium;
	let claudeDesktop;
	let codexDesktop;
	let kittyCall;
	let t3Code;
	let focusedMonitorState;
	let specialMonitorState;
	let specialState;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-special-"));
		log = path.join(directory, "calls");
		rawDispatchLog = path.join(directory, "raw-dispatches");
		browserCall = path.join(directory, "chromium-call");
		clientState = path.join(directory, "hypr-clients.json");
		chromium = path.join(directory, "brave-origin");
		claudeDesktop = path.join(directory, ["claude", "desktop"].join("-"));
		codexDesktop = path.join(directory, ["codex", "desktop"].join("-"));
		kittyCall = path.join(directory, "kitty-call");
		t3Code = path.join(directory, "t3code");
		focusedMonitorState = path.join(directory, "focused-monitor-state");
		specialMonitorState = path.join(directory, "special-monitor-state");
		specialState = path.join(directory, "special-workspace-state");
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
		  if [[ -n "\${HYPR_CLIENT_PROBE_LOG:-}" ]]; then
		    printf 'clients -j\\n' >> "$HYPR_CLIENT_PROBE_LOG"
		  fi
		  if [[ -n "\${HYPR_CLIENTS_STATE:-}" ]]; then
    cat "$HYPR_CLIENTS_STATE"
  else
    printf '%s\\n' "$HYPR_CLIENTS"
  fi
elif [[ "$1 $2" == "monitors -j" ]]; then
  separator=""
  printf '['
  for monitor in $LIVE_MONITORS; do
    if [[ "$monitor" == "$focused_monitor" ]]; then focused=true; else focused=false; fi
    if [[ -n "$state" && "$monitor" == "$special_monitor" ]]; then special="special:$state"; else special=""; fi
    printf '%s{"name":"%s","focused":%s,"specialWorkspace":{"name":"%s"}}' "$separator" "$monitor" "$focused" "$special"
    separator=,
  done
  printf ']\\n'
elif [[ "$1 $2" == "activeworkspace -j" ]]; then
  printf '{"name":"special:%s"}\\n' "$state"
elif [[ "$1" == "dispatch" && "$2" == hl.dsp.* ]]; then
  expression="$2"
  printf '%s\\n' "$expression" >> "$RAW_DISPATCH_LOG"
  if [[ "$expression" == hl.dsp.exec_cmd\\(*\\) ]]; then
    encoded="\${expression#hl.dsp.exec_cmd(}"
    encoded="\${encoded%)}"
    command="$(jq -r . <<<"$encoded")"
    printf 'dispatch exec %s\\n' "$command" >> "$CALL_LOG"
    bash -c "\${command#*] }"
  elif [[ "$expression" == *"workspace.toggle_special("* ]]; then
    encoded="\${expression#hl.dsp.workspace.toggle_special(}"
    encoded="\${encoded%)}"
    workspace="$(jq -r . <<<"$encoded")"
    if [[ "$state" == "$workspace" ]]; then
      if [[ "$special_monitor" == "$focused_monitor" ]]; then
        : > "$SPECIAL_STATE"
      else
        printf '%s' "$focused_monitor" > "$SPECIAL_MONITOR_STATE"
      fi
    else
      printf '%s' "$workspace" > "$SPECIAL_STATE"
      printf '%s' "$focused_monitor" > "$SPECIAL_MONITOR_STATE"
    fi
    printf 'dispatch togglespecialworkspace %s\\n' "$workspace" >> "$CALL_LOG"
  elif [[ "$expression" == *"workspace = "* && "$expression" == hl.dsp.focus* ]]; then
    encoded="\${expression#*workspace = }"
    suffix=' })'
    encoded="\${encoded%"$suffix"}"
    workspace="$(jq -r . <<<"$encoded")"
    printf 'dispatch workspace %s\\n' "$workspace" >> "$CALL_LOG"
  elif [[ "$expression" == *"monitor = "* && "$expression" == hl.dsp.focus* ]]; then
    encoded="\${expression#*monitor = }"
    suffix=' })'
    encoded="\${encoded%"$suffix"}"
    monitor="$(jq -r . <<<"$encoded")"
    printf '%s' "$monitor" > "$FOCUSED_MONITOR_STATE"
    printf 'dispatch focusmonitor %s\\n' "$monitor" >> "$CALL_LOG"
  elif [[ "$expression" == hl.dsp.window.move* ]]; then
    payload="\${expression#*workspace = }"
    workspace_encoded="\${payload%%, window = *}"
    payload="\${payload#*, window = }"
    suffix=', follow = false })'
    window_encoded="\${payload%"$suffix"}"
    workspace="$(jq -r . <<<"$workspace_encoded")"
    window="$(jq -r . <<<"$window_encoded")"
    printf 'dispatch movetoworkspacesilent %s,%s\\n' "$workspace" "$window" >> "$CALL_LOG"
  else
    printf 'unsupported Lua dispatch: %s\\n' "$expression" >&2
    exit 7
  fi
elif [[ "$1" == "dispatch" && "\${STRICT_V4_DISPATCH:-false}" == true ]]; then
  printf 'legacy dispatch rejected: %s\\n' "$*" >&2
  exit 7
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
			path.join(directory, "kitty"),
			`#!/usr/bin/env bash
printf '%s\\0' "$@" > "$KITTY_CALL"
`,
		);
		fs.writeFileSync(
			chromium,
			`#!/usr/bin/env bash
printf 'brave-origin\\n' >> "$CALL_LOG"
printf '%s\\0' "$@" > "$BROWSER_CALL"
`,
		);
		fs.writeFileSync(
			claudeDesktop,
			`#!/usr/bin/env bash
printf 'claude-desktop\n' >> "$CALL_LOG"
`,
		);
		fs.writeFileSync(
			codexDesktop,
			`#!/usr/bin/env bash
printf 'codex-desktop\n' >> "$CALL_LOG"
`,
		);
		fs.writeFileSync(
			t3Code,
			`#!/usr/bin/env bash
printf 't3code\n' >> "$CALL_LOG"
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
		fs.chmodSync(codexDesktop, 0o755);
		fs.chmodSync(path.join(directory, "kitty"), 0o755);
		fs.chmodSync(t3Code, 0o755);
		fs.chmodSync(chromium, 0o755);
		fs.chmodSync(helper, 0o755);
		fs.chmodSync(path.join(directory, "systemctl"), 0o755);
		fs.chmodSync(uwsmApp, 0o755);
	});
	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	async function run(
		args,
		{
			clientsState,
			clients = "[]",
			clientProbeLog,
			chromiumProfiles,
			env = {},
			focusedMonitor = "DP-1",
			liveMonitors = ["DP-1", "DP-2", "HDMI-A-1"],
			visibleWorkspace,
			visibleMonitor = "DP-1",
		} = {},
	) {
		if (clientsState !== undefined) {
			fs.writeFileSync(clientState, clientsState);
		}
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
				HYPR_CLIENTS_STATE: clientsState !== undefined ? clientState : "",
				HYPR_CLIENT_PROBE_LOG: clientProbeLog ?? "",
				BROWSER_CALL: browserCall,
				CALL_LOG: log,
				FOCUSED_MONITOR_STATE: focusedMonitorState,
				KITTY_CALL: kittyCall,
				LIVE_MONITORS: liveMonitors.join(" "),
				RAW_DISPATCH_LOG: rawDispatchLog,
				SPECIAL_STATE: specialState,
				SPECIAL_MONITOR_STATE: specialMonitorState,
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

	function rawDispatchExpressions() {
		return fs.existsSync(rawDispatchLog)
			? fs.readFileSync(rawDispatchLog, "utf8").trim().split("\n")
			: [];
	}

	function kittyArguments() {
		if (!fs.existsSync(kittyCall)) return null;
		const argv = fs.readFileSync(kittyCall, "utf8").split("\0");
		if (argv.at(-1) === "") argv.pop();
		return argv;
	}

	function installClaudeArgumentRecorder() {
		fs.writeFileSync(
			path.join(directory, "claude"),
			'#!/usr/bin/env bash\nif (( $# == 0 )); then : > "$CLAUDE_CALL"; else printf \'%s\\0\' "$@" > "$CLAUDE_CALL"; fi\n',
		);
		fs.chmodSync(path.join(directory, "claude"), 0o755);
	}

	function claudeArguments(claudeCall) {
		const argv = fs.readFileSync(claudeCall, "utf8").split("\0");
		if (argv.at(-1) === "") argv.pop();
		return argv;
	}

	async function runClaudeLocal(claudeCall, env = {}) {
		const proc = Bun.spawn([claudeLocal], {
			env: {
				...process.env,
				CLAUDE_CALL: claudeCall,
				HOME: directory,
				PATH: `${directory}:${process.env.PATH}`,
				...env,
			},
			stderr: "pipe",
		});
		return {
			exitCode: await proc.exited,
			stderr: await new Response(proc.stderr).text(),
		};
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
	const hakiClient = JSON.stringify([
		kittyClient("0xhaki", "special:haki", "haoshoku-haki"),
	]);
	function kittyClient(address, workspace, className) {
		return {
			address,
			class: className,
			workspace: { name: workspace },
		};
	}
	const xClient = JSON.stringify([{ class: "brave-x.com__-Default" }]);
	const forwardedUrl = "https://example.test/forwarded";
	const claudeClass = "com.anthropic.Claude";
	const codexClass = "chatgpt";

	it("uses Omarchy v4 Lua expressions for every dispatch family", async () => {
		const strictDispatch = { env: { STRICT_V4_DISPATCH: "true" } };
		const numbered = await run(["numbered", "7", "kitty"], strictDispatch);
		const assistants = await run(["assistants"], {
			...strictDispatch,
			clients: JSON.stringify([
				kittyClient("0xcodex", "1", "chatgpt"),
				kittyClient("0xclaude", "special:assistants", claudeClass),
			]),
		});
		const stash = await run(["stash"], strictDispatch);

		expect(
			[numbered.exitCode, assistants.exitCode, stash.exitCode],
			[numbered.stderr, assistants.stderr, stash.stderr].join("\n"),
		).toEqual([0, 0, 0]);
		expect(rawDispatchExpressions()).toEqual([
			'hl.dsp.focus({ workspace = "7" })',
			`hl.dsp.exec_cmd(${JSON.stringify(
				`[workspace 7 silent] uwsm-app -- kitty --class haoshoku-ws7 -d ${directory} `,
			)})`,
			'hl.dsp.workspace.toggle_special("assistants")',
			'hl.dsp.window.move({ workspace = "special:assistants", window = "address:0xcodex", follow = false })',
			'hl.dsp.focus({ monitor = "DP-1" })',
			'hl.dsp.workspace.toggle_special("stash")',
		]);
	});

	it("JSON-quotes every interpolated Lua dispatch value", async () => {
		const workspace = '7"\\edge';
		const unusualHome = path.join(directory, 'home"\\edge');
		fs.mkdirSync(unusualHome);

		const result = await run(["numbered", workspace, "kitty"], {
			env: { HOME: unusualHome, STRICT_V4_DISPATCH: "true" },
		});
		const [focusExpression, execExpression] = rawDispatchExpressions();
		const focusValue = focusExpression
			.slice('hl.dsp.focus({ workspace = '.length, -' })'.length);
		const execValue = execExpression.slice("hl.dsp.exec_cmd(".length, -1);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(focusValue)).toBe(workspace);
		expect(JSON.parse(execValue)).toContain(
			`[workspace ${workspace} silent] uwsm-app -- kitty --class`,
		);
		expect(JSON.parse(execValue)).toContain(
			unusualHome.replace(/(["\\])/g, "\\$1"),
		);
	});

	it("forwards a generic browser URL without hiding it on the focused monitor", async () => {
		const result = await run(["browser", "flux", forwardedUrl], {
			clients: fluxClient,
			focusedMonitor: "DP-1",
			visibleWorkspace: "browser-flux",
			visibleMonitor: "DP-1",
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
			forwardedUrl,
		]);
		expect(dispatchCalls()).toEqual(["brave-origin"]);
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
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
			forwardedUrl,
		]);
		expect(dispatchCalls()).toEqual([
			"brave-origin",
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
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
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
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
			...urls,
		]);
		expect(dispatchCalls()).toEqual(["brave-origin"]);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-flux");
	});

	// Mutation caught: a visible browser-toggle URL request must not hide an
	// empty workspace or launch Brave Origin outside its special workspace.
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
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
			"--class=chromium-flux",
			"https://example.test/missing-toggle-client",
		]);
		expect(dispatchCalls()).toEqual([
			"dispatch exec [workspace special:browser-flux silent] uwsm-app -- brave-origin --user-data-dir=" +
				`${directory}/.config/brave-haoshoku/flux --class=chromium-flux https://example.test/missing-toggle-client `,
			"brave-origin",
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
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
			"--class=chromium-flux",
		]);
		expect(dispatchCalls()).toEqual([
			"dispatch exec [workspace special:browser-flux silent] uwsm-app -- brave-origin --user-data-dir=" +
				`${directory}/.config/brave-haoshoku/flux --class=chromium-flux `,
			"brave-origin",
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

	for (const [recipe, className] of [
		["youtube", "brave-youtube.com__-Default"],
		["crunchyroll", "brave-www.crunchyroll.com__-Default"],
		["twitch", "brave-www.twitch.tv__-Default"],
	]) {
		const clients = JSON.stringify([
			{
				class: className,
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
			clients: JSON.stringify([{ class: "brave-youtube.com__-Default" }]),
			focusedMonitor: "",
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toContain("dispatch focusmonitor DP-1");
	});

	it("toggles Re:ANIME on the focused monitor without relaunching its exact client", async () => {
		const result = await run(["reanime"], {
			clients: JSON.stringify([{ class: "brave-reanime.to__home-Default" }]),
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

	it("keeps a present PC recipe monitor unchanged", async () => {
		const result = await run(["haki"], {
			clients: hakiClient,
			focusedMonitor: "DP-1",
			liveMonitors: ["DP-1", "DP-2", "HDMI-A-1"],
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch focusmonitor DP-2",
			"dispatch togglespecialworkspace haki",
		]);
	});

	it("falls back to the focused monitor when a recipe monitor is absent", async () => {
		const result = await run(["haki"], {
			clients: hakiClient,
			focusedMonitor: "eDP-1",
			liveMonitors: ["eDP-1"],
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch focusmonitor eDP-1",
			"dispatch togglespecialworkspace haki",
		]);
	});

	// Mutations caught: removing whole-stream cardinality admits multi-document
	// input; restoring jq's ^/$ anchors admits a trailing newline; dropping the
	// fallback diagnostic makes rejected names impossible to diagnose.
	it("maps awkward config inputs to one exact Haki launch argv", async () => {
		const claudeCall = path.join(directory, "claude-call");
		installClaudeArgumentRecorder();
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
		const baseArgv = [];
		const validator = chromiumProfileConfig.isValidClaudeSessionName;
		const observations = [];

		for (const testCase of cases) {
			const hasValue = Object.hasOwn(testCase, "value");
			fs.rmSync(executionMarker, { force: true });
			fs.rmSync(claudeCall, { force: true });
			fs.writeFileSync(
				path.join(directory, ".haoshoku.json"),
				testCase.rawConfig ??
					JSON.stringify({ claudeSessionName: testCase.value }),
			);

			const result = await runClaudeLocal(claudeCall);
			const argv = claudeArguments(claudeCall);
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
		const claudeCall = path.join(directory, "claude-call");
		installClaudeArgumentRecorder();
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
		const baseArgv = [];
		const observations = [];

		for (const testCase of cases) {
			fs.rmSync(executionMarker, { force: true });
			fs.rmSync(claudeCall, { force: true });

			const result = await runClaudeLocal(claudeCall, {
				RAW_CLAUDE_SESSION_NAME: testCase.value,
			});
			const observation = {
				label: testCase.label,
				exitCode: result.exitCode,
				argv: claudeArguments(claudeCall),
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

	function assistantClient(address, className, workspace) {
		return { address, class: className, workspace: { name: workspace } };
	}

	it("toggles the assistants workspace, reclaims ChatGPT and Claude, and probes once", async () => {
		const clientProbeLog = path.join(directory, "client-probes");
		const result = await run(["assistants"], {
			clientProbeLog,
			clients: JSON.stringify([
				assistantClient("0xclaude", claudeClass, "2"),
				assistantClient("0xcodex", codexClass, "5"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace assistants",
			"dispatch movetoworkspacesilent special:assistants,address:0xcodex",
			"dispatch movetoworkspacesilent special:assistants,address:0xclaude",
		]);
		expect(fs.readFileSync(clientProbeLog, "utf8").trim().split("\n")).toEqual([
			"clients -j",
		]);
	});

	it("does not move or relaunch assistants already on their special workspace", async () => {
		const result = await run(["assistants"], {
			clients: JSON.stringify([
				assistantClient("0xclaude", claudeClass, "special:assistants"),
				assistantClient("0xcodex", codexClass, "special:assistants"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace assistants",
		]);
	});

	it("launches both missing desktop assistants into the assistants workspace", async () => {
		const result = await run(["assistants"]);

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace assistants",
			"dispatch exec [workspace special:assistants silent] uwsm-app -- codex-desktop ",
			"codex-desktop",
			"dispatch exec [workspace special:assistants silent] uwsm-app -- claude-desktop ",
			"claude-desktop",
		]);
	});

	it("launches only missing Claude when ChatGPT is already present", async () => {
		const result = await run(["assistants"], {
			clients: JSON.stringify([
				assistantClient("0xcodex", codexClass, "special:assistants"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace assistants",
			"dispatch exec [workspace special:assistants silent] uwsm-app -- claude-desktop ",
			"claude-desktop",
		]);
	});

	it("does not let an uppercase ChatGPT decoy suppress the Codex launch", async () => {
		const result = await run(["assistants"], {
			clients: JSON.stringify([
				assistantClient("0xclaude", claudeClass, "2"),
				assistantClient("0xdecoy", "ChatGPT", "special:assistants"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace assistants",
			"dispatch exec [workspace special:assistants silent] uwsm-app -- codex-desktop ",
			"codex-desktop",
			"dispatch movetoworkspacesilent special:assistants,address:0xclaude",
		]);
	});

	it("does not let a T3 Code client suppress the ChatGPT launch", async () => {
		const result = await run(["assistants"], {
			clients: JSON.stringify([{ class: "t3code" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace assistants",
			"dispatch exec [workspace special:assistants silent] uwsm-app -- codex-desktop ",
			"codex-desktop",
			"dispatch exec [workspace special:assistants silent] uwsm-app -- claude-desktop ",
			"claude-desktop",
		]);
	});

	it("focuses workspace 1 and launches T3 Code when it is missing", async () => {
		const result = await run(["numbered", "1", "t3code"]);

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch workspace 1",
			"dispatch exec [workspace 1 silent] uwsm-app -- t3code ",
			"t3code",
		]);
	});

	it("does not relaunch T3 Code when its client already exists", async () => {
		const result = await run(["numbered", "1", "t3code"], {
			clients: JSON.stringify([{ class: "t3code" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual(["dispatch workspace 1"]);
	});

	it("rejects the retired bare T3 Code recipe", async () => {
		const result = await run(["t3code"]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown workspace recipe");
	});

	it("does not launch assistants when the client probe is malformed", async () => {
		const result = await run(["assistants"], { clients: "not json" });

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toEqual([
			"dispatch togglespecialworkspace assistants",
		]);
	});

	for (const [label, client] of [
		[
			"a null workspace",
			{ address: "0xclaude", class: claudeClass, workspace: null },
		],
		[
			"a missing workspace name",
			{ address: "0xclaude", class: claudeClass, workspace: {} },
		],
	]) {
		it(`does not guess ownership from ${label}`, async () => {
			const result = await run(["assistants"], {
				clients: JSON.stringify([client]),
			});

			expect(result.exitCode).toBe(0);
			expect(dispatchCalls()).toEqual([
				"dispatch togglespecialworkspace assistants",
			]);
		});
	}

	for (const [label, client] of [
		["a null client entry", null],
		[
			"a client without a class",
			{ address: "0xunknown", workspace: { name: "1" } },
		],
		[
			"a client with a non-string class",
			{ address: "0xunknown", class: 7, workspace: { name: "1" } },
		],
	]) {
		it(`does not launch assistants from ${label}`, async () => {
			const result = await run(["assistants"], {
				clients: JSON.stringify([client]),
			});

			expect(result.exitCode).toBe(0);
			expect(dispatchCalls()).toEqual([
				"dispatch togglespecialworkspace assistants",
			]);
		});
	}

	for (const { recipe, url } of [
		{ recipe: "x", url: "https://x.com/" },
		{ recipe: "youtube", url: "https://youtube.com/" },
		{ recipe: "jiohotstar", url: "https://www.jiohotstar.com/" },
		{ recipe: "crunchyroll", url: "https://www.crunchyroll.com/" },
		{ recipe: "twitch", url: "https://www.twitch.tv/" },
	]) {
		// Mutation caught: omitting --class from this app launch lets it become
		// the Flux singleton owner that creates later plain windows as "brave-origin".
		it(`starts the Flux singleton owner with its registered class for ${recipe}`, async () => {
			await run([recipe]);

			expect(await chromiumArguments()).toEqual([
				`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
				"--class=chromium-flux",
				`--app=${url}`,
			]);
		});
	}

	it("opens missing X on the portrait monitor with the Flux app profile", async () => {
		const result = await run(["x"]);

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
			"--class=chromium-flux",
			"--app=https://x.com/",
		]);
		expect(dispatchCalls()).toContain("dispatch focusmonitor DP-2");
		expect(dispatchCalls()).toContain("dispatch togglespecialworkspace x");
		expect(fs.readFileSync(log, "utf8")).toContain(
			"dispatch exec [workspace special:x silent] uwsm-app -- brave-origin",
		);
	});

	it("does not relaunch X when its exact app-derived class is present", async () => {
		const result = await run(["x"], { clients: xClient });

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	it("launches X when a lookalike class differs at its literal dot", async () => {
		const result = await run(["x"], {
			clients: JSON.stringify([{ class: "brave-xXcom__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
			"--class=chromium-flux",
			"--app=https://x.com/",
		]);
	});

	for (const { recipe, className, decoyClass, url } of [
		{
			recipe: "youtube",
			className: "brave-youtube.com__-Default",
			decoyClass: "brave-youtubeXcom__-Default",
			url: "https://youtube.com/",
		},
		{
			recipe: "jiohotstar",
			className: "brave-www.jiohotstar.com__-Default",
			decoyClass: "brave-wwwXjiohotstarXcom__-Default",
			url: "https://www.jiohotstar.com/",
		},
		{
			recipe: "crunchyroll",
			className: "brave-www.crunchyroll.com__-Default",
			decoyClass: "brave-wwwXcrunchyrollXcom__-Default",
			url: "https://www.crunchyroll.com/",
		},
		{
			recipe: "twitch",
			className: "brave-www.twitch.tv__-Default",
			decoyClass: "brave-wwwXtwitchXtv__-Default",
			url: "https://www.twitch.tv/",
		},
	]) {
		it(`opens missing ${recipe} on DP-1 with the Flux app profile`, async () => {
			const result = await run([recipe], { focusedMonitor: "" });
			const actualArguments = await chromiumArguments();

			expect(result.exitCode).toBe(0);
			expect(actualArguments).toEqual([
				`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
				"--class=chromium-flux",
				`--app=${url}`,
			]);
			if (recipe === "jiohotstar") {
				console.info(
					`JioHotstar fixture: classPattern=^brave-www\\.jiohotstar\\.com__-Default$ url=${url} argv=${JSON.stringify(actualArguments)}`,
				);
			}
			expect(dispatchCalls()).toContain("dispatch focusmonitor DP-1");
			expect(dispatchCalls()).toContain(
				`dispatch togglespecialworkspace ${recipe}`,
			);
			expect(
				dispatchCalls().filter((call) => call === "brave-origin"),
			).toHaveLength(1);
		});

		it(`does not relaunch ${recipe} when its exact app-derived class is present`, async () => {
			const result = await run([recipe], {
				clients: JSON.stringify([{ class: className }]),
			});

			expect(result.exitCode).toBe(0);
			expect(fs.existsSync(browserCall)).toBe(false);
			expect(
				dispatchCalls().filter((call) => call === "brave-origin"),
			).toHaveLength(0);
		});

		it(`launches ${recipe} when dots in its class are replaced`, async () => {
			const result = await run([recipe], {
				clients: JSON.stringify([{ class: decoyClass }]),
			});

			expect(result.exitCode).toBe(0);
			expect(await chromiumArguments()).toEqual([
				`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
				"--class=chromium-flux",
				`--app=${url}`,
			]);
		});
	}

	it("launches a Re:ANIME lookalike through Flux with the exact app URL and class", async () => {
		const result = await run(["reanime"], {
			clients: JSON.stringify([{ class: "brave-reanimeXto__home-Default" }]),
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
			chromiumLaunches: calls.filter((call) => call === "brave-origin").length,
		}).toEqual({
			exitCode: 0,
			chromiumArguments: [
				`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
				"--class=chromium-flux",
				"--app=https://reanime.to/home",
			],
			focusedFallback: true,
			toggled: true,
			chromiumLaunches: 1,
		});
	});

	// Mutation caught: directly backgrounding Brave Origin after revealing its workspace
	// lets it land on the active workspace; unescaped URL data can also become shell
	// syntax when Hyprland's string-based exec API is used.
	it("launches an absent browser through its special workspace with literal URL argv", async () => {
		const marker = path.join(directory, "hostile-url-executed");
		const hostileUrl = `https://example.test/has space;$(touch ${marker})?dollar=$HOME`;
		const result = await run(["browser-flux", hostileUrl]);

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
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
		expect(launchIndex).toBeLessThan(calls.indexOf("brave-origin"));
	});

	async function chromiumArguments() {
		for (let attempt = 0; attempt < 20; attempt += 1) {
			if (fs.existsSync(browserCall))
				return fs.readFileSync(browserCall, "utf8").split("\0").filter(Boolean);
			await Bun.sleep(10);
		}
		throw new Error("Brave Origin was not invoked");
	}

	it("rejects unknown recipes without dispatching", async () => {
		const result = await run(["anything"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown workspace recipe");
		expect(fs.existsSync(log)).toBe(false);
	});

	it("opens Flux in its isolated Brave Origin profile and class", async () => {
		expect((await run(["browser-toggle", "flux"])).exitCode).toBe(0);
		const calls = fs.readFileSync(log, "utf8");
		expect(calls).toContain("dispatch focusmonitor DP-1");
		expect(calls).toContain("dispatch togglespecialworkspace browser-flux");
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
			"--class=chromium-flux",
		]);
	});

	it("opens DeFi in a different Brave Origin profile", async () => {
		expect((await run(["browser-toggle", "defi"])).exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/defi`,
			"--class=chromium-defi",
		]);
	});

	// Mutation caught: hard-coding Flux and DeFi recipe branches rejects a valid
	// future profile instead of deriving its workspace and Brave Origin argv safely.
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
			`--user-data-dir=${directory}/.config/brave-haoshoku/research`,
			"--class=chromium-research",
			"https://research.example/brief",
		]);
		expect(fs.readFileSync(log, "utf8")).toContain(
			"dispatch focusmonitor DP-1",
		);
		expect(fs.readFileSync(specialState, "utf8")).toBe("browser-research");
	});

	// Mutation caught: accepting an ID that is absent from the validated registry
	// starts an uncontrolled Brave Origin data directory instead of rejecting it.
	it("rejects unknown generic browser profile IDs before launching Brave Origin", async () => {
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
				`--user-data-dir=${directory}/.config/brave-haoshoku/${id}`,
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
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
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
		// Mutation caught: sending a URL through the PATH-shadowed Brave Origin wrapper,
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
				`--user-data-dir=${directory}/.config/brave-haoshoku/${profile}`,
				`--class=chromium-${profile}`,
				...urls,
			]);
		});

		// Mutation caught: retaining the launch-only class flag can cause Brave Origin
		// to miss the existing profile process instead of appending these URLs to it.
		it(`forwards URLs to the existing ${recipe} Brave Origin client before revealing it`, async () => {
			const urls = [
				"https://example.test/forward?one=1",
				"https://example.test/forward?two=2",
			];
			const result = await run([recipe, ...urls], {
				clients: JSON.stringify([{ class: `chromium-${profile}` }]),
			});

			expect(result.exitCode).toBe(0);
			expect(await chromiumArguments()).toEqual([
				`--user-data-dir=${directory}/.config/brave-haoshoku/${profile}`,
				...urls,
			]);
			const calls = fs.readFileSync(log, "utf8").split("\n");
			expect(calls.indexOf("brave-origin")).toBeLessThan(
				calls.indexOf("dispatch focusmonitor DP-1"),
			);
			expect(fs.readFileSync(specialState, "utf8")).toBe(recipe);
		});
	}

	// Mutation caught: invoking Brave Origin with no URL creates a new browser
	// window instead of just revealing the registered profile's workspace.
	it("reveals an existing Flux browser without invoking Brave Origin when no URL is supplied", async () => {
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
		// workspace creates a duplicate Brave Origin invocation instead of revealing it.
		it(`reveals a hidden existing ${profile} browser without Brave Origin`, async () => {
			expect(
				(await run(["browser-toggle", profile], { clients: client })).exitCode,
			).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			expect(fs.existsSync(browserCall)).toBe(false);
		});

		// Mutation caught: skipping the launch after revealing an empty workspace
		// leaves the requested profile without a Brave Origin client.
		it(`reveals and launches a missing ${profile} browser exactly once`, async () => {
			expect((await run(["browser-toggle", profile])).exitCode).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(workspace);
			const calls = fs.readFileSync(log, "utf8").trim().split("\n");
			expect(calls.filter((call) => call === "brave-origin")).toHaveLength(1);
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

	it("does not relaunch WhatsApp when Brave Origin's app-derived class is already present", async () => {
		const result = await run(["communication"], {
			clients: JSON.stringify([
				{ class: "signal" },
				{ class: "brave-web.whatsapp.com__-Default" },
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	it("does not relaunch Notion when Brave Origin's app-derived class is already present", async () => {
		const result = await run(["numbered", "10", "notion"], {
			clients: JSON.stringify([{ class: "brave-www.notion.so__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	it("launches Notion when a lookalike class differs at its literal dots", async () => {
		const result = await run(["numbered", "10", "notion"], {
			clients: JSON.stringify([{ class: "brave-wwwXnotionXso__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/notion`,
			"--app=https://www.notion.so/",
		]);
	});

	it("does not relaunch Notion for its exact app-derived class", async () => {
		const result = await run(["numbered", "10", "notion"], {
			clients: JSON.stringify([{ class: "brave-www.notion.so__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(browserCall)).toBe(false);
	});

	it("launches missing Notion with its exact app argv", async () => {
		const result = await run(["numbered", "10", "notion"]);

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/notion`,
			"--app=https://www.notion.so/",
		]);
		expect(
			dispatchCalls().filter((call) => call === "brave-origin"),
		).toHaveLength(1);
	});

	it("does not give missing Notion a Brave Origin class flag", async () => {
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
			`--user-data-dir=${directory}/.config/brave-haoshoku/whatsapp`,
			"--app=https://web.whatsapp.com/",
		]);
		expect(
			dispatchCalls().filter((call) => call === "brave-origin"),
		).toHaveLength(1);
		expect(fs.readFileSync(log, "utf8")).toContain(
			"dispatch exec [workspace special:communication silent] uwsm-app -- brave-origin",
		);
	});

	it("launches WhatsApp when a lookalike class differs at its literal dots", async () => {
		const result = await run(["communication"], {
			clients: JSON.stringify([
				{ class: "signal" },
				{ class: "brave-webXwhatsappXcom__-Default" },
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(await chromiumArguments()).toEqual([
			`--user-data-dir=${directory}/.config/brave-haoshoku/whatsapp`,
			"--app=https://web.whatsapp.com/",
		]);
	});

	it("does not relaunch WhatsApp for its exact app-derived class", async () => {
		const result = await run(["communication"], {
			clients: JSON.stringify([
				{ class: "signal" },
				{ class: "brave-web.whatsapp.com__-Default" },
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
			clients: JSON.stringify([{ class: "brave-web.whatsapp.com__-Default" }]),
		});

		expect(result.exitCode).toBe(0);
		expect(dispatchCalls()).toContain(
			"dispatch exec [workspace special:communication silent] uwsm-app -- signal-desktop ",
		);
		expect(dispatchCalls()).toContain("signal-desktop");
	});

	// Exact class plus target workspace is Kitty's ownership contract. A matching
	// client stays put; the same class elsewhere is reclaimed by its address.
	it("keeps an owned Kitty in place and reclaims only its stranded address", async () => {
		const owned = kittyClient("0xowned", "7", "haoshoku-ws7");
		const inPlace = await run(["numbered", "7", "kitty"], {
			clientsState: JSON.stringify([
				owned,
				kittyClient("0xother", "7", "kitty"),
			]),
		});

		expect(inPlace.exitCode).toBe(0);
		expect(kittyArguments()).toBeNull();
		expect(dispatchCalls()).toEqual(["dispatch workspace 7"]);

		fs.rmSync(log, { force: true });
		const stranded = await run(["numbered", "7", "kitty"], {
			clientsState: JSON.stringify([
				{ ...owned, workspace: { name: "special:stash" } },
				kittyClient("0xother", "7", "kitty"),
			]),
		});

		expect(stranded.exitCode).toBe(0);
		expect(kittyArguments()).toBeNull();
		expect(dispatchCalls()).toEqual([
			"dispatch workspace 7",
			"dispatch movetoworkspacesilent 7,address:0xowned",
		]);
	});

	it("launches its owned numbered Kitty instead of adopting unrelated Kitty classes", async () => {
		const result = await run(["numbered-login", "8", "kitty"], {
			clientsState: JSON.stringify([
				kittyClient("0xplain", "8", "kitty"),
				kittyClient("0xother-owner", "8", "haoshoku-ws7"),
				kittyClient("0xelsewhere", "9", "kitty"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(kittyArguments()).toEqual([
			"--class",
			"haoshoku-ws8",
			"-d",
			directory,
		]);
		expect(dispatchCalls()).toEqual([
			`dispatch exec [workspace 8 silent] uwsm-app -- kitty --class haoshoku-ws8 -d ${directory}`,
		]);
	});

	it("does not treat multiple unrelated Kitty windows as owned", async () => {
		const result = await run(["numbered-login", "8", "kitty"], {
			clientsState: JSON.stringify([
				kittyClient("0xplain-one", "8", "kitty"),
				kittyClient("0xplain-two", "8", "kitty"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(kittyArguments()).toEqual([
			"--class",
			"haoshoku-ws8",
			"-d",
			directory,
		]);
		expect(dispatchCalls()).toHaveLength(1);
		expect(dispatchCalls()[0]).toContain(
			"dispatch exec [workspace 8 silent] uwsm-app -- kitty --class haoshoku-ws8",
		);
	});

	it("launches a missing numbered Kitty once and is idempotent after it appears", async () => {
		const first = await run(["numbered", "7", "kitty"], {
			clientsState: "[]",
		});

		expect(first.exitCode).toBe(0);
		expect(kittyArguments()).toEqual([
			"--class",
			"haoshoku-ws7",
			"-d",
			directory,
		]);
		expect(dispatchCalls()).toEqual([
			"dispatch workspace 7",
			`dispatch exec [workspace 7 silent] uwsm-app -- kitty --class haoshoku-ws7 -d ${directory}`,
		]);

		fs.rmSync(log, { force: true });
		fs.rmSync(kittyCall, { force: true });
		const repeated = await run(["numbered-login", "7", "kitty"], {
			clientsState: JSON.stringify([
				kittyClient("0xowned", "7", "haoshoku-ws7"),
			]),
		});

		expect(repeated.exitCode).toBe(0);
		expect(kittyArguments()).toBeNull();
		expect(fs.existsSync(log)).toBe(false);
	});

	it("reclaims only the first same-class Kitty stray without launching", async () => {
		const result = await run(["numbered-login", "7", "kitty"], {
			clientsState: JSON.stringify([
				kittyClient("0xfirst", "special:stash", "haoshoku-ws7"),
				kittyClient("0xsecond", "9", "haoshoku-ws7"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(kittyArguments()).toBeNull();
		expect(dispatchCalls()).toEqual([
			"dispatch movetoworkspacesilent 7,address:0xfirst",
		]);
	});

	it("fails closed when the Kitty client probe is malformed", async () => {
		const result = await run(["numbered-login", "7", "kitty"], {
			clientsState: "not json",
		});

		expect(result.exitCode).toBe(0);
		expect(kittyArguments()).toBeNull();
		expect(fs.existsSync(log)).toBe(false);
	});

	it("keeps Haki and agents ownership distinct by exact Kitty class", async () => {
		const clients = JSON.stringify([
			kittyClient("0xhaki", "special:haki", "haoshoku-haki"),
			kittyClient("0xagents", "special:agents", "haoshoku-agents"),
		]);
		for (const recipe of ["haki", "agents"]) {
			fs.rmSync(log, { force: true });
			fs.rmSync(kittyCall, { force: true });
			fs.rmSync(specialState, { force: true });
			const result = await run([recipe], { clients });

			expect(result.exitCode, recipe).toBe(0);
			expect(kittyArguments(), recipe).toBeNull();
			expect(dispatchCalls(), recipe).toEqual([
				"dispatch focusmonitor DP-2",
				`dispatch togglespecialworkspace ${recipe}`,
			]);
		}
	});

	it("does not let a case-variant Kitty class suppress the Haki launch", async () => {
		const result = await run(["haki"], {
			clientsState: JSON.stringify([
				kittyClient("0xdecoy", "special:haki", "Haoshoku-Haki"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(kittyArguments()).toEqual([
			"--class",
			"haoshoku-haki",
			"--title",
			"haki",
			"--session",
			`${directory}/.config/kitty/haki.session`,
		]);
	});

	it("does not claim a Kitty owned by another Haoshoku class", async () => {
		const result = await run(["numbered-login", "7", "kitty"], {
			clientsState: JSON.stringify([
				kittyClient("0xforeign", "7", "haoshoku-agents"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(kittyArguments()).toEqual([
			"--class",
			"haoshoku-ws7",
			"-d",
			directory,
		]);
		expect(dispatchCalls()).toHaveLength(1);
		expect(dispatchCalls()[0]).toContain(
			"dispatch exec [workspace 7 silent] uwsm-app -- kitty --class haoshoku-ws7",
		);
	});

	it("uses distinct Haki and agents Kitty classes and sessions", async () => {
		for (const { recipe, className, session } of [
			{
				recipe: "haki",
				className: "haoshoku-haki",
				session: "haki.session",
			},
			{
				recipe: "agents",
				className: "haoshoku-agents",
				session: "agents.session",
			},
		]) {
			fs.rmSync(log, { force: true });
			fs.rmSync(kittyCall, { force: true });
			fs.rmSync(specialState, { force: true });
			const result = await run([recipe], { clientsState: "[]" });

			expect(result.exitCode, recipe).toBe(0);
			expect(kittyArguments(), recipe).toEqual([
				"--class",
				className,
				"--title",
				recipe,
				"--session",
				`${directory}/.config/kitty/${session}`,
			]);
			expect(dispatchCalls(), recipe).toEqual([
				"dispatch focusmonitor DP-2",
				`dispatch togglespecialworkspace ${recipe}`,
				`dispatch exec [workspace special:${recipe} silent] uwsm-app -- kitty --class ${className} --title ${recipe} --session ${directory}/.config/kitty/${session}`,
			]);
		}
	});

	it("launches named Kitty sessions instead of adopting a plain Kitty", async () => {
		for (const { recipe, className, session } of [
			{
				recipe: "haki",
				className: "haoshoku-haki",
				session: "haki.session",
			},
			{
				recipe: "agents",
				className: "haoshoku-agents",
				session: "agents.session",
			},
		]) {
			fs.rmSync(log, { force: true });
			fs.rmSync(kittyCall, { force: true });
			fs.rmSync(specialState, { force: true });
			const result = await run([recipe], {
				clientsState: JSON.stringify([
					kittyClient("0xplain", `special:${recipe}`, "kitty"),
				]),
			});

			expect(result.exitCode, recipe).toBe(0);
			expect(kittyArguments(), recipe).toEqual([
				"--class",
				className,
				"--title",
				recipe,
				"--session",
				`${directory}/.config/kitty/${session}`,
			]);
		}
	});

	it("reclaims a restored Haki Kitty instead of launching a duplicate", async () => {
		const result = await run(["haki"], {
			clientsState: JSON.stringify([
				kittyClient("0xrestored", "special:stash", "haoshoku-haki"),
			]),
		});

		expect(result.exitCode).toBe(0);
		expect(kittyArguments()).toBeNull();
		expect(dispatchCalls()).toEqual([
			"dispatch focusmonitor DP-2",
			"dispatch togglespecialworkspace haki",
			"dispatch movetoworkspacesilent special:haki,address:0xrestored",
		]);
	});

	it("keeps the Haki session-name contract in the executable wrapper", async () => {
		const claudeCall = path.join(directory, "claude-call");
		const marker = path.join(directory, "injection-marker");
		fs.writeFileSync(
			path.join(directory, "claude"),
			'#!/usr/bin/env bash\nif (( $# == 0 )); then : > "$CLAUDE_CALL"; else printf \'%s\\0\' "$@" > "$CLAUDE_CALL"; fi\n',
		);
		fs.chmodSync(path.join(directory, "claude"), 0o755);

		const cases = [
			{
				name: "valid",
				config: '{"claudeSessionName":"portable-haki"}\n',
				argv: ["-r", "portable-haki"],
			},
			{ name: "missing", config: null, argv: [] },
			{
				name: "injection",
				config: `{"claudeSessionName":"name; touch ${marker}"}\n`,
				argv: [],
				diagnostic: true,
			},
			{
				name: "multi-document",
				config: '{"claudeSessionName":"one"}\n{"claudeSessionName":"two"}\n',
				argv: [],
				diagnostic: true,
			},
		];

		for (const testCase of cases) {
			fs.rmSync(claudeCall, { force: true });
			fs.rmSync(marker, { force: true });
			if (testCase.config === null) {
				fs.rmSync(path.join(directory, ".haoshoku.json"), { force: true });
			} else {
				fs.writeFileSync(
					path.join(directory, ".haoshoku.json"),
					testCase.config,
				);
			}
			const proc = Bun.spawn(["bash", claudeLocal], {
				env: {
					...process.env,
					CLAUDE_CALL: claudeCall,
					HOME: directory,
					PATH: `${directory}:${process.env.PATH}`,
				},
				stderr: "pipe",
			});
			const stderr = await new Response(proc.stderr).text();

			expect(await proc.exited, testCase.name).toBe(0);
			const argv = fs.readFileSync(claudeCall, "utf8").split("\0");
			if (argv.at(-1) === "") argv.pop();
			expect(argv, testCase.name).toEqual(testCase.argv);
			expect(stderr.includes("claudeSessionName"), testCase.name).toBe(
				Boolean(testCase.diagnostic),
			);
			expect(fs.existsSync(marker), testCase.name).toBe(false);
		}
	});
});
