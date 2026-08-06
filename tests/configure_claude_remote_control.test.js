import { afterEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { log } from "../src/common/utils.js";
import * as remote from "../src/helpers/configure_claude_remote_control.js";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const temporaryDirectories = [];

function temporaryDirectory(prefix) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function createSessionRoots(home) {
	fs.mkdirSync(path.join(home, "dev"), { recursive: true });
	fs.mkdirSync(path.join(home, "Work"), { recursive: true });
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

it("pre-seeds all session roots while preserving absent projects byte-for-byte", () => {
	const home = temporaryDirectory("haoshoku-remote-trust-");
	createSessionRoots(home);
	const keep = path.join(home, "existing-project");
	const stale = path.join(home, "missing-project");
	fs.mkdirSync(keep);
	const configPath = path.join(home, ".claude.json");
	const original = `{
	"untouched": { "spacing" : [1, 2, 3] },
	"projects": {
		${JSON.stringify(keep)}: { "note" : "leave bytes", "hasTrustDialogAccepted": false },
		${JSON.stringify(stale)}: {"allowedTools":["Bash(git:*)"],"mcpServers":{"repo":{}},"enabledMcpjsonServers":["repo"]},
		${JSON.stringify(home)}: { "hasTrustDialogAccepted" : false, "home" : 1 },
		${JSON.stringify(path.join(home, "Work"))}: {"note" : "same"}
	},
	"bypassPermissionsModeAccepted": false,
	"tail" : "unchanged"
}
`;
	fs.writeFileSync(configPath, original);

	const first = remote.updateClaudeProjectTrust({ home });
	const afterFirst = fs.readFileSync(configPath, "utf8");
	const second = remote.updateClaudeProjectTrust({ home });
	const afterSecond = fs.readFileSync(configPath, "utf8");
	const expected = `{
	"untouched": { "spacing" : [1, 2, 3] },
	"projects": {
		${JSON.stringify(keep)}: { "note" : "leave bytes", "hasTrustDialogAccepted": false },
		${JSON.stringify(stale)}: {"allowedTools":["Bash(git:*)"],"mcpServers":{"repo":{}},"enabledMcpjsonServers":["repo"]},
		${JSON.stringify(home)}: { "hasTrustDialogAccepted" : true, "home" : 1 },
		${JSON.stringify(path.join(home, "Work"))}: {"note" : "same","hasTrustDialogAccepted":true},
		${JSON.stringify(path.join(home, "dev"))}:{"hasTrustDialogAccepted":true}
	},
	"bypassPermissionsModeAccepted": true,
	"tail" : "unchanged"
}
`;

	expect({ first, afterFirst, second, afterSecond }).toEqual({
		first: true,
		afterFirst: expected,
		second: true,
		afterSecond: expected,
	});
});

it("creates missing state, inserts a missing projects key, and leaves malformed JSON untouched", () => {
	const missingHome = temporaryDirectory("haoshoku-remote-missing-");
	const noProjectsHome = temporaryDirectory("haoshoku-remote-no-projects-");
	const malformedHome = temporaryDirectory("haoshoku-remote-malformed-");
	for (const home of [missingHome, noProjectsHome, malformedHome]) {
		createSessionRoots(home);
	}
	const noProjectsPath = path.join(noProjectsHome, ".claude.json");
	const malformedPath = path.join(malformedHome, ".claude.json");
	fs.writeFileSync(noProjectsPath, '{\n  "other" : [1, 2]\n}\n');
	fs.writeFileSync(malformedPath, '{ "projects": nope }\n');

	const missingResult = remote.updateClaudeProjectTrust({ home: missingHome });
	const noProjectsResult = remote.updateClaudeProjectTrust({
		home: noProjectsHome,
	});
	const malformedResult = remote.updateClaudeProjectTrust({
		home: malformedHome,
	});

	expect({
		missingResult,
		missingMode:
			fs.statSync(path.join(missingHome, ".claude.json")).mode & 0o777,
		missingContent: fs.existsSync(path.join(missingHome, ".claude.json"))
			? fs.readFileSync(path.join(missingHome, ".claude.json"), "utf8")
			: undefined,
		noProjectsResult,
		noProjectsContent: fs.readFileSync(noProjectsPath, "utf8"),
		malformedResult,
		malformedContent: fs.readFileSync(malformedPath, "utf8"),
	}).toEqual({
		missingResult: true,
		missingMode: 0o600,
		missingContent: `${JSON.stringify(
			{
				bypassPermissionsModeAccepted: true,
				projects: Object.fromEntries(
					[
						missingHome,
						path.join(missingHome, "dev"),
						path.join(missingHome, "Work"),
					].map((root) => [root, { hasTrustDialogAccepted: true }]),
				),
			},
			null,
			2,
		)}\n`,
		noProjectsResult: true,
		noProjectsContent: `{\n  "other" : [1, 2],\n  "projects":{${[
			noProjectsHome,
			path.join(noProjectsHome, "dev"),
			path.join(noProjectsHome, "Work"),
		]
			.map((root) => `${JSON.stringify(root)}:{"hasTrustDialogAccepted":true}`)
			.join(",")}},\n  "bypassPermissionsModeAccepted":true\n}\n`,
		malformedResult: false,
		malformedContent: '{ "projects": nope }\n',
	});
});

it("atomically replaces state through unique sibling temps while preserving its mode", () => {
	const home = temporaryDirectory("haoshoku-remote-atomic-");
	createSessionRoots(home);
	const configPath = path.join(home, ".claude.json");
	const original = '{"projects":{},"bypassPermissionsModeAccepted":false}\n';
	fs.writeFileSync(configPath, original);
	fs.chmodSync(configPath, 0o640);
	const writes = [];
	const chmods = [];
	const renames = [];
	const fsImpl = {
		...fs,
		writeFileSync(target, ...args) {
			writes.push(target);
			return fs.writeFileSync(target, ...args);
		},
		chmodSync(target, mode) {
			chmods.push([target, mode]);
			return fs.chmodSync(target, mode);
		},
		renameSync(from, to) {
			renames.push([from, to]);
			return fs.renameSync(from, to);
		},
	};

	const first = remote.updateClaudeProjectTrust({ home, fsImpl });
	fs.writeFileSync(configPath, original);
	fs.chmodSync(configPath, 0o640);
	const second = remote.updateClaudeProjectTrust({ home, fsImpl });

	expect({
		first,
		second,
		mode: fs.statSync(configPath).mode & 0o777,
		trusted: JSON.parse(fs.readFileSync(configPath, "utf8"))
			.bypassPermissionsModeAccepted,
		writeTargetsAreUniqueSiblings:
			writes.length === 2 &&
			new Set(writes).size === 2 &&
			writes.every(
				(target) =>
					path.dirname(target) === home &&
					target !== configPath &&
					!fs.existsSync(target),
			),
		chmods,
		renames,
	}).toEqual({
		first: true,
		second: true,
		mode: 0o640,
		trusted: true,
		writeTargetsAreUniqueSiblings: true,
		chmods: writes.map((target) => [target, 0o640]),
		renames: writes.map((target) => [target, configPath]),
	});
});

it("atomically creates new state with private permissions", () => {
	const home = temporaryDirectory("haoshoku-remote-atomic-new-");
	createSessionRoots(home);
	const configPath = path.join(home, ".claude.json");
	const operations = [];
	const fsImpl = {
		...fs,
		writeFileSync(target, ...args) {
			operations.push(["write", target]);
			return fs.writeFileSync(target, ...args);
		},
		chmodSync(target, mode) {
			operations.push(["chmod", target, mode]);
			return fs.chmodSync(target, mode);
		},
		renameSync(from, to) {
			operations.push(["rename", from, to]);
			return fs.renameSync(from, to);
		},
	};

	const result = remote.updateClaudeProjectTrust({ home, fsImpl });
	const temp = operations[0][1];

	expect({
		result,
		mode: fs.statSync(configPath).mode & 0o777,
		operations,
		tempIsGone: !fs.existsSync(temp),
	}).toEqual({
		result: true,
		mode: 0o600,
		operations: [
			["write", temp],
			["chmod", temp, 0o600],
			["rename", temp, configPath],
		],
		tempIsGone: true,
	});
});

it("removes the temp and preserves original state when atomic rename fails", () => {
	const home = temporaryDirectory("haoshoku-remote-atomic-failure-");
	createSessionRoots(home);
	const configPath = path.join(home, ".claude.json");
	const original = '{"projects":{},"bypassPermissionsModeAccepted":false}\n';
	fs.writeFileSync(configPath, original);
	let temp;
	const fsImpl = {
		...fs,
		writeFileSync(target, ...args) {
			temp = target;
			return fs.writeFileSync(target, ...args);
		},
		renameSync() {
			throw new Error("injected rename failure");
		},
	};
	let error;
	try {
		remote.updateClaudeProjectTrust({ home, fsImpl });
	} catch (caught) {
		error = caught.message;
	}

	expect({
		error,
		original: fs.readFileSync(configPath, "utf8"),
		tempIsGone: temp !== configPath && !fs.existsSync(temp),
	}).toEqual({
		error: "injected rename failure",
		original,
		tempIsGone: true,
	});
});

it("retries a trust update when Claude changes its state before the rename", () => {
	const home = temporaryDirectory("haoshoku-remote-concurrent-retry-");
	createSessionRoots(home);
	const configPath = path.join(home, ".claude.json");
	fs.writeFileSync(
		configPath,
		'{"projects":{},"bypassPermissionsModeAccepted":false}\n',
	);
	const concurrent = {
		projects: { "/concurrent-write": { note: "preserve me" } },
		bypassPermissionsModeAccepted: false,
		externalState: "written by Claude",
	};
	let targetStats = 0;
	let tempWrites = 0;
	const fsImpl = {
		...fs,
		statSync(target, ...args) {
			if (target === configPath) {
				targetStats += 1;
				if (targetStats === 2) {
					fs.writeFileSync(configPath, `${JSON.stringify(concurrent)}\n`);
				}
			}
			return fs.statSync(target, ...args);
		},
		writeFileSync(target, ...args) {
			if (target !== configPath) tempWrites += 1;
			return fs.writeFileSync(target, ...args);
		},
	};
	const warnings = [];
	const originalWarning = log.warning;
	log.warning = (message) => warnings.push(message);
	let result;
	try {
		result = remote.updateClaudeProjectTrust({ home, fsImpl });
	} finally {
		log.warning = originalWarning;
	}
	const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));

	expect({
		result,
		targetStats,
		tempWrites,
		externalState: updated.externalState,
		concurrentProject: updated.projects["/concurrent-write"],
		trustedRoots: [home, path.join(home, "dev"), path.join(home, "Work")].map(
			(root) => updated.projects[root]?.hasTrustDialogAccepted,
		),
		bypassAccepted: updated.bypassPermissionsModeAccepted,
		warnings,
	}).toEqual({
		result: true,
		targetStats: 4,
		tempWrites: 2,
		externalState: "written by Claude",
		concurrentProject: { note: "preserve me" },
		trustedRoots: [true, true, true],
		bypassAccepted: true,
		warnings: [
			`Claude state changed while updating ${configPath}; retrying (1/3).`,
		],
	});
});

