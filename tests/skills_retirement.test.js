import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const homes = [];
const retiredServiceFlags = [
	"--claude-remote-control",
	"--claude-remote-control-backup",
	"--claude-stay-awake",
	"--claude-stay-awake-backup",
	"--pr-watch",
	"--pr-watch-backup",
];
const retiredFlags = [
	...retiredServiceFlags,
	"--skills",
	"--skills-update",
	"--skills-list",
	"--agent-skills",
	"--explainer-theme",
];
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true });
});
function fixture(withLegacy = true) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "skills-retirement-"));
	homes.push(home);
	for (const [file, content] of [
		[".config/editor/settings.json", '{"personal":true}\n'],
		...(withLegacy
			? [
					[
						".local/bin/haoshoku-claude-remote-control",
						"personal supervisor\n",
					],
					[".local/bin/claude-stay-awake", "personal inhibitor\n"],
					[".local/bin/pr-watch", "personal watcher wrapper\n"],
					[".local/bin/pr-watch.js", "personal watcher runtime\n"],
					[
						".config/systemd/user/claude-remote-control@.service",
						"personal remote unit\n",
					],
					[
						".config/systemd/user/claude-stay-awake.service",
						"personal inhibitor unit\n",
					],
					[
						".config/haoshoku/claude-remote-control/haki.env",
						"personal remote environment\n",
					],
					[".local/state/pr-watch/repo-1.json", '{"personal":"watch state"}\n'],
					[
						".claude.json",
						'{"personal":true,"bypassPermissionsModeAccepted":false}\n',
					],
				]
			: []),
	]) {
		const target = path.join(home, file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content, { mode: 0o600 });
	}
	if (!withLegacy) return home;
	const wants = path.join(home, ".config/systemd/user/default.target.wants");
	fs.mkdirSync(wants, { recursive: true });
	fs.symlinkSync(
		"../claude-remote-control@.service",
		path.join(wants, "claude-remote-control@haki.service"),
	);
	fs.symlinkSync(
		"../claude-stay-awake.service",
		path.join(wants, "claude-stay-awake.service"),
	);
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

