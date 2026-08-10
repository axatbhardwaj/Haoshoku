import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script =
	process.env.HAOSHOKU_SPECIAL_WORKSPACE_SCRIPT ??
	path.join(
		import.meta.dir,
		"..",
		"configs",
		"scripts",
		"haoshoku-special-workspace",
	);
describe("haoshoku-special-workspace failed hyprctl probes", () => {
	let directory;
	let log;
	let commandDirectory;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-probe-"));
		log = path.join(directory, "dispatches");
		commandDirectory = path.join(directory, "commands");
		fs.mkdirSync(commandDirectory);
		for (const command of ["bash", "dirname", "jq", "sleep"]) {
			const systemCommand = Bun.which(command);
			if (!systemCommand)
				throw new Error(`missing test dependency: ${command}`);
			fs.symlinkSync(systemCommand, path.join(commandDirectory, command));
		}
		const hyprctl = path.join(commandDirectory, "hyprctl");
		fs.writeFileSync(
			hyprctl,
			`#!/usr/bin/env bash
probe="$1 $2"
matching_probe_call=0
if [[ "$probe" == "$FAILED_PROBE" ]]; then
  if [[ -r "$PROBE_CALL_COUNT" ]]; then
    read -r matching_probe_call < "$PROBE_CALL_COUNT"
  fi
  ((matching_probe_call += 1))
  printf '%s\n' "$matching_probe_call" > "$PROBE_CALL_COUNT"
fi
if [[ "$probe" == "$FAILED_PROBE" && ( -z "$FAILED_PROBE_CALL" || "$matching_probe_call" == "$FAILED_PROBE_CALL" ) ]]; then
  case "$PROBE_FAILURE" in
    invalid-json) printf '{not-json\n' ;;
    empty-output) : ;;
    non-zero-exit) exit 23 ;;
  esac
elif [[ "$probe" == "monitors -j" ]]; then
  printf '[{"name":"DP-1","focused":true,"specialWorkspace":{"name":"%s"}},{"name":"DP-2","focused":false,"specialWorkspace":{"name":""}},{"name":"HDMI-A-1","focused":false,"specialWorkspace":{"name":""}}]\n' "$VISIBLE_WORKSPACE"
elif [[ "$probe" == "clients -j" ]]; then
  printf '%s\n' "$CLIENTS_JSON"
elif [[ "$1" == "dispatch" ]]; then
  if [[ -n "\${DISPATCH_DIAGNOSTIC:-}" ]]; then
    printf '%s\n' "$DISPATCH_DIAGNOSTIC" >&2
    exit 42
  fi
  printf '%s\n' "$*" >> "$DISPATCH_LOG"
fi
`,
		);
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
			helper,
			`#!/usr/bin/env bash
case "$1" in
  has-session|attach) exit 0 ;;
  *) exit 1 ;;
esac
`,
		);
		fs.writeFileSync(
			path.join(commandDirectory, "systemctl"),
			"#!/usr/bin/env bash\nexit 0\n",
		);
		fs.writeFileSync(
			path.join(commandDirectory, "kitty"),
			'#!/usr/bin/env bash\nshift 2\nexec "$@"\n',
		);
		fs.writeFileSync(
			path.join(commandDirectory, "warp-terminal"),
			"#!/usr/bin/env bash\nexit 0\n",
		);
		fs.writeFileSync(
			path.join(commandDirectory, "brave-origin"),
			'#!/usr/bin/env bash\n[[ -z "${CHROMIUM_LOG:-}" ]] || printf \'%s\\n\' "$*" >> "$CHROMIUM_LOG"\n',
		);
		for (const executable of [
			hyprctl,
			helper,
			path.join(commandDirectory, "systemctl"),
			path.join(commandDirectory, "kitty"),
			path.join(commandDirectory, "warp-terminal"),
			path.join(commandDirectory, "brave-origin"),
		]) {
			fs.chmodSync(executable, 0o755);
		}
	});

	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	async function run(
		args,
		failedProbe,
		failure,
		visibleWorkspace = "",
		dispatchDiagnostic = "",
		clientsJson = "[]",
		chromiumLog = "",
		failedProbeCall = "",
	) {
		const proc = Bun.spawn([script, ...args], {
			env: {
				...process.env,
				HOME: directory,
				CLIENTS_JSON: clientsJson,
				DISPATCH_DIAGNOSTIC: dispatchDiagnostic,
				CHROMIUM_LOG: chromiumLog,
				DISPATCH_LOG: log,
				FAILED_PROBE: failedProbe,
				FAILED_PROBE_CALL: failedProbeCall,
				PATH: commandDirectory,
				PROBE_CALL_COUNT: path.join(directory, "probe-call-count"),
				PROBE_FAILURE: failure,
				VISIBLE_WORKSPACE: visibleWorkspace
					? `special:${visibleWorkspace}`
					: "",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		return {
			dispatches: fs.existsSync(log)
				? fs.readFileSync(log, "utf8").trim().split("\n")
				: [],
			exitCode,
			stderr: await new Response(proc.stderr).text(),
		};
	}

	it("preserves dispatch diagnostics while allowing the recipe to continue", async () => {
		const diagnostic = "hyprctl dispatch rejected test request";
		const result = await run(["stash"], "", "non-zero-exit", "", diagnostic);

		expect(result).toEqual({
			dispatches: [],
			exitCode: 0,
			stderr: `${diagnostic}\n${diagnostic}\n`,
		});
	});

	it("reveals a warm browser workspace when Brave Origin URL forwarding fails", async () => {
		const chromium = path.join(commandDirectory, "brave-origin");
		const chromiumLog = path.join(directory, "chromium");
		fs.writeFileSync(
			chromium,
			'#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$CHROMIUM_LOG"\nexit 1\n',
		);
		fs.chmodSync(chromium, 0o755);

		const result = await run(
			["browser-toggle", "flux", "https://example.test/warm-forward"],
			"",
			"non-zero-exit",
			"",
			"",
			JSON.stringify([{ class: "chromium-flux" }]),
			chromiumLog,
		);

		expect(result).toEqual({
			dispatches: [
				"dispatch focusmonitor DP-1",
				"dispatch togglespecialworkspace browser-flux",
			],
			exitCode: 0,
			stderr: "",
		});
		expect(fs.readFileSync(chromiumLog, "utf8")).toContain(
			`--user-data-dir=${directory}/.config/brave-haoshoku/flux`,
		);
		expect(fs.readFileSync(chromiumLog, "utf8")).toContain(
			"https://example.test/warm-forward",
		);
	});

	for (const failure of ["invalid-json", "empty-output", "non-zero-exit"]) {
		it(`[${failure}] monitor probe falls back to the pinned stash monitor`, async () => {
			const result = await run(["stash"], "monitors -j", failure);

			expect(result).toEqual({
				dispatches: [
					"dispatch focusmonitor DP-1",
					"dispatch togglespecialworkspace stash",
				],
				exitCode: 0,
				stderr: "",
			});
		});

		it(`[${failure}] Haki client probe fails closed without Warp ownership actions`, async () => {
			const result = await run(["haki"], "clients -j", failure);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(
				result.dispatches.filter((dispatch) =>
					[
						"dispatch exec ",
						"dispatch tagwindow ",
						"dispatch movetoworkspace",
					].some((prefix) => dispatch.startsWith(prefix)),
				),
			).toEqual([]);
		});

		it(`[${failure}] exact-class client probe falls back to launching Brave Origin`, async () => {
			const result = await run(
				["browser-toggle", "flux"],
				"clients -j",
				failure,
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.dispatches.slice(0, 2)).toEqual([
				"dispatch focusmonitor DP-1",
				"dispatch togglespecialworkspace browser-flux",
			]);
			expect(result.dispatches[2]).toStartWith(
				"dispatch exec [workspace special:browser-flux silent] uwsm-app -- brave-origin ",
			);
			expect(result.dispatches[2]).toContain("--class=chromium-flux");
		});
	}

	it("rejects a multi-document client probe before launching Warp", async () => {
		const result = await run(
			["numbered-login", "7", "warp"],
			"",
			"non-zero-exit",
			"",
			"",
			"[]\n[]",
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(
			result.dispatches.filter((dispatch) =>
				[
					"dispatch exec ",
					"dispatch tagwindow ",
					"dispatch movetoworkspace",
				].some((prefix) => dispatch.startsWith(prefix)),
			),
		).toEqual([]);
	});

	for (const failure of ["invalid-json", "empty-output", "non-zero-exit"]) {
		it(`[${failure}] numbered Warp initial probe performs no ownership action`, async () => {
			const result = await run(
				["numbered-login", "7", "warp"],
				"clients -j",
				failure,
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(
				result.dispatches.filter((dispatch) =>
					[
						"dispatch exec ",
						"dispatch tagwindow ",
						"dispatch movetoworkspace",
					].some((prefix) => dispatch.startsWith(prefix)),
				),
			).toEqual([]);
		});
	}

	it("does not guess an address after a Warp poll probe fails", async () => {
		const result = await run(
			["numbered-login", "7", "warp"],
			"clients -j",
			"invalid-json",
			"",
			"",
			"[]",
			"",
			"2",
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(
			result.dispatches.filter((dispatch) =>
				dispatch.startsWith("dispatch exec "),
			),
		).toHaveLength(1);
		expect(
			result.dispatches.filter((dispatch) =>
				["dispatch tagwindow ", "dispatch movetoworkspace"].some((prefix) =>
					dispatch.startsWith(prefix),
				),
			),
		).toEqual([]);
	});

	it("does not guess an address after a later Warp poll exits nonzero", async () => {
		const result = await run(
			["numbered-login", "7", "warp"],
			"clients -j",
			"non-zero-exit",
			"",
			"",
			"[]",
			"",
			"2",
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(
			result.dispatches.filter((dispatch) =>
				dispatch.startsWith("dispatch exec "),
			),
		).toHaveLength(1);
		expect(
			result.dispatches.filter((dispatch) =>
				["dispatch tagwindow ", "dispatch movetoworkspace"].some((prefix) =>
					dispatch.startsWith(prefix),
				),
			),
		).toEqual([]);
	});

	it("leaves one launched Warp unowned when its new address never appears", async () => {
		const result = await run(
			["numbered-login", "7", "warp"],
			"",
			"non-zero-exit",
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(
			result.dispatches.filter((dispatch) =>
				dispatch.startsWith("dispatch exec "),
			),
		).toHaveLength(1);
		expect(
			result.dispatches.filter((dispatch) =>
				["dispatch tagwindow ", "dispatch movetoworkspace"].some((prefix) =>
					dispatch.startsWith(prefix),
				),
			),
		).toEqual([]);
	});

	for (const failure of ["invalid-json", "empty-output", "non-zero-exit"]) {
		it(`[${failure}] exact-class client probe preserves a visible browser-toggle hide`, async () => {
			const result = await run(
				["browser-toggle", "flux"],
				"clients -j",
				failure,
				"browser-flux",
			);

			expect(result).toEqual({
				dispatches: ["dispatch togglespecialworkspace browser-flux"],
				exitCode: 0,
				stderr: "",
			});
		});
	}

	for (const { probe, failedProbeCall } of [
		{ probe: "occupancy", failedProbeCall: "1" },
		{ probe: "stray-address", failedProbeCall: "2" },
	]) {
		for (const failure of ["non-zero-exit", "invalid-json"]) {
			it(`[${failure}] workspace-7 ${probe} probe failure causes no kitty action`, async () => {
				const result = await run(
					["numbered-login", "7", "kitty"],
					"clients -j",
					failure,
					"",
					"",
					"[]",
					"",
					failedProbeCall,
				);

				expect(result.exitCode).toBe(0);
				expect(result.stderr).toBe("");
				expect(
					result.dispatches.filter((dispatch) =>
						[
							"dispatch exec ",
							"dispatch focuswindow",
							"dispatch movetoworkspace",
						].some((prefix) => dispatch.startsWith(prefix)),
					),
				).toEqual([]);
			});
		}
	}

	it("exits successfully for every accepted recipe when Hyprland is unavailable", async () => {
		fs.writeFileSync(
			path.join(commandDirectory, "hyprctl"),
			"#!/usr/bin/env bash\nexit 1\n",
		);
		fs.chmodSync(path.join(commandDirectory, "hyprctl"), 0o755);

		for (const { name, args } of [
			{ name: "numbered steam", args: ["numbered", "1", "steam"] },
			{ name: "numbered discord", args: ["numbered", "2", "discord"] },
			{
				name: "numbered communication",
				args: ["numbered", "3", "communication-numbered"],
			},
			{ name: "numbered kitty", args: ["numbered", "7", "kitty"] },
			{ name: "numbered Warp", args: ["numbered", "7", "warp"] },
			{
				name: "numbered-login kitty",
				args: ["numbered-login", "7", "kitty"],
			},
			{ name: "numbered notion", args: ["numbered", "4", "notion"] },
			{ name: "browser", args: ["browser", "flux"] },
			{ name: "browser-toggle", args: ["browser-toggle", "flux"] },
			{ name: "browser-flux", args: ["browser-flux"] },
			{ name: "browser-defi", args: ["browser-defi"] },
			{ name: "haki", args: ["haki"] },
			{ name: "assistants", args: ["assistants"] },
			{ name: "music", args: ["music"] },
			{ name: "1password", args: ["1password"] },
			{ name: "communication", args: ["communication"] },
			{ name: "stash", args: ["stash"] },
			{ name: "x", args: ["x"] },
			{ name: "youtube", args: ["youtube"] },
			{ name: "jiohotstar", args: ["jiohotstar"] },
			{ name: "crunchyroll", args: ["crunchyroll"] },
			{ name: "reanime", args: ["reanime"] },
		]) {
			const result = await run(args, "", "non-zero-exit");
			expect(result.exitCode, name).toBe(0);
			expect(result.stderr, name).toBe("");
		}
	});
});