it("aborts after three concurrent trust-update conflicts without clobbering Claude", () => {
	const home = temporaryDirectory("haoshoku-remote-concurrent-abort-");
	createSessionRoots(home);
	const configPath = path.join(home, ".claude.json");
	fs.writeFileSync(
		configPath,
		'{"projects":{},"bypassPermissionsModeAccepted":false}\n',
	);
	let targetStats = 0;
	let tempWrites = 0;
	const fsImpl = {
		...fs,
		statSync(target, ...args) {
			if (target === configPath) {
				targetStats += 1;
				if (targetStats % 2 === 0) {
					const externalWrite = "x".repeat(targetStats / 2);
					fs.writeFileSync(
						configPath,
						`${JSON.stringify({ projects: {}, externalWrite })}\n`,
					);
				}
			}
			return fs.statSync(target, ...args);
		},
		writeFileSync(target, ...args) {
			if (target !== configPath) tempWrites += 1;
			return fs.writeFileSync(target, ...args);
		},
	};
	const warnings = [];
	const originalWarning = log.warning;
	log.warning = (message) => warnings.push(message);
	let result;
	try {
		result = remote.updateClaudeProjectTrust({ home, fsImpl });
	} finally {
		log.warning = originalWarning;
	}
	const preserved = JSON.parse(fs.readFileSync(configPath, "utf8"));

	expect({
		result,
		targetStats,
		tempWrites,
		preserved,
		temporaryFiles: fs
			.readdirSync(home)
			.filter((entry) => entry.startsWith("..claude.json.tmp-")),
		warnings,
	}).toEqual({
		result: false,
		targetStats: 6,
		tempWrites: 3,
		preserved: { projects: {}, externalWrite: "xxx" },
		temporaryFiles: [],
		warnings: [
			`Claude state changed while updating ${configPath}; retrying (1/3).`,
			`Claude state changed while updating ${configPath}; retrying (2/3).`,
			`Claude state kept changing while updating ${configPath}; leaving it untouched after 3 attempts.`,
		],
	});
});

