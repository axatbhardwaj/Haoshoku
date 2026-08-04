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
	let specialState;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-special-"));
		log = path.join(directory, "calls");
		specialState = path.join(directory, "special-workspace-state");
		const hyprctl = path.join(directory, "hyprctl");
		fs.writeFileSync(
			hyprctl,
			`#!/usr/bin/env bash
if [[ -f "$SPECIAL_STATE" ]]; then state="$(< "$SPECIAL_STATE")"; else state=""; fi
if [[ "$1 $2" == "clients -j" ]]; then
  echo '[]'
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
else
  printf '%s\\n' "$*" >> "$CALL_LOG"
fi
`,
		);
		fs.chmodSync(hyprctl, 0o755);
	});
	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	async function run(args, home = directory) {
		const proc = Bun.spawn([script, ...args], {
			env: {
				...process.env,
				HOME: home,
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

	it("rejects unknown recipes without dispatching", async () => {
		const result = await run(["anything"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown workspace recipe");
		expect(fs.existsSync(log)).toBe(false);
	});

	it("opens Flux in its isolated Chromium profile and class", async () => {
		expect((await run(["browser-flux"])).exitCode).toBe(0);
		const calls = fs.readFileSync(log, "utf8");
		expect(calls).toContain("dispatch focusmonitor DP-1");
		expect(calls).toContain("dispatch togglespecialworkspace browser-flux");
		expect(calls).toContain(
			`--user-data-dir=${directory}/.config/chromium-haoshoku/flux --class=chromium-flux`,
		);
	});

	it("opens DeFi in a different Chromium profile", async () => {
		expect((await run(["browser-defi"])).exitCode).toBe(0);
		expect(fs.readFileSync(log, "utf8")).toContain(
			`--user-data-dir=${directory}/.config/chromium-haoshoku/defi --class=chromium-defi`,
		);
	});

	// Mutation caught: unconditionally toggling an already-visible workspace hides
	// it, so an explicit browser recipe cannot reliably reveal and focus it.
	for (const recipe of ["browser-flux", "browser-defi"]) {
		// Mutation caught: omitting the reveal action when the browser workspace is
		// initially absent leaves the explicit browser recipe off-screen.
		it(`reveals ${recipe} when the special workspace is initially absent`, async () => {
			expect(fs.existsSync(specialState)).toBe(false);

			expect((await run([recipe])).exitCode).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(recipe);
		});

		it(`keeps ${recipe} visible when the explicit recipe is invoked again`, async () => {
			fs.writeFileSync(specialState, recipe);

			expect((await run([recipe])).exitCode).toBe(0);
			expect(fs.readFileSync(specialState, "utf8")).toBe(recipe);
		});
	}
});
