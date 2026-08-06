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
		for (const command of ["bash", "dirname", "jq"]) {
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
if [[ "$probe" == "$FAILED_PROBE" ]]; then
  case "$PROBE_FAILURE" in
    invalid-json) printf '{not-json\n' ;;
    empty-output) : ;;
    non-zero-exit) exit 23 ;;
  esac
elif [[ "$probe" == "monitors -j" ]]; then
  printf '[{"name":"DP-1","focused":true,"specialWorkspace":{"name":"%s"}}]\n' "$VISIBLE_WORKSPACE"
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
		for (const executable of [
			hyprctl,
			helper,
			path.join(commandDirectory, "systemctl"),
			path.join(commandDirectory, "kitty"),
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
				PATH: commandDirectory,
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

	it("reveals a warm browser workspace when Chromium URL forwarding fails", async () => {
		const chromium = path.join(commandDirectory, "chromium");
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
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux`,
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

		it(`[${failure}] regex client probe falls back to launching the IO session`, async () => {
			const result = await run(["io"], "clients -j", failure);
			const helper = path.join(
				directory,
				".local",
				"bin",
				"haoshoku-claude-remote-control",
			);

			expect(result).toEqual({
				dispatches: [
					"dispatch focusmonitor DP-2",
					"dispatch togglespecialworkspace io",
					`dispatch exec [workspace special:io silent] uwsm-app -- kitty --class haoshoku-io ${helper} attach io`,
				],
				exitCode: 0,
				stderr: "",
			});
		});

		it(`[${failure}] exact-class client probe falls back to launching Chromium`, async () => {
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
				"dispatch exec [workspace special:browser-flux silent] uwsm-app -- chromium ",
			);
			expect(result.dispatches[2]).toContain("--class=chromium-flux");
		});
	}

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
			{ name: "numbered notion", args: ["numbered", "4", "notion"] },
			{ name: "browser", args: ["browser", "flux"] },
			{ name: "browser-toggle", args: ["browser-toggle", "flux"] },
			{ name: "browser-flux", args: ["browser-flux"] },
			{ name: "browser-defi", args: ["browser-defi"] },
			{ name: "io", args: ["io"] },
			{ name: "assistants", args: ["assistants"] },
			{ name: "music", args: ["music"] },
			{ name: "1password", args: ["1password"] },
			{ name: "communication", args: ["communication"] },
			{ name: "stash", args: ["stash"] },
			{ name: "x", args: ["x"] },
			{ name: "youtube", args: ["youtube"] },
			{ name: "crunchyroll", args: ["crunchyroll"] },
		]) {
			const result = await run(args, "", "non-zero-exit");
			expect(result.exitCode, name).toBe(0);
			expect(result.stderr, name).toBe("");
		}
	});
});