it("refuses a null projects map without deploying or running commands", async () => {
	const home = temporaryDirectory("haoshoku-remote-null-projects-");
	createSessionRoots(home);
	const configPath = path.join(home, ".claude.json");
	fs.writeFileSync(configPath, '{"projects":null}\n');
	const calls = [];

	const result = await remote.syncClaudeRemoteControl({
		home,
		projectRoot: PROJECT_ROOT,
		runner: (args) => {
			calls.push(args);
			return { exitCode: 0 };
		},
	});

	expect({
		result,
		calls,
		content: fs.readFileSync(configPath, "utf8"),
		deployed: fs.existsSync(
			path.join(home, ".local", "bin", "haoshoku-claude-remote-control"),
		),
	}).toEqual({
		result: false,
		calls: [],
		content: '{"projects":null}\n',
		deployed: false,
	});
});

it("deploys the executable supervisor and template, then enables all three instances", async () => {
	const home = temporaryDirectory("haoshoku-remote-sync-");
	createSessionRoots(home);
	const calls = [];
	const runner = (args) => {
		calls.push(args);
		return { exitCode: 0 };
	};

	const result = await remote.syncClaudeRemoteControl({
		home,
		projectRoot: PROJECT_ROOT,
		runner,
		user: "alice",
	});
	const liveScript = path.join(
		home,
		".local",
		"bin",
		"haoshoku-claude-remote-control",
	);
	const liveUnit = path.join(
		home,
		".config",
		"systemd",
		"user",
		"claude-remote-control@.service",
	);
	const unitContract = fs
		.readFileSync(liveUnit, "utf8")
		.split("\n")
		.filter((line) =>
			/^(After|Wants|Type|EnvironmentFile|ExecStart|ExecStop|Restart|RestartSec|StartLimitIntervalSec|StartLimitBurst|WantedBy)=/.test(
				line,
			),
		);
	const hasPinnedPath = fs
		.readFileSync(liveUnit, "utf8")
		.split("\n")
		.some((line) => line.startsWith("Environment=PATH="));

	expect({
		result,
		scriptMatches:
			fs.existsSync(liveScript) &&
			fs.readFileSync(liveScript, "utf8") ===
				fs.readFileSync(
					path.join(
						PROJECT_ROOT,
						"configs",
						"claude-remote-control",
						"haoshoku-claude-remote-control",
					),
					"utf8",
				),
		scriptMode: fs.existsSync(liveScript)
			? fs.statSync(liveScript).mode & 0o777
			: undefined,
		unitMatches:
			fs.existsSync(liveUnit) &&
			fs.readFileSync(liveUnit, "utf8") ===
				fs.readFileSync(
					path.join(
						PROJECT_ROOT,
						"configs",
						"claude-remote-control",
						"claude-remote-control@.service",
					),
					"utf8",
				),
		unitContract,
		hasPinnedPath,
		calls,
	}).toEqual({
		result: true,
		scriptMatches: true,
		scriptMode: 0o755,
		unitMatches: true,
		unitContract: [
			"StartLimitIntervalSec=0",
			"Type=simple",
			"EnvironmentFile=-%h/.config/haoshoku/claude-remote-control/%i.env",
			"ExecStart=%h/.local/bin/haoshoku-claude-remote-control %i",
			"ExecStop=-%h/.local/bin/haoshoku-claude-remote-control stop %i",
			"Restart=always",
			"RestartSec=5",
			"WantedBy=default.target",
		],
		hasPinnedPath: false,
		calls: [
			["sh", "-c", "command -v tmux >/dev/null 2>&1"],
			["systemctl", "--user", "--version"],
			["systemctl", "--user", "daemon-reload"],
			[
				"systemctl",
				"--user",
				"enable",
				"--now",
				"claude-remote-control@haki.service",
				"claude-remote-control@dev.service",
				"claude-remote-control@work.service",
			],
			["loginctl", "enable-linger", "alice"],
		],
	});
});

