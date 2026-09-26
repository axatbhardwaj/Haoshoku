import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.join(
	import.meta.dir,
	"..",
	"configs",
	"scripts",
	"haoshoku-primary-app",
);

describe("haoshoku-primary-app", () => {
	let home;
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-primary-"));
		fs.mkdirSync(path.join(home, ".config", "haoshoku"), { recursive: true });
		fs.mkdirSync(path.join(home, "bin"));
		fs.mkdirSync(path.join(home, "share", "applications"), { recursive: true });
		for (const [app, appClass] of [
			["stably-orca", "orca"],
			["t3code", "t3code"],
		]) {
			fs.writeFileSync(path.join(home, "bin", app), "#!/bin/sh\nexit 0\n", {
				mode: 0o755,
			});
			fs.writeFileSync(
				path.join(home, "share", "applications", `${app}.desktop`),
				`[Desktop Entry]\nExec=${app}\nStartupWMClass=${appClass}\n`,
			);
		}
		fs.writeFileSync(
			path.join(home, ".config", "haoshoku", "primary-app"),
			"stably-orca\n",
		);
		fs.writeFileSync(path.join(home, "clients.json"), "[]");
		fs.writeFileSync(
			path.join(home, "bin", "hyprctl"),
			`#!/bin/bash
if [[ "$1 $2" == "clients -j" ]]; then
  cat "$CLIENTS_FILE"
else
  printf '%s\\n' "$2" >> "$DISPATCH_LOG"
  if [[ -n "\${OPENED_CLIENT:-}" && "$2" == hl.dsp.exec_cmd* ]]; then
    printf '%s\\n' "$OPENED_CLIENT" > "$CLIENTS_FILE"
  fi
fi
`,
			{ mode: 0o755 },
		);
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	async function run(
		mode,
		clients,
		app = "stably-orca",
		openedClient = "",
		target = "1",
	) {
		fs.writeFileSync(path.join(home, "clients.json"), clients);
		fs.writeFileSync(
			path.join(home, ".config", "haoshoku", "primary-app"),
			`${app}\n`,
		);
		const proc = Bun.spawn(
			[script, mode, ...(mode === "focus" ? [target] : [])],
			{
				env: {
					...process.env,
					HOME: home,
					XDG_CONFIG_HOME: path.join(home, ".config"),
					XDG_DATA_HOME: path.join(home, "share"),
					PATH: `${path.join(home, "bin")}:${process.env.PATH}`,
					CLIENTS_FILE: path.join(home, "clients.json"),
					DISPATCH_LOG: path.join(home, "dispatches"),
					OPENED_CLIENT: openedClient,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const output = await new Response(proc.stderr).text();
		const code = await proc.exited;
		const dispatches = fs.existsSync(path.join(home, "dispatches"))
			? fs.readFileSync(path.join(home, "dispatches"), "utf8")
			: "";
		return { code, output, dispatches };
	}

	it("moves an existing app to workspace 6 and focuses it", async () => {
		const result = await run(
			"focus",
			'[{"class":"orca","address":"0xabc","workspace":{"name":"1"}}]',
			"stably-orca",
			"",
			"6",
		);
		expect(result.code).toBe(0);
		expect(result.dispatches.trim().split("\n")).toEqual([
			'hl.dsp.window.move({ workspace = "6", window = "address:0xabc", follow = false })',
			'hl.dsp.focus({ workspace = "6" })',
			'hl.dsp.focus({ window = "address:0xabc" })',
		]);
		expect(result.dispatches).not.toContain("exec_cmd");
	});

	it("focuses the app without moving it when it is already on the requested workspace", async () => {
		const result = await run(
			"focus",
			'[{"class":"orca","address":"0xabc","workspace":{"name":"6"}}]',
			"stably-orca",
			"",
			"6",
		);
		expect(result.code).toBe(0);
		expect(result.dispatches).toContain('hl.dsp.focus({ workspace = "6" })');
		expect(result.dispatches).not.toContain("window.move");
	});

	it("uses the replacement executable and its desktop window class", async () => {
		const result = await run(
			"focus",
			'[{"class":"t3code","address":"0xdef","workspace":{"name":"3"}}]',
			"t3code",
		);
		expect(result.code).toBe(0);
		expect(result.dispatches).toContain(
			'hl.dsp.window.move({ workspace = "1", window = "address:0xdef", follow = false })',
		);
		expect(result.dispatches).toContain('hl.dsp.focus({ workspace = "1" })');
		expect(result.dispatches).not.toContain("exec_cmd");
	});

	it("launches a missing app on workspace 1 without changing focus at login", async () => {
		const result = await run("login", "[]");
		expect(result.code).toBe(0);
		expect(result.dispatches).toContain(
			"[workspace 1 silent] uwsm-app -- stably-orca",
		);
		expect(result.dispatches).not.toContain("hl.dsp.focus");
	});

	it("moves a newly launched app to workspace 6 and focuses it", async () => {
		const result = await run(
			"focus",
			"[]",
			"stably-orca",
			'[{"class":"orca","address":"0xnew","workspace":{"name":"1"}}]',
			"6",
		);
		expect(result.code).toBe(0);
		expect(result.dispatches).toContain(
			"[workspace 1 silent] uwsm-app -- stably-orca",
		);
		expect(result.dispatches).toContain(
			'hl.dsp.window.move({ workspace = "6", window = "address:0xnew", follow = false })',
		);
		expect(result.dispatches).toContain('hl.dsp.focus({ workspace = "6" })');
		expect(result.dispatches).toContain(
			'hl.dsp.focus({ window = "address:0xnew" })',
		);
	});

	it("does not launch a duplicate after a failed client probe", async () => {
		const result = await run("login", "{bad json");
		expect(result.code).not.toBe(0);
		expect(result.dispatches).toBe("");
	});

	it("sets the workspace rule from the same executable setting", async () => {
		const module = path.join(
			import.meta.dir,
			"..",
			"configs",
			"omarchy",
			"haoshoku",
			"primary_app.lua",
		);
		for (const [app, expected] of [
			["stably-orca", "^orca$"],
			["t3code", "^t3code$"],
		]) {
			fs.writeFileSync(
				path.join(home, ".config", "haoshoku", "primary-app"),
				`${app}\n`,
			);
			const proc = Bun.spawn(
				[
					"lua",
					"-e",
					`o = { window = function(class, rule) print(class, rule.workspace) end }; dofile(${JSON.stringify(module)})`,
				],
				{
					env: {
						...process.env,
						HOME: home,
						XDG_CONFIG_HOME: path.join(home, ".config"),
						XDG_DATA_HOME: path.join(home, "share"),
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const output = await new Response(proc.stdout).text();
			expect(await proc.exited).toBe(0);
			expect(output).toContain(`${expected}\t1 silent`);
		}
	});
});