describe("selected integration retirement", () => {
	it("keeps help available without offering retired integrations", () => {
		const home = fixture();
		const before = snapshot(home);
		const result = run(
			home,
			`process.argv = [process.execPath, ${JSON.stringify(path.join(root, "haoshoku.js"))}, "--help"]; await import(${JSON.stringify(path.join(root, "haoshoku.js"))});`,
		);
		expect(result.code, result.output).toBe(0);
		for (const flag of retiredFlags) expect(result.output).not.toContain(flag);
		for (const flag of [
			"--claude",
			"--codex",
			"--axstack",
			"--gh-stack",
			"--server-t3-code",
			"--server-hermes-relay",
			"--worktree-cleanup",
		])
			expect(result.output).toContain(flag);
		expect(snapshot(home)).toEqual(before);
	});
	for (const flag of retiredFlags) {
		const forms = [
			[flag],
			[flag, "true"],
			[`${flag}=true`],
			[flag, "false"],
			[`${flag}=false`],
			[`${flag}=`],
			[`${flag}=malformed`],
			["--unknown", flag],
			[flag, "--pr-watch", "--skills"],
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
			expect(result.output).toContain(
				retiredServiceFlags.includes(flag)
					? "Manage existing services and watchers separately"
					: "Manage independent skills separately",
			);
			expect(result.output).not.toContain("SIDE_EFFECT=");
			expect(snapshot(home)).toEqual(before);
		});
	}

	for (const target of ["arch", "debian-server"]) {
		for (const withLegacy of [true, false]) {
			it(`${withLegacy ? "existing" : "fresh"} and repeated ${target} setup preserves legacy installations and retained tools`, () => {
				const home = fixture(withLegacy);
				const before = snapshot(home);
				const protectedRoots = [
					".agents",
					".claude",
					".codex",
					".config/haoshoku",
					".config/systemd",
					".config/editor",
					".local/bin",
					".local/state",
					".claude.json",
				];
				const script = `
				import fs from "node:fs";
				import path from "node:path";
				import { createHash } from "node:crypto";
				const snapshot = ${snapshot.toString()};
				const protectedRoots = ${JSON.stringify(protectedRoots)};
				const preserved = [];
				import { mock, spyOn } from "bun:test";
				import childProcess from "node:child_process";
				const calls = [], commands = [], prompts = [];
				const record = (name, result = true) => async () => { calls.push(name); return result; };
				const utilsPath = ${JSON.stringify(path.join(root, "src/common/utils.js"))};
				const utils = await import(utilsPath);
				mock.module(utilsPath, () => ({ ...utils,
					runCommand: async (command) => { commands.push(command); return true; },
					commandExists: async () => false, promptUser: async (message) => { prompts.push(message); return /Claude stay-awake|Claude Remote Control/.test(message); }, safeCopyFile() {},
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
					configure_claude_stay_awake: ["configureClaudeStayAwake", "stay-awake", true],
					configure_claude_remote_control: ["configureClaudeRemoteControl", "remote-control", true],
					configure_hermes_relay: ["configureHermesRelay", "hermes", true],
					configure_t3_code_server: ["configureT3CodeServer", "t3", true],
					configure_tailnet_firewall: ["setupFirewall", "firewall", { ok: true }],
				};
				for (const [file, [name, label, result]] of Object.entries(helpers)) mock.module(${JSON.stringify(path.join(root, "src/helpers"))} + "/" + file + ".js", () => ({ [name]: record(label, result) }));
				const { configureUserApps, runCachyOSSetup } = await import(${JSON.stringify(path.join(root, "src/os_scripts/cachyos.js"))});
				const { runDebianServerSetup } = await import(${JSON.stringify(path.join(root, "src/os_scripts/debian_server.js"))});
				const noop = async () => true;
				const testUtils = await import(utilsPath);
				for (let pass = 0; pass < 2; pass++) {
					const ok = ${JSON.stringify(target)} === "arch" ? await runCachyOSSetup({
						readDeviceTypeImpl: () => "pc",
						promptDeviceTypeImpl: noop, startSudoSessionImpl: async () => () => {},
						commandExistsImpl: async () => false, prepareArchPackageManagerImpl: noop,
						ensureRustToolchainImpl: noop, ensureAurHelperImpl: async () => "paru", installDevToolsImpl: noop,
						installSystemPackagesImpl: noop, installFlatpakAppsImpl: noop,
						configureFleetSshImpl: async () => true,
						configureTailscaleT3Impl: record("t3"),
						configureBraveManagedPoliciesImpl: noop, configureHyprmoncfgImpl: noop,
						configureOmarchyWorkspacesImpl: noop, configureOmarchyPluginsImpl: noop,
						configureVoxtypeOsdImpl: noop, configureKdeConnectCommandsImpl: noop,
						configureOmarchyBarImpl: noop, configureOmazedImpl: noop, configureOmarchyAppearanceImpl: noop,
						configureUserAppsImpl: (options) => configureUserApps({ ...options,
							commandExistsImpl: async () => false,
							promptUserImpl: testUtils.promptUser, configureGitImpl: noop,
							configureBrowserIntegrationImpl: noop, configureAudioImpl: noop, configureBashImpl: noop,
							runCommandImpl: testUtils.runCommand,
							configureClaudeImpl: record("claude", { ok: true }), configureCodexImpl: record("codex", { ok: true }),
							installGhStackImpl: record("gh-stack"), configurePrWatchImpl: record("pr-watch"),
							syncAgentsConfigImpl: record("agents"), configureAxstackImpl: record("axstack", { ok: true }),
							configureAgentAccountsImpl: noop,
							configureFastfetchImpl: noop, configureGhosttyImpl: noop, enableServicesImpl: noop,
						}),
					}) : await runDebianServerSetup();
					if (!ok) throw new Error("setup incomplete");
					preserved.push(snapshot(process.env.HOME).filter(([name]) => protectedRoots.some((directory) => name === directory || name.startsWith(directory + "/"))));
				}
				console.log("RESULT=" + JSON.stringify({ calls, commands, prompts, preserved }));
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
				const expected = before.filter(([name]) =>
					protectedRoots.some(
						(directory) =>
							name === directory || name.startsWith(`${directory}/`),
					),
				);
				expect(recorded.preserved).toEqual([expected, expected]);
				expect(
					recorded.calls.filter((call) =>
						/pr-watch|stay-awake|remote-control/.test(call),
					),
				).toEqual([]);
				expect(
					recorded.prompts.filter((message) =>
						/Claude stay-awake|Claude Remote Control|PR watch/.test(message),
					),
				).toEqual([]);
				expect(
					recorded.commands.filter((command) =>
						/skills@|mattpocock|pr-watch|claude-stay-awake|claude-remote-control/.test(
							command,
						),
					),
				).toEqual([]);
			});
		}
	}
});