it("derives trust, runtime roots, and enabled units from one frozen instance map", async () => {
	const home = temporaryDirectory("haoshoku-remote-instance-map-");
	createSessionRoots(home);
	const calls = [];
	const result = await remote.syncClaudeRemoteControl({
		home,
		projectRoot: PROJECT_ROOT,
		user: "alice",
		runner: (args) => {
			calls.push(args);
			return { exitCode: 0 };
		},
	});
	const definitions = remote.CLAUDE_REMOTE_CONTROL_INSTANCES ?? [];
	const environmentDirectory = path.join(
		home,
		".config",
		"haoshoku",
		"claude-remote-control",
	);
	const environmentFiles = fs.existsSync(environmentDirectory)
		? fs.readdirSync(environmentDirectory).sort()
		: [];
	const environmentRoots = environmentFiles.map((filename) =>
		JSON.parse(
			fs
				.readFileSync(path.join(environmentDirectory, filename), "utf8")
				.trim()
				.split("=")[1],
		),
	);
	const enableCall = calls.find((args) => args.includes("enable"));

	expect({
		result,
		frozen:
			Object.isFrozen(definitions) &&
			definitions.every((definition) => Object.isFrozen(definition)),
		definitions: definitions.map(({ instance, relativeRoot }) => ({
			instance,
			relativeRoot,
		})),
		trustedRoots: Object.keys(
			JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
				.projects,
		),
		environmentFiles,
		environmentRoots,
		enabledUnits: enableCall?.slice(4),
	}).toEqual({
		result: true,
		frozen: true,
		definitions: [
			{ instance: "haki", relativeRoot: "." },
			{ instance: "dev", relativeRoot: "dev" },
			{ instance: "work", relativeRoot: "Work" },
		],
		trustedRoots: [home, path.join(home, "dev"), path.join(home, "Work")],
		environmentFiles: ["dev.env", "haki.env", "work.env"],
		environmentRoots: [path.join(home, "dev"), home, path.join(home, "Work")],
		enabledUnits: [
			"claude-remote-control@haki.service",
			"claude-remote-control@dev.service",
			"claude-remote-control@work.service",
		],
	});
});

it("disables stale units for every missing root before enabling valid instances", async () => {
	const home = temporaryDirectory("haoshoku-remote-roots-");
	const calls = [];
	const warnings = [];
	const originalWarning = log.warning;
	log.warning = (message) => warnings.push(message);
	let result;
	try {
		result = await remote.syncClaudeRemoteControl({
			home,
			projectRoot: PROJECT_ROOT,
			user: "alice",
			runner: (args) => {
				calls.push(args);
				return { exitCode: 0 };
			},
		});
	} finally {
		log.warning = originalWarning;
	}

	expect({
		result,
		calls,
		warnings,
		trustedRoots: Object.keys(
			JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
				.projects,
		),
	}).toEqual({
		result: true,
		calls: [
			["sh", "-c", "command -v tmux >/dev/null 2>&1"],
			["systemctl", "--user", "--version"],
			["systemctl", "--user", "daemon-reload"],
			[
				"systemctl",
				"--user",
				"disable",
				"--now",
				"claude-remote-control@dev.service",
				"claude-remote-control@work.service",
			],
			[
				"systemctl",
				"--user",
				"enable",
				"--now",
				"claude-remote-control@haki.service",
			],
			["loginctl", "enable-linger", "alice"],
		],
		warnings: [
			`Skipping Claude Remote Control instance dev: root does not exist: ${path.join(home, "dev")}`,
			`Skipping Claude Remote Control instance work: root does not exist: ${path.join(home, "Work")}`,
		],
		trustedRoots: [home],
	});
});

it("retires stale managed instances idempotently without touching unmanaged template units", async () => {
	const home = temporaryDirectory("haoshoku-remote-retired-");
	createSessionRoots(home);
	const environmentDirectory = path.join(
		home,
		".config",
		"haoshoku",
		"claude-remote-control",
	);
	fs.mkdirSync(environmentDirectory, { recursive: true });
	const retiredEnvironment = path.join(environmentDirectory, "io.env");
	fs.writeFileSync(retiredEnvironment, `CLAUDE_REMOTE_CONTROL_ROOT=${JSON.stringify(home)}\n`);
	const wantsDirectory = path.join(
		home,
		".config",
		"systemd",
		"user",
		"default.target.wants",
	);
	fs.mkdirSync(wantsDirectory, { recursive: true });
	const unmanagedUnit = path.join(
		wantsDirectory,
		"claude-remote-control@unmanaged.service",
	);
	fs.symlinkSync("../claude-remote-control@.service", unmanagedUnit);
	const calls = [];
	const runner = (args) => {
		calls.push(args);
		return { exitCode: 0 };
	};

	const first = await remote.syncClaudeRemoteControl({
		environment: {},
		home,
		projectRoot: PROJECT_ROOT,
		runner,
		user: "alice",
	});
	const second = await remote.syncClaudeRemoteControl({
		environment: {},
		home,
		projectRoot: PROJECT_ROOT,
		runner,
		user: "alice",
	});

	expect({
		results: [first, second],
		disableCalls: calls.filter((args) => args[2] === "disable"),
		retiredEnvironmentExists: fs.existsSync(retiredEnvironment),
		unmanagedUnitStillExists: fs.lstatSync(unmanagedUnit).isSymbolicLink(),
		unmanagedUnitTouched: calls.some((args) =>
			args.includes("claude-remote-control@unmanaged.service"),
		),
	}).toEqual({
		results: [true, true],
		disableCalls: [
			[
				"systemctl",
				"--user",
				"disable",
				"--now",
				"claude-remote-control@io.service",
			],
		],
		retiredEnvironmentExists: false,
		unmanagedUnitStillExists: true,
		unmanagedUnitTouched: false,
	});
});

