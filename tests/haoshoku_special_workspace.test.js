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
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-special-"));
		log = path.join(directory, "calls");
		const hyprctl = path.join(directory, "hyprctl");
		fs.writeFileSync(
			hyprctl,
			`#!/usr/bin/env bash\nif [[ "$1 $2" == "clients -j" ]]; then echo '[]'; else printf '%s\\n' "$*" >> "$CALL_LOG"; fi\n`,
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
});
