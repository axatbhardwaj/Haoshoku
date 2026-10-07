import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const homes = [];
const retiredFlags = [
	"--skills",
	"--skills-update",
	"--skills-list",
	"--agent-skills",
	"--explainer-theme",
];
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true });
});
function fixture(withSkills = true) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "skills-retirement-"));
	homes.push(home);
	if (!withSkills) return home;
	for (const name of [
		"visual-explainer",
		"model-routing",
		"html-deliverables",
		"paseo-pr-review",
		"paseo-pr-babysit",
		"tdd",
		"specialist",
	]) {
		const skill = path.join(home, ".agents/skills", name);
		fs.mkdirSync(skill, { recursive: true });
		fs.writeFileSync(path.join(skill, "SKILL.md"), `user-owned ${name}\n`);
		for (const harness of [".claude", ".codex"]) {
			fs.mkdirSync(path.join(home, harness, "skills"), { recursive: true });
			fs.symlinkSync(
				`../../.agents/skills/${name}`,
				path.join(home, harness, "skills", name),
			);
		}
	}
	fs.mkdirSync(path.join(home, ".config/haoshoku"), { recursive: true });
	fs.writeFileSync(
		path.join(home, ".config/haoshoku/visual-explainer.json"),
		'{"theme":"light"}\n',
	);
	for (const [file, content] of [
		[".claude/CLAUDE.md", "personal Claude instructions\n"],
		[".codex/AGENTS.md", "personal Codex instructions\n"],
		[".claude/skills/user-directory/SKILL.md", "independent real directory\n"],
	]) {
		fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
		fs.writeFileSync(path.join(home, file), content);
	}
	fs.symlinkSync(
		"../../.agents/skills/specialist",
		path.join(home, ".codex/skills/custom-link"),
	);
	return home;
}
function snapshot(home) {
	const walk = (directory) =>
		fs
			.readdirSync(directory)
			.sort()
			.flatMap((name) => {
				const file = path.join(directory, name);
				const stat = fs.lstatSync(file);
				const entry = [
					path.relative(home, file),
					stat.mode,
					stat.isSymbolicLink()
						? fs.readlinkSync(file)
						: stat.isFile()
							? createHash("sha256").update(fs.readFileSync(file)).digest("hex")
							: "directory",
				];
				return stat.isDirectory() ? [entry, ...walk(file)] : [entry];
			});
	return walk(home);
}
function run(home, script) {
	const child = Bun.spawnSync([process.execPath, "--eval", script], {
		env: {
			...process.env,
			HOME: home,
			XDG_STATE_HOME: home,
			BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: 5000,
	});
	return {
		code: child.exitCode,
		output: `${child.stdout.toString()}\n${child.stderr.toString()}`,
	};
}

describe("portable skill retirement", () => {
	for (const flag of retiredFlags) {
		const forms = [
			[flag],
			[flag, "true"],
			[`${flag}=true`],
			[flag, "false"],
			[`${flag}=false`],
			[`${flag}=`],
			[flag, "--claude"],
			["--os", "arch", flag],
			["--os=debian-server", flag],
			["--help", flag],
			["--version", flag],
			["--", flag],
		];
		if (flag === "--explainer-theme")
			forms.push([flag, "dark"], [`${flag}=light`], [flag, "invalid"]);
		it.each(
			forms.map((args) => [args]),
		)(`rejects retired ${flag} before any effects (%j)`, (args) => {
			const home = fixture();
			const before = snapshot(home);
			const script = `
				import { mock, spyOn } from "bun:test";
				import childProcess from "node:child_process";
				const effect = (name) => () => { console.error("SIDE_EFFECT=" + name); throw new Error(name); };
				const utilsPath = ${JSON.stringify(path.join(root, "src/common/utils.js"))};
				const utils = await import(utilsPath);
				mock.module(utilsPath, () => ({ ...utils,
					log: { error: console.error, dim() {}, info() {}, warning() {}, success() {} },
					runCommand: effect("runCommand"), promptUser: effect("promptUser"), commandExists: effect("commandExists"),
				}));
				// The early guard must also precede run-log filesystem/probe work.
				mock.module(${JSON.stringify(path.join(root, "src/common/run_log.js"))}, () => ({ startRunLog: effect("startRunLog") }));
				for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]) spyOn(childProcess, name).mockImplementation(effect(name));
				for (const name of ["spawn", "spawnSync"]) spyOn(Bun, name).mockImplementation(effect(name));
				process.argv = [process.execPath, ${JSON.stringify(path.join(root, "haoshoku.js"))}, ...${JSON.stringify(args)}];
				await import(${JSON.stringify(path.join(root, "haoshoku.js"))});
			`;
			const result = run(home, script);
			expect(result.code, result.output).not.toBe(0);
			expect(result.output).toContain(`${flag} has been retired`);
			expect(result.output).toContain("Manage independent skills separately");
			expect(result.output).not.toContain("SIDE_EFFECT=");
			expect(snapshot(home)).toEqual(before);
		});
	}

	for (const target of ["arch", "debian-server"]) {
		for (const withSkills of [true, false]) {
			it(`${withSkills ? "existing" : "fresh"} and repeated ${target} setup preserves user skills and retained tools`, () => {
				const home = fixture(withSkills);
				const before = snapshot(home);
				const script = `
				import { mock, spyOn } from "bun:test";
				import childProcess from "node:child_process";
				const calls = [], commands = [];
				const record = (name, result = true) => async () => { calls.push(name); return result; };
				const utilsPath = ${JSON.stringify(path.join(root, "src/common/utils.js"))};
				const utils = await import(utilsPath);
				mock.module(utilsPath, () => ({ ...utils,
					runCommand: async (command) => { commands.push(command); return true; },
					commandExists: async () => false, promptUser: async () => false, safeCopyFile() {},
				}));
				for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]) spyOn(childProcess, name).mockImplementation(() => { throw new Error("unstubbed process: " + name); });
				for (const name of ["spawn", "spawnSync"]) spyOn(Bun, name).mockImplementation(() => { throw new Error("unstubbed process: " + name); });
				const helpers = {
					configure_claude: ["configureClaude", "claude", { ok: true }],
					configure_codex: ["configureCodex", "codex", { ok: true }],
					configure_agents: ["syncAgentsConfig", "agents", true],
					configure_axstack: ["configureAxstack", "axstack", { ok: true }],
					configure_gh_stack: ["installGhStack", "gh-stack", true],
					configure_pr_watch: ["configurePrWatch", "pr-watch", true],
					configure_hermes_relay: ["configureHermesRelay", "hermes", true],
					configure_t3_code_server: ["configureT3CodeServer", "t3", true],
				};
				for (const [file, [name, label, result]] of Object.entries(helpers)) mock.module(${JSON.stringify(path.join(root, "src/helpers"))} + "/" + file + ".js", () => ({ [name]: record(label, result) }));
				const { configureUserApps, runCachyOSSetup } = await import(${JSON.stringify(path.join(root, "src/os_scripts/cachyos.js"))});
				const { runDebianServerSetup } = await import(${JSON.stringify(path.join(root, "src/os_scripts/debian_server.js"))});
				const noop = async () => true;
				const testUtils = await import(utilsPath);
				for (let pass = 0; pass < 2; pass++) {
					const ok = ${JSON.stringify(target)} === "arch" ? await runCachyOSSetup({
						promptDeviceTypeImpl: noop, startSudoSessionImpl: async () => () => {},
						commandExistsImpl: async () => false, prepareArchPackageManagerImpl: noop,
						ensureRustToolchainImpl: noop, ensureAurHelperImpl: async () => "paru", installDevToolsImpl: noop,
						installSystemPackagesImpl: noop, installFlatpakAppsImpl: noop,
						configureTailscaleT3Impl: record("t3"),
						configureBraveManagedPoliciesImpl: noop, configureHyprmoncfgImpl: noop,
						configureOmarchyWorkspacesImpl: noop, configureOmarchyPluginsImpl: noop,
						configureVoxtypeOsdImpl: noop, configureKdeConnectCommandsImpl: noop,
						configureOmarchyBarImpl: noop, configureOmazedImpl: noop, configureOmarchyAppearanceImpl: noop,
						configureUserAppsImpl: (options) => configureUserApps({ ...options,
							promptUserImpl: testUtils.promptUser, configureGitImpl: noop,
							configureBrowserIntegrationImpl: noop, configureAudioImpl: noop, configureBashImpl: noop,
							runCommandImpl: testUtils.runCommand,
							configureClaudeImpl: record("claude", { ok: true }), configureCodexImpl: record("codex", { ok: true }),
							installGhStackImpl: record("gh-stack"), configurePrWatchImpl: record("pr-watch"),
							syncAgentsConfigImpl: record("agents"), configureAxstackImpl: record("axstack", { ok: true }),
							configureFastfetchImpl: noop, configureGhosttyImpl: noop, enableServicesImpl: noop,
						}),
					}) : await runDebianServerSetup();
					if (!ok) throw new Error("setup incomplete");
				}
				console.log("RESULT=" + JSON.stringify({ calls, commands }));
			`;
				const result = run(home, script);
				expect(result.code, result.output).toBe(0);
				const recorded = JSON.parse(
					result.output.match(/RESULT=(.*)/)?.[1] ?? "null",
				);
				for (const name of [
					"claude",
					"codex",
					"agents",
					"axstack",
					"gh-stack",
					"t3",
				]) {
					expect(recorded.calls.filter((call) => call === name)).toHaveLength(
						2,
					);
				}
				if (target === "debian-server")
					expect(
						recorded.calls.filter((call) => call === "hermes"),
					).toHaveLength(2);

				// Debian legitimately creates SSH/fish directories and a jail fixture.
				for (const directory of [
					".agents",
					".claude",
					".codex",
					".config/haoshoku",
				]) {
					const entries = (all) =>
						all.filter(
							([name]) =>
								name === directory || name.startsWith(`${directory}/`),
						);
					expect(entries(snapshot(home))).toEqual(entries(before));
				}
				expect(
					recorded.commands.filter((command) =>
						/skills@|mattpocock/.test(command),
					),
				).toEqual([]);
			});
		}
	}
});