it("refuses to retire the tmux instance running the installer", async () => {
	const home = temporaryDirectory("haoshoku-remote-current-session-");
	createSessionRoots(home);
	const environmentDirectory = path.join(
		home,
		".config",
		"haoshoku",
		"claude-remote-control",
	);
	fs.mkdirSync(environmentDirectory, { recursive: true });
	const retiredEnvironment = path.join(environmentDirectory, "io.env");
	fs.writeFileSync(retiredEnvironment, `CLAUDE_REMOTE_CONTROL_ROOT=${JSON.stringify(home)}\n`);
	const calls = [];
	const warnings = [];
	const originalWarning = log.warning;
	log.warning = (message) => warnings.push(message);
	let result;
	try {
		result = await remote.syncClaudeRemoteControl({
			home,
			projectRoot: PROJECT_ROOT,
			environment: {
				...process.env,
				TMUX: "/tmp/tmux-1000/claude-io,123,0",
			},
			runner: (args) => {
				calls.push(args);
				return { exitCode: 0 };
			},
		});
	} finally {
		log.warning = originalWarning;
	}

	expect({
		result,
		calls,
		warning: warnings.at(-1),
		retiredEnvironmentExists: fs.existsSync(retiredEnvironment),
		artifactsDeployed: fs.existsSync(
			path.join(home, ".local", "bin", "haoshoku-claude-remote-control"),
		),
	}).toEqual({
		result: false,
		calls: [],
		warning:
			"Refusing to retire Claude Remote Control instance io while this installer is running inside its tmux session. Detach and run Haoshoku from another terminal.",
		retiredEnvironmentExists: true,
		artifactsDeployed: false,
	});
});

it("refuses to reload or enable services when tmux is unavailable", async () => {
	const home = temporaryDirectory("haoshoku-remote-no-tmux-");
	createSessionRoots(home);
	const calls = [];
	const warnings = [];
	const originalWarning = log.warning;
	log.warning = (message) => warnings.push(message);
	let result;
	try {
		result = await remote.syncClaudeRemoteControl({
			home,
			projectRoot: PROJECT_ROOT,
			runner: (args) => {
				calls.push(args);
				return { exitCode: args[0] === "sh" ? 1 : 0 };
			},
		});
	} finally {
		log.warning = originalWarning;
	}

	expect({
		result,
		calls,
		warning: warnings.at(-1),
		statePersisted: fs.existsSync(path.join(home, ".claude.json")),
		artifactsPersisted:
			fs.existsSync(
				path.join(home, ".local", "bin", "haoshoku-claude-remote-control"),
			) ||
			fs.existsSync(
				path.join(
					home,
					".config",
					"systemd",
					"user",
					"claude-remote-control@.service",
				),
			),
	}).toEqual({
		result: false,
		calls: [["sh", "-c", "command -v tmux >/dev/null 2>&1"]],
		warning:
			"tmux is required for Claude Remote Control; install tmux and retry.",
		statePersisted: false,
		artifactsPersisted: false,
	});
});

it("warns and returns failure when the tmux probe cannot be executed", async () => {
	const home = temporaryDirectory("haoshoku-remote-tmux-throw-");
	createSessionRoots(home);
	const calls = [];
	const warnings = [];
	const originalWarning = log.warning;
	log.warning = (message) => warnings.push(message);
	let result;
	let error;
	try {
		result = await remote.syncClaudeRemoteControl({
			home,
			projectRoot: PROJECT_ROOT,
			runner: (args) => {
				calls.push(args);
				throw new Error("tmux executable not found");
			},
		});
	} catch (caught) {
		error = caught.message;
	} finally {
		log.warning = originalWarning;
	}

	expect({ result, error, calls, warning: warnings.at(-1) }).toEqual({
		result: false,
		error: undefined,
		calls: [["sh", "-c", "command -v tmux >/dev/null 2>&1"]],
		warning:
			"tmux is required for Claude Remote Control; install tmux and retry.",
	});
});

it("persists nothing when the systemctl dependency probe fails", async () => {
	const home = temporaryDirectory("haoshoku-remote-no-systemctl-");
	createSessionRoots(home);
	const calls = [];
	const warnings = [];
	const originalWarning = log.warning;
	log.warning = (message) => warnings.push(message);
	let result;
	try {
		result = await remote.syncClaudeRemoteControl({
			home,
			projectRoot: PROJECT_ROOT,
			runner: (args) => {
				calls.push(args);
				return {
					exitCode:
						args[0] === "systemctl" && args.at(-1) === "--version" ? 1 : 0,
				};
			},
		});
	} finally {
		log.warning = originalWarning;
	}

	expect({
		result,
		calls,
		warning: warnings.at(-1),
		statePersisted: fs.existsSync(path.join(home, ".claude.json")),
		artifactsPersisted:
			fs.existsSync(
				path.join(home, ".local", "bin", "haoshoku-claude-remote-control"),
			) ||
			fs.existsSync(
				path.join(
					home,
					".config",
					"systemd",
					"user",
					"claude-remote-control@.service",
				),
			),
	}).toEqual({
		result: false,
		calls: [
			["sh", "-c", "command -v tmux >/dev/null 2>&1"],
			["systemctl", "--user", "--version"],
		],
		warning:
			"systemctl --user is required for Claude Remote Control; ensure a systemd user manager is available and retry.",
		statePersisted: false,
		artifactsPersisted: false,
	});
});

