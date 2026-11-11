import { afterEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureOmarchyDictation } from "../src/helpers/configure_omarchy_dictation.js";

const homes = [];
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true });
});

function fixture({
	installed = false,
	hostname = "io",
	deviceType = "pc",
	fail,
	plugins,
} = {}) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "dictation-"));
	homes.push(home);
	const hypr = path.join(home, ".config/hypr");
	fs.mkdirSync(hypr, { recursive: true });
	fs.writeFileSync(
		path.join(hypr, "hyprland.lua"),
		'require("hypr.bindings")\n',
	);
	fs.writeFileSync(
		path.join(hypr, "bindings.lua"),
		"-- personal F9 and unrelated bindings stay intact\n",
	);
	const commands = [];
	const run = async (command) => {
		commands.push(command);
		return command !== fail;
	};
	return {
		home,
		commands,
		options: {
			home,
			hostname,
			deviceType,
			env: {},
			commandExistsImpl: async (command) =>
				command !== "superwhisper" || installed,
			runCommandImpl: run,
			captureCommandImpl: async (command) => {
				commands.push(command);
				if (command === "omarchy version")
					return { exitCode: 0, stdout: "Omarchy 4.5.0\n" };
				if (command.startsWith("systemctl"))
					return { exitCode: 0, stdout: "loaded\n" };
				if (command === "omarchy plugin list --json")
					return {
						exitCode: 0,
						stdout:
							plugins ??
							JSON.stringify([
								{ id: "omarchy.menu", enabled: true },
								{ id: "io.github.nodrej.speech-orb", enabled: true },
							]),
					};
				return { exitCode: 0, stdout: "" };
			},
		},
	};
}

it("retires the old daemon and orb before installing the official background backend", async () => {
	const { options, commands } = fixture();
	await configureOmarchyDictation(options);
	const disable = commands.indexOf(
		"systemctl --user disable --now voxtype.service",
	);
	const orb = commands.indexOf(
		"omarchy plugin disable io.github.nodrej.speech-orb",
	);
	const install = commands.indexOf(
		"omarchy-install-dictation-superwhisper --background",
	);
	expect(disable).toBeGreaterThanOrEqual(0);
	expect(orb).toBeGreaterThan(disable);
	expect(install).toBeGreaterThan(orb);
	expect(commands).not.toContain(
		"systemctl --user try-restart voxtype.service",
	);
});

it("preserves installed Superwhisper preferences, models and T3 voice on rerun", async () => {
	const { options, commands, home } = fixture({ installed: true });
	const preserved = [
		".config/superwhisper/settings.json",
		".local/share/superwhisper/models/custom.bin",
		".config/t3/voice.json",
	];
	for (const name of preserved) {
		fs.mkdirSync(path.dirname(path.join(home, name)), { recursive: true });
		fs.writeFileSync(path.join(home, name), `private user data: ${name}\n`);
	}
	await configureOmarchyDictation(options);
	commands.length = 0;
	await configureOmarchyDictation(options);
	expect(commands).toContain(
		"systemctl --user enable --now superwhisper.service",
	);
	expect(commands).toContain("superwhisper shortcuts set hold none");
	expect(commands).toContain("omarchy-dictation-use superwhisper");
	expect(commands).not.toContain(
		"omarchy-install-dictation-superwhisper --background",
	);
	for (const name of preserved)
		expect(fs.readFileSync(path.join(home, name), "utf8")).toBe(
			`private user data: ${name}\n`,
		);
});

it("enables desktop dictation on iobook's laptop profile", async () => {
	const { options, commands } = fixture({
		hostname: "iobook",
		deviceType: "laptop",
	});
	await configureOmarchyDictation(options);
	expect(commands).toContain(
		"omarchy-install-dictation-superwhisper --background",
	);
});

it.each([
	["iobox", "iobox"],
	["iosatellite", "iosatellite"],
	["axat-vps", "pc"],
	["io", "iobox"],
	["unknown", "laptop"],
])("retires speech on %s/%s without desktop installation or bindings", async (hostname, deviceType) => {
	const { options, commands, home } = fixture({ hostname, deviceType });
	await configureOmarchyDictation(options);
	expect(commands).toContain("systemctl --user disable --now voxtype.service");
	expect(commands).toContain(
		"omarchy plugin disable io.github.nodrej.speech-orb",
	);
	expect(commands.some((command) => /superwhisper|hyprctl/.test(command))).toBe(
		false,
	);
	expect(
		fs.readFileSync(path.join(home, ".config/hypr/hyprland.lua"), "utf8"),
	).toBe('require("hypr.bindings")\n');
});

it.each([
	"systemctl --user disable --now voxtype.service",
	"omarchy plugin disable io.github.nodrej.speech-orb",
	"omarchy-install-dictation-superwhisper --background",
])("reports failure and stops migration when %s fails", async (fail) => {
	const { options, commands } = fixture({ fail });
	const result = await configureOmarchyDictation(options);
	expect(result.ok).toBe(false);
	expect(commands.at(-1)).toBe(fail);
});

it("refuses a bad plugin snapshot before installing another dictation backend", async () => {
	const { options, commands } = fixture({ plugins: "invalid json" });
	expect((await configureOmarchyDictation(options)).ok).toBe(false);
	expect(commands).not.toContain(
		"omarchy-install-dictation-superwhisper --background",
	);
});

it("persists one F9 hold pair after personal bindings without editing them", async () => {
	const { options, home } = fixture({ installed: true });
	await configureOmarchyDictation(options);
	await configureOmarchyDictation(options);
	const hypr = path.join(home, ".config/hypr");
	const main = fs.readFileSync(path.join(hypr, "hyprland.lua"), "utf8");
	expect(main.trim().split("\n")).toEqual([
		'require("hypr.bindings")',
		'require("hypr.haoshoku.dictation")',
	]);
	expect(fs.readFileSync(path.join(hypr, "bindings.lua"), "utf8")).toBe(
		"-- personal F9 and unrelated bindings stay intact\n",
	);
});

const lua = Bun.which("lua5.4") ?? Bun.which("lua");
(lua ? it : it.skip)(
	"executes exactly one generic F9 press/release pair over an existing pair",
	async () => {
		const { options, home } = fixture({ installed: true });
		await configureOmarchyDictation(options);
		const hypr = path.join(home, ".config/hypr");
		fs.writeFileSync(
			path.join(hypr, "bindings.lua"),
			'o.bind_hold("F9", "Record", "voxtype record start", "Paste", "voxtype record stop")\n',
		);
		const result = Bun.spawnSync([
			lua,
			"-e",
			`
package.path = ${JSON.stringify(path.join(home, ".config/?.lua"))} .. ";" .. package.path
local presses, releases = {}, {}
hl = {unbind = function(key) assert(key == "F9"); presses = {}; releases = {} end}
o = {bind_hold = function(key, _, start, _, stop)
  assert(key == "F9"); table.insert(presses, start); table.insert(releases, stop)
end}
dofile(${JSON.stringify(path.join(hypr, "hyprland.lua"))})
assert(#presses == 1 and presses[1] == "omarchy-dictation start")
assert(#releases == 1 and releases[1] == "omarchy-dictation stop")
`,
		]);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
	},
);