it("declares tmux exactly once in the common package list", () => {
	const packages = fs
		.readFileSync(path.join(PROJECT_ROOT, "common", "paru_applist.txt"), "utf8")
		.split(/\s+/)
		.filter(Boolean);

	expect(packages.filter((entry) => entry === "tmux")).toEqual(["tmux"]);
});

it("keeps a successful enable non-fatal when linger cannot be enabled", async () => {
	const home = temporaryDirectory("haoshoku-remote-linger-");
	createSessionRoots(home);
	const calls = [];
	const warnings = [];
	const originalWarning = log.warning;
	log.warning = (message) => warnings.push(message);
	let result;
	try {
		result = await remote.syncClaudeRemoteControl({
			home,
			projectRoot: PROJECT_ROOT,
			user: "alice",
			runner: (args) => {
				calls.push(args);
				return { exitCode: args[0] === "loginctl" ? 1 : 0 };
			},
		});
	} finally {
		log.warning = originalWarning;
	}

	expect({
		result,
		lingerCall: calls.at(-1),
		manualHint: warnings.some((message) =>
			message.includes("loginctl enable-linger alice"),
		),
	}).toEqual({
		result: true,
		lingerCall: ["loginctl", "enable-linger", "alice"],
		manualHint: true,
	});
});

it("uses one socket for create, readiness, attach, and stop with the complete Claude command", async () => {
	const home = temporaryDirectory("haoshoku-remote-supervisor-");
	createSessionRoots(home);
	const bin = path.join(home, "bin");
	fs.mkdirSync(bin);
	const tmuxLog = path.join(home, "tmux.log");
	const tmuxState = path.join(home, "tmux.state");
	const createAction = ["new", "session"].join("-");
	fs.writeFileSync(
		path.join(bin, "tmux"),
		`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TMUX_LOG"
operation="$3"
case "$operation" in
  has-session) [[ -f "$TMUX_STATE" ]] ;;
  "$CREATE_ACTION") printf '%s\n' "$*" > "$TMUX_STATE" ;;
  attach-session) [[ -f "$TMUX_STATE" ]] ;;
  kill-session) rm -f "$TMUX_STATE" ;;
esac
`,
	);
	fs.chmodSync(path.join(bin, "tmux"), 0o755);
	const supervisor = path.join(
		PROJECT_ROOT,
		"configs",
		"claude-remote-control",
		"haoshoku-claude-remote-control",
	);
	const env = {
		...process.env,
		CLAUDE_REMOTE_CONTROL_ROOT: home,
		CREATE_ACTION: createAction,
		HOME: home,
		PATH: `${bin}:${process.env.PATH}`,
		TMUX_LOG: tmuxLog,
		TMUX_STATE: tmuxState,
	};
	const runMode = Bun.spawn([supervisor, "haki"], {
		env,
		stderr: "pipe",
		stdout: "pipe",
	});
	for (
		let attempt = 0;
		attempt < 50 && !fs.existsSync(tmuxState);
		attempt += 1
	) {
		await Bun.sleep(10);
	}
	const readiness = Bun.spawnSync([supervisor, "has-session", "haki"], { env });
	const attach = Bun.spawnSync([supervisor, "attach", "haki"], { env });
	const stop = Bun.spawnSync([supervisor, "stop", "haki"], { env });
	const exitCode = await runMode.exited;
	const calls = fs.readFileSync(tmuxLog, "utf8").trim().split("\n");

	expect({
		exitCode,
		readiness: readiness.exitCode,
		attach: attach.exitCode,
		stop: stop.exitCode,
		sockets: [...new Set(calls.map((line) => line.split(" ")[1]))],
		creation: calls.find((line) => line.split(" ")[2] === createAction),
		lifecycle: calls
			.map((line) => line.split(" ")[2])
			.filter((operation) => operation !== "has-session")
			.sort(),
	}).toEqual({
		exitCode: 0,
		readiness: 0,
		attach: 0,
		stop: 0,
		sockets: ["claude-haki"],
		creation: `-L claude-haki ${createAction} -d -s haki -c ${home} claude --remote-control haki --dangerously-skip-permissions`,
		lifecycle: ["attach-session", "kill-session", createAction].sort(),
	});
});

it("refuses to adopt a pre-existing tmux session in run mode", () => {
	const home = temporaryDirectory("haoshoku-remote-foreign-");
	const bin = path.join(home, "bin");
	fs.mkdirSync(bin);
	const tmuxLog = path.join(home, "tmux.log");
	const created = path.join(home, "created");
	const createAction = ["new", "session"].join("-");
	fs.writeFileSync(
		path.join(bin, "tmux"),
		`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TMUX_LOG"
[[ "$3" == has-session ]] && exit 0
[[ "$3" == "$CREATE_ACTION" ]] && : > "$CREATED"
exit 1
`,
	);
	fs.chmodSync(path.join(bin, "tmux"), 0o755);
	const supervisor = path.join(
		PROJECT_ROOT,
		"configs",
		"claude-remote-control",
		"haoshoku-claude-remote-control",
	);
	const result = Bun.spawnSync([supervisor, "haki"], {
		env: {
			...process.env,
			CLAUDE_REMOTE_CONTROL_ROOT: home,
			CREATED: created,
			CREATE_ACTION: createAction,
			HOME: home,
			PATH: `${bin}:${process.env.PATH}`,
			TMUX_LOG: tmuxLog,
		},
		stderr: "pipe",
		stdout: "pipe",
	});

	expect({
		exitCode: result.exitCode,
		stderr: new TextDecoder().decode(result.stderr),
		calls: fs.readFileSync(tmuxLog, "utf8").trim().split("\n"),
		created: fs.existsSync(created),
	}).toEqual({
		exitCode: 1,
		stderr: "Refusing to adopt pre-existing tmux session: haki on claude-haki\n",
		calls: ["-L claude-haki has-session -t haki"],
		created: false,
	});
});

it("treats a session disappearing during stop as an idempotent success", () => {
	const home = temporaryDirectory("haoshoku-remote-stop-race-");
	const bin = path.join(home, "bin");
	fs.mkdirSync(bin);
	const tmuxLog = path.join(home, "tmux.log");
	const tmuxState = path.join(home, "tmux.state");
	fs.writeFileSync(tmuxState, "present\n");
	fs.writeFileSync(
		path.join(bin, "tmux"),
		`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TMUX_LOG"
case "$3" in
  has-session) [[ -f "$TMUX_STATE" ]] ;;
  kill-session) rm -f "$TMUX_STATE"; exit 1 ;;
esac
`,
	);
	fs.chmodSync(path.join(bin, "tmux"), 0o755);
	const supervisor = path.join(
		PROJECT_ROOT,
		"configs",
		"claude-remote-control",
		"haoshoku-claude-remote-control",
	);
	const result = Bun.spawnSync([supervisor, "stop", "haki"], {
		env: {
			...process.env,
			HOME: home,
			PATH: `${bin}:${process.env.PATH}`,
			TMUX_LOG: tmuxLog,
			TMUX_STATE: tmuxState,
		},
		stderr: "pipe",
		stdout: "pipe",
	});

	expect({
		exitCode: result.exitCode,
		calls: fs.readFileSync(tmuxLog, "utf8").trim().split("\n"),
		stopped: !fs.existsSync(tmuxState),
	}).toEqual({
		exitCode: 0,
		calls: [
			"-L claude-haki has-session -t haki",
			"-L claude-haki kill-session -t haki",
			"-L claude-haki has-session -t haki",
		],
		stopped: true,
	});
});

it("backs up the live supervisor and unit into the repository tree", async () => {
	const home = temporaryDirectory("haoshoku-remote-backup-home-");
	const projectRoot = temporaryDirectory("haoshoku-remote-backup-project-");
	const liveScriptDir = path.join(home, ".local", "bin");
	const liveUnitDir = path.join(home, ".config", "systemd", "user");
	const repoDir = path.join(projectRoot, "configs", "claude-remote-control");
	fs.mkdirSync(liveScriptDir, { recursive: true });
	fs.mkdirSync(liveUnitDir, { recursive: true });
	fs.writeFileSync(
		path.join(liveScriptDir, "haoshoku-claude-remote-control"),
		"#!/usr/bin/env bash\necho live\n",
	);
	fs.writeFileSync(
		path.join(liveUnitDir, "claude-remote-control@.service"),
		"[Service]\nExecStart=/live\n",
	);

	if (typeof remote.backupClaudeRemoteControl === "function") {
		await remote.backupClaudeRemoteControl({ home, projectRoot });
	}

	expect({
		exportType: typeof remote.backupClaudeRemoteControl,
		script: fs.existsSync(path.join(repoDir, "haoshoku-claude-remote-control"))
			? fs.readFileSync(
					path.join(repoDir, "haoshoku-claude-remote-control"),
					"utf8",
				)
			: undefined,
		unit: fs.existsSync(path.join(repoDir, "claude-remote-control@.service"))
			? fs.readFileSync(
					path.join(repoDir, "claude-remote-control@.service"),
					"utf8",
				)
			: undefined,
	}).toEqual({
		exportType: "function",
		script: "#!/usr/bin/env bash\necho live\n",
		unit: "[Service]\nExecStart=/live\n",
	});
});

it("requires both live artifacts before replacing either repository backup", async () => {
	const results = [];
	for (const missing of ["script", "unit"]) {
		const home = temporaryDirectory(`haoshoku-remote-backup-${missing}-home-`);
		const projectRoot = temporaryDirectory(
			`haoshoku-remote-backup-${missing}-project-`,
		);
		const liveScript = path.join(
			home,
			".local",
			"bin",
			"haoshoku-claude-remote-control",
		);
		const liveUnit = path.join(
			home,
			".config",
			"systemd",
			"user",
			"claude-remote-control@.service",
		);
		const repoScript = path.join(
			projectRoot,
			"configs",
			"claude-remote-control",
			"haoshoku-claude-remote-control",
		);
		const repoUnit = path.join(
			projectRoot,
			"configs",
			"claude-remote-control",
			"claude-remote-control@.service",
		);
		for (const target of [liveScript, liveUnit, repoScript, repoUnit]) {
			fs.mkdirSync(path.dirname(target), { recursive: true });
		}
		if (missing !== "script") fs.writeFileSync(liveScript, "live-script\n");
		if (missing !== "unit") fs.writeFileSync(liveUnit, "live-unit\n");
		fs.writeFileSync(repoScript, "repo-script\n");
		fs.writeFileSync(repoUnit, "repo-unit\n");
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);
		let result;
		try {
			result = await remote.backupClaudeRemoteControl({ home, projectRoot });
		} finally {
			log.warning = originalWarning;
		}
		results.push({
			missing,
			result,
			warning: warnings.at(-1),
			script: fs.readFileSync(repoScript, "utf8"),
			unit: fs.readFileSync(repoUnit, "utf8"),
		});
	}

	expect(results).toEqual([
		{
			missing: "script",
			result: false,
			warning: expect.stringMatching(
				/backup requires both live artifacts; missing: .*haoshoku-claude-remote-control.*left unchanged/,
			),
			script: "repo-script\n",
			unit: "repo-unit\n",
		},
		{
			missing: "unit",
			result: false,
			warning: expect.stringMatching(
				/backup requires both live artifacts; missing: .*claude-remote-control@\.service.*left unchanged/,
			),
			script: "repo-script\n",
			unit: "repo-unit\n",
		},
	]);
});

it("dispatches both Claude Remote Control one-shot CLI modes", () => {
	const home = temporaryDirectory("haoshoku-remote-cli-home-");
	const projectRoot = temporaryDirectory("haoshoku-remote-cli-project-");
	createSessionRoots(home);
	fs.cpSync(path.join(PROJECT_ROOT, "src"), path.join(projectRoot, "src"), {
		recursive: true,
	});
	fs.cpSync(
		path.join(PROJECT_ROOT, "configs"),
		path.join(projectRoot, "configs"),
		{ recursive: true },
	);
	fs.copyFileSync(
		path.join(PROJECT_ROOT, "haoshoku.js"),
		path.join(projectRoot, "haoshoku.js"),
	);
	fs.symlinkSync(
		path.join(PROJECT_ROOT, "node_modules"),
		path.join(projectRoot, "node_modules"),
		"dir",
	);
	const bin = path.join(home, "bin");
	fs.mkdirSync(bin);
	for (const command of ["tmux", "systemctl", "loginctl"]) {
		const executable = path.join(bin, command);
		fs.writeFileSync(executable, "#!/usr/bin/env bash\nexit 0\n");
		fs.chmodSync(executable, 0o755);
	}
	const cli = path.join(projectRoot, "haoshoku.js");
	const env = {
		...process.env,
		HOME: home,
		PATH: `${bin}:${process.env.PATH}`,
	};
	const help = Bun.spawnSync([process.execPath, cli, "--help"], {
		env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const deploy = Bun.spawnSync(
		[process.execPath, cli, "--claude-remote-control"],
		{ env, stderr: "pipe", stdout: "pipe" },
	);
	const liveScript = path.join(
		home,
		".local",
		"bin",
		"haoshoku-claude-remote-control",
	);
	const backupMarker = "# backed-up-through-cli\n";
	if (fs.existsSync(liveScript)) fs.writeFileSync(liveScript, backupMarker);
	const backup = Bun.spawnSync(
		[process.execPath, cli, "--claude-remote-control-backup"],
		{ env, stderr: "pipe", stdout: "pipe" },
	);
	const helpText = new TextDecoder().decode(help.stdout);
	const repoScript = path.join(
		projectRoot,
		"configs",
		"claude-remote-control",
		"haoshoku-claude-remote-control",
	);

	expect({
		helpExit: help.exitCode,
		helpFlags: [
			helpText.includes("--claude-remote-control"),
			helpText.includes("--claude-remote-control-backup"),
		],
		deployExit: deploy.exitCode,
		deployed: fs.existsSync(liveScript),
		backupExit: backup.exitCode,
		backedUp: fs.existsSync(repoScript)
			? fs.readFileSync(repoScript, "utf8")
			: undefined,
	}).toEqual({
		helpExit: 0,
		helpFlags: [true, true],
		deployExit: 0,
		deployed: true,
		backupExit: 0,
		backedUp: backupMarker,
	});
});

it("exits nonzero when one-shot deploy or backup reports failure", () => {
	const home = temporaryDirectory("haoshoku-remote-cli-failure-home-");
	const projectRoot = temporaryDirectory(
		"haoshoku-remote-cli-failure-project-",
	);
	createSessionRoots(home);
	fs.cpSync(path.join(PROJECT_ROOT, "src"), path.join(projectRoot, "src"), {
		recursive: true,
	});
	fs.cpSync(
		path.join(PROJECT_ROOT, "configs"),
		path.join(projectRoot, "configs"),
		{ recursive: true },
	);
	fs.copyFileSync(
		path.join(PROJECT_ROOT, "haoshoku.js"),
		path.join(projectRoot, "haoshoku.js"),
	);
	fs.symlinkSync(
		path.join(PROJECT_ROOT, "node_modules"),
		path.join(projectRoot, "node_modules"),
		"dir",
	);
	const bin = path.join(home, "bin");
	fs.mkdirSync(bin);
	fs.symlinkSync("/bin/sh", path.join(bin, "sh"));
	for (const command of ["systemctl", "loginctl"]) {
		fs.writeFileSync(path.join(bin, command), "#!/usr/bin/env bash\nexit 0\n");
	}
	for (const command of ["systemctl", "loginctl"]) {
		fs.chmodSync(path.join(bin, command), 0o755);
	}
	const cli = path.join(projectRoot, "haoshoku.js");
	const env = {
		...process.env,
		HOME: home,
		PATH: bin,
	};
	const deploy = Bun.spawnSync(
		[process.execPath, cli, "--claude-remote-control"],
		{ env, stderr: "pipe", stdout: "pipe" },
	);
	fs.rmSync(
		path.join(home, ".local", "bin", "haoshoku-claude-remote-control"),
		{
			force: true,
		},
	);
	fs.rmSync(
		path.join(
			home,
			".config",
			"systemd",
			"user",
			"claude-remote-control@.service",
		),
		{ force: true },
	);
	const backup = Bun.spawnSync(
		[process.execPath, cli, "--claude-remote-control-backup"],
		{ env, stderr: "pipe", stdout: "pipe" },
	);

	expect({ deployExit: deploy.exitCode, backupExit: backup.exitCode }).toEqual({
		deployExit: 1,
		backupExit: 1,
	});
});
