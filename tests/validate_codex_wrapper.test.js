import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const HOOK = path.join(
	PROJECT_ROOT,
	"configs",
	"claude",
	"agents",
	"validate-codex-wrapper.sh",
);
const OPENCODE_LAUNCHER = "~/.claude/agents/run-opencode-seat.sh";
const OPENCODE_LAUNCHER_PATH = path.join(
	PROJECT_ROOT,
	"configs",
	"claude",
	"agents",
	"run-opencode-seat.sh",
);
const CURRENT_UID = String(process.getuid());
const CURRENT_USER_ENTRY = fs
	.readFileSync("/etc/passwd", "utf8")
	.split("\n")
	.find((entry) => entry.split(":")[2] === CURRENT_UID);
if (!CURRENT_USER_ENTRY)
	throw new Error(`current UID ${CURRENT_UID} is absent from /etc/passwd`);
const CURRENT_USER_HOME = CURRENT_USER_ENTRY.split(":")[5];
const IMPLEMENTATION_COMMAND = `${OPENCODE_LAUNCHER} --mode implementation --workspace /tmp/workspace --prompt-file /tmp/codex-wrapper/prompt.md --scope-file /tmp/codex-wrapper/scope.txt`;
const REVIEW_COMMAND = `${OPENCODE_LAUNCHER} --mode review --workspace /tmp/workspace --prompt-file /tmp/codex-wrapper/prompt.md`;

function runHook(identity, command) {
	const input = JSON.stringify({
		tool_name: "Bash",
		tool_input: { command },
	});
	return Bun.spawnSync(["bash", HOOK, identity], {
		cwd: PROJECT_ROOT,
		env: { ...process.env, HOME: CURRENT_USER_HOME },
		stdin: Buffer.from(input),
		stderr: "pipe",
		stdout: "pipe",
	});
}

function expectAllowed(identity, command) {
	const result = runHook(identity, command);
	const stdout = result.stdout.toString();
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	const output = JSON.parse(stdout);
	expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
	expect(output.hookSpecificOutput.updatedInput.command).toBe(
		`CODEX_WRAPPER_GATEWAY=${identity} ${command}`,
	);
	return output;
}

function expectBlocked(identity, command) {
	const result = runHook(identity, command);
	expect(result.exitCode, result.stdout.toString()).toBe(2);
}

describe("opencode wrapper Bash policy", () => {
	it("allows the fixed OpenCode launcher for implementation", () => {
		expectAllowed("opencode-wrapper", IMPLEMENTATION_COMMAND);
	});

	it("allows review without a scope manifest", () => {
		const output = expectAllowed("opencode-wrapper", REVIEW_COMMAND);
		expect(output.hookSpecificOutput.updatedInput.timeout).toBe(600000);
	});

	it("blocks a direct opencode invocation that bypasses the launcher", () => {
		expectBlocked(
			"opencode-wrapper",
			"opencode run --model opencode-go/glm-5.3 prompt",
		);
	});

	it("blocks the Codex launcher for the OpenCode identity", () => {
		expectBlocked(
			"opencode-wrapper",
			"~/.claude/agents/run-codex-task.sh --mode implementation --model sol --workspace /tmp/workspace --prompt-file /tmp/codex-wrapper/prompt.md",
		);
	});

	for (const identity of ["sol-wrapper", "luna-wrapper"]) {
		it(`does not grant the OpenCode launcher to ${identity}`, () => {
			expectBlocked(identity, IMPLEMENTATION_COMMAND);
		});
	}

	for (const flag of ["--model", "--variant", "--effort"]) {
		it(`blocks caller-selected ${flag}`, () => {
			expectBlocked(
				"opencode-wrapper",
				`${IMPLEMENTATION_COMMAND} ${flag} forbidden`,
			);
		});
	}

	it("requires a scope manifest for implementation", () => {
		expectBlocked(
			"opencode-wrapper",
			`${OPENCODE_LAUNCHER} --mode implementation --workspace /tmp/workspace --prompt-file /tmp/codex-wrapper/prompt.md`,
		);
	});

	it("forbids a scope manifest for review", () => {
		expectBlocked(
			"opencode-wrapper",
			`${REVIEW_COMMAND} --scope-file /tmp/codex-wrapper/scope.txt`,
		);
	});

	it("blocks unknown wrapper identities", () => {
		expectBlocked("nova-wrapper", IMPLEMENTATION_COMMAND);
	});
});

function makeLauncherFixture(
	version = "1.18.18",
	provider = "opencode-go",
	exportPrefix = "",
) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-seat-test-"));
	const workspace = path.join(root, "workspace");
	const fakeBin = path.join(root, "bin");
	const home = path.join(root, "home");
	const realOpencode = path.join(root, "real-opencode");
	fs.mkdirSync(workspace);
	fs.mkdirSync(fakeBin);
	fs.mkdirSync(path.join(home, ".local", "share", "opencode"), {
		recursive: true,
	});
	fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
	fs.copyFileSync("/bin/true", realOpencode);
	fs.chmodSync(realOpencode, 0o755);
	fs.writeFileSync(path.join(workspace, "prompt.md"), "Return the result JSON.\n");
	fs.writeFileSync(path.join(workspace, "scope.txt"), "hello.txt\n");
	const init = Bun.spawnSync(["git", "init", "--quiet"], { cwd: workspace });
	expect(init.exitCode).toBe(0);
	fs.writeFileSync(
		path.join(fakeBin, "opencode"),
		"#!/bin/bash\nexit 127\n",
		{ mode: 0o755 },
	);
	const receipt = `{"info":{"id":"ses_test","model":{"id":"glm-5.3","providerID":"${provider}","variant":"high"},"version":"1.18.18","summary":{"additions":0,"deletions":0,"files":0}}}`;
	return {
		exportStdout: `${exportPrefix}${receipt}\n`,
		fakeBin,
		home,
		realOpencode,
		root,
		version,
		workspace,
	};
}

function installSuccessfulBwrap(fixture) {
	fixture.bwrapArgsLog = path.join(fixture.root, "bwrap-args.log");
	fs.writeFileSync(
		path.join(fixture.fakeBin, "bwrap"),
		`#!/bin/bash
printf '%s\\n' --- "$@" >> "$BWRAP_ARGS_LOG"
for ((i = 1; i <= $#; i++)); do
  if [ "\${!i}" = --version ]; then
	    printf '%s\\n' "$FAKE_OPENCODE_VERSION"
	    exit "\${FAKE_VERSION_EXIT:-0}"
  fi
  if [ "\${!i}" = export ]; then
	    printf '%s' "$FAKE_EXPORT_STDOUT"
	    exit "\${FAKE_EXPORT_EXIT:-0}"
  fi
done
if [ -n "\${FAKE_MUTATION_PATH:-}" ]; then
  mkdir -p "$(dirname "$FAKE_WORKSPACE/$FAKE_MUTATION_PATH")"
  printf 'changed\\n' > "$FAKE_WORKSPACE/$FAKE_MUTATION_PATH"
fi
if [ -n "\${FAKE_BACKGROUND_PID_FILE:-}" ]; then
  (sleep 30) >/dev/null 2>&1 &
  printf '%s\\n' "$!" > "$FAKE_BACKGROUND_PID_FILE"
fi
has_dev=0
while [ "$#" -gt 0 ]; do
  if [ "$1" = --dev ] && [ "\${2:-}" = /dev ]; then has_dev=1; fi
  shift
done
[ "$has_dev" -eq 1 ] || exit 90
printf '%s\\n' '{"type":"text","sessionID":"ses_test","part":{"text":"{\\"status\\":\\"completed\\",\\"summary\\":\\"done\\",\\"changed_paths\\":[],\\"verification\\":[{\\"command\\":\\"true\\",\\"exit_code\\":0,\\"evidence\\":\\"ok\\"}]}"}}'
`,
		{ mode: 0o755 },
	);
}

function runLauncher(fixture, args, gateway, extraEnv = {}) {
		const env = {
			...process.env,
			PATH: `${fixture.fakeBin}:${process.env.PATH}`,
			BWRAP_ARGS_LOG: fixture.bwrapArgsLog ?? path.join(fixture.root, "bwrap-args.log"),
			FAKE_EXPORT_STDOUT: fixture.exportStdout,
			FAKE_OPENCODE_VERSION: fixture.version,
			HOME: fixture.home,
			OPENCODE_SEAT_BIN: fixture.realOpencode,
			...extraEnv,
		};
		if (env.OPENCODE_SEAT_BIN === null) delete env.OPENCODE_SEAT_BIN;
	if (gateway !== undefined) env.CODEX_WRAPPER_GATEWAY = gateway;
	else delete env.CODEX_WRAPPER_GATEWAY;
	return Bun.spawnSync(["bash", OPENCODE_LAUNCHER_PATH, ...args], {
		cwd: PROJECT_ROOT,
		env,
		stderr: "pipe",
		stdout: "pipe",
	});
}

function implementationArgs(workspace) {
	return [
		"--mode",
		"implementation",
		"--workspace",
		workspace,
		"--prompt-file",
		path.join(workspace, "prompt.md"),
		"--scope-file",
		path.join(workspace, "scope.txt"),
	];
}

describe("opencode seat launcher fail-closed gates", () => {
	it("fails closed when the shared run root is not private", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		const runRoot = path.join(os.tmpdir(), "opencode-seat");
		fs.mkdirSync(runRoot, { mode: 0o700, recursive: true });
		const originalMode = fs.statSync(runRoot).mode & 0o777;
		try {
			fs.chmodSync(runRoot, 0o777);
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(73);
			expect(result.stderr.toString()).toContain("owned mode-0700 run root");
		} finally {
			fs.chmodSync(runRoot, originalMode);
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("publishes a distinct missing-gateway refusal", () => {
		const fixture = makeLauncherFixture();
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				undefined,
			);
			expect(result.exitCode, result.stderr.toString()).toBe(6);
			expect(JSON.parse(result.stdout.toString()).launcher_status).toBe(
				"blocked_no_gateway_marker",
			);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("publishes a distinct invalid-gateway refusal", () => {
		const fixture = makeLauncherFixture();
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"sol-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(6);
			expect(JSON.parse(result.stdout.toString()).launcher_status).toBe(
				"blocked_invalid_gateway_marker",
			);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("records a drifted OpenCode version instead of gating on it", () => {
		const fixture = makeLauncherFixture("9.9.9");
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const report = JSON.parse(result.stdout.toString());
			expect(report.launcher_status).not.toBe(
				"blocked_opencode_version_mismatch",
			);
			expect(report.launcher_status).toBe("ok");
			expect(report.opencode_version).toBe("9.9.9");
			expect(result.stderr.toString()).not.toContain(
				"repin PINNED_OPENCODE_VERSION",
			);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("requires a scope file in implementation mode", () => {
		const fixture = makeLauncherFixture();
		try {
			const args = implementationArgs(fixture.workspace);
			args.splice(-2);
			const result = runLauncher(fixture, args, "opencode-wrapper");
			expect(result.exitCode).toBe(64);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("forbids a scope file in review mode", () => {
		const fixture = makeLauncherFixture();
		try {
			const args = implementationArgs(fixture.workspace);
			args[1] = "review";
			const result = runLauncher(fixture, args, "opencode-wrapper");
			expect(result.exitCode).toBe(64);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	for (const flag of ["--model", "--variant", "--effort"]) {
		it(`rejects the unsupported launcher flag ${flag}`, () => {
			const fixture = makeLauncherFixture();
			try {
				const result = runLauncher(
					fixture,
					[...implementationArgs(fixture.workspace), flag, "forbidden"],
					"opencode-wrapper",
				);
				expect(result.exitCode).toBe(64);
			} finally {
				fs.rmSync(fixture.root, { force: true, recursive: true });
			}
		});
	}

	it("provides the device filesystem required by the OpenCode runtime", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			expect(JSON.parse(result.stdout.toString()).launcher_status).toBe("ok");
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("keeps launcher control artifacts outside worker-writable mounts", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const report = JSON.parse(result.stdout.toString());
			const args = fs.readFileSync(fixture.bwrapArgsLog, "utf8").split("\n");
			const writableTargets = args.flatMap((arg, index) =>
				arg === "--bind" ? [args[index + 2]] : [],
			);
			expect(writableTargets).not.toContain(report.run_dir);
			expect(writableTargets).toContain(path.join(report.run_dir, "worker"));
			const workspaceBind = args.findIndex(
				(arg, index) =>
					arg === "--bind" && args[index + 1] === fixture.workspace,
			);
			const controlReadOnlyBind = args.findIndex(
				(arg, index) =>
					arg === "--ro-bind" && args[index + 1] === report.run_dir,
			);
			expect(controlReadOnlyBind).toBeGreaterThan(workspaceBind);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("overlays Git metadata read-only after the writable workspace bind", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const args = fs.readFileSync(fixture.bwrapArgsLog, "utf8").split("\n");
			const workspaceBind = args.findIndex(
				(arg, index) =>
					arg === "--bind" && args[index + 1] === fixture.workspace,
			);
			const gitPath = path.join(fixture.workspace, ".git");
			const gitReadOnlyBind = args.findIndex(
				(arg, index) =>
					arg === "--ro-bind" && args[index + 1] === gitPath,
			);
			expect(workspaceBind).toBeGreaterThanOrEqual(0);
			expect(gitReadOnlyBind).toBeGreaterThan(workspaceBind);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("mounts the workspace read-only in review mode", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				[
					"--mode",
					"review",
					"--workspace",
					fixture.workspace,
					"--prompt-file",
					path.join(fixture.workspace, "prompt.md"),
				],
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const args = fs.readFileSync(fixture.bwrapArgsLog, "utf8").split("\n");
			expect(
				args.some(
					(arg, index) =>
						arg === "--ro-bind" &&
						args[index + 1] === fixture.workspace &&
						args[index + 2] === fixture.workspace,
				),
			).toBe(true);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("treats a single star as one path component in scope globs", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		fs.writeFileSync(path.join(fixture.workspace, "scope.txt"), "src/*.js\n");
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
				{
					FAKE_MUTATION_PATH: "src/deep/a.js",
					FAKE_WORKSPACE: fixture.workspace,
				},
			);
			expect(result.exitCode, result.stderr.toString()).toBe(5);
			const report = JSON.parse(result.stdout.toString());
			expect(report.launcher_status).toBe("blocked_out_of_scope");
			expect(report.out_of_scope_paths).toContain("src/deep/a.js");
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("uses a PID namespace so worker descendants die with the sandbox", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const args = fs.readFileSync(fixture.bwrapArgsLog, "utf8").split("\n");
			expect(args).toContain("--unshare-pid");
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("terminates worker descendants before publishing success", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		const pidFile = path.join(fixture.root, "background.pid");
		let backgroundPid;
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
				{ FAKE_BACKGROUND_PID_FILE: pidFile },
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			backgroundPid = Number.parseInt(fs.readFileSync(pidFile, "utf8"), 10);
			const probe = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(backgroundPid)]);
			const state = probe.stdout.toString().trim();
			expect(state === "" || state.startsWith("Z")).toBe(true);
		} finally {
			if (backgroundPid) Bun.spawnSync(["kill", "-KILL", String(backgroundPid)]);
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("runs version discovery and receipt export through the managed sandbox", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const args = fs.readFileSync(fixture.bwrapArgsLog, "utf8").split("\n");
			expect(args.filter((arg) => arg === "--unshare-pid")).toHaveLength(3);
			expect(args).toContain("--version");
			expect(args).toContain("export");
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("hides host procfs and runtime socket directories in both sandboxes", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const args = fs.readFileSync(fixture.bwrapArgsLog, "utf8").split("\n");
			const pairCount = (flag, value) =>
				args.filter((arg, index) => arg === flag && args[index + 1] === value)
					.length;
			expect(pairCount("--proc", "/proc")).toBe(3);
			expect(pairCount("--tmpfs", "/run")).toBe(3);
			expect(pairCount("--tmpfs", "/tmp")).toBe(3);
		for (const variable of [
			"DBUS_SESSION_BUS_ADDRESS",
			"DISPLAY",
			"WAYLAND_DISPLAY",
			"SSH_AUTH_SOCK",
			"XAUTHORITY",
		]) {
			expect(pairCount("--unsetenv", variable)).toBe(3);
		}
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("strips the gateway marker from the sandboxed worker environment", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const args = fs.readFileSync(fixture.bwrapArgsLog, "utf8").split("\n");
			const pairCount = (flag, value) =>
				args.filter((arg, index) => arg === flag && args[index + 1] === value)
					.length;
			expect(pairCount("--unsetenv", "DISPLAY")).toBe(3);
			expect(pairCount("--unsetenv", "CODEX_WRAPPER_GATEWAY")).toBe(3);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("restores the host resolver file read-only inside private run", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const resolver = fs.realpathSync("/etc/resolv.conf");
			const args = fs.readFileSync(fixture.bwrapArgsLog, "utf8").split("\n");
			if (resolver.startsWith("/run/")) {
				const restored = args.filter(
					(arg, index) =>
						arg === "--file" &&
						args[index + 1] === "8" &&
						args[index + 2] === resolver,
				);
				expect(restored).toHaveLength(3);
			}
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("reports an allowed implementation mutation with exact terminal keys", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
				{ FAKE_MUTATION_PATH: "hello.txt", FAKE_WORKSPACE: fixture.workspace },
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const report = JSON.parse(result.stdout.toString());
			expect(report.changed_paths).toEqual(["hello.txt"]);
			expect(Object.keys(report).sort()).toEqual(
				[
					"attribution_complete",
					"changed_paths",
					"duration_s",
					"events_path",
					"exit_code",
					"export_summary",
					"launcher_status",
					"mode",
					"opencode_version",
					"out_of_scope_paths",
					"receipt",
					"requested_model",
					"result_valid",
					"run_dir",
					"session_id",
					"worker_result",
				].sort(),
			);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("detects a review mutation even when the fake sandbox violates read-only", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				[
					"--mode",
					"review",
					"--workspace",
					fixture.workspace,
					"--prompt-file",
					path.join(fixture.workspace, "prompt.md"),
				],
				"opencode-wrapper",
				{
					FAKE_MUTATION_PATH: "review-write.txt",
					FAKE_WORKSPACE: fixture.workspace,
				},
			);
			expect(result.exitCode, result.stderr.toString()).toBe(5);
			const report = JSON.parse(result.stdout.toString());
			expect(report.launcher_status).toBe(
				"blocked_review_workspace_mutation",
			);
			expect(report.changed_paths).toEqual(["review-write.txt"]);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("attributes a newly-created ignored file", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		fs.writeFileSync(path.join(fixture.workspace, ".gitignore"), ".env\n");
		fs.writeFileSync(path.join(fixture.workspace, "scope.txt"), ".env\n");
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
				{ FAKE_MUTATION_PATH: ".env", FAKE_WORKSPACE: fixture.workspace },
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			expect(JSON.parse(result.stdout.toString()).changed_paths).toContain(
				".env",
			);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("fails closed on a provider mismatch in the exported receipt", () => {
		const fixture = makeLauncherFixture("1.18.18", "forged-provider");
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(70);
			expect(JSON.parse(result.stdout.toString()).launcher_status).toBe(
				"blocked_receipt_mismatch",
			);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("parses pure JSON export stdout without deleting the opening brace", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const report = JSON.parse(result.stdout.toString());
			expect(report.launcher_status).toBe("ok");
			expect(report.receipt).toEqual({
				modelID: "glm-5.3",
				providerID: "opencode-go",
				variant: "high",
			});
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("retries receipt parsing after leading non-JSON stdout", () => {
		const fixture = makeLauncherFixture(
			"1.18.18",
			"opencode-go",
			"Exporting session: ses_test\n",
		);
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			expect(JSON.parse(result.stdout.toString()).launcher_status).toBe("ok");
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("fails closed distinctly when export stdout is not parseable JSON", () => {
		const fixture = makeLauncherFixture();
		fixture.exportStdout = "not json\nstill not json\n";
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(70);
			const report = JSON.parse(result.stdout.toString());
			expect(report.launcher_status).toBe("blocked_receipt_unparseable");
			expect(report.receipt).toEqual({
				modelID: "",
				providerID: "",
				variant: "",
			});
			expect(report.export_summary).toEqual({});
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("uses a valid OPENCODE_SEAT_BIN instead of the PATH shim", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
			);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const args = fs.readFileSync(fixture.bwrapArgsLog, "utf8").split("\n");
			expect(args).toContain(fixture.realOpencode);
			expect(args).not.toContain(path.join(fixture.fakeBin, "opencode"));
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	for (const invalidOverride of ["missing", "non-executable"]) {
		it(`fails closed for a ${invalidOverride} OPENCODE_SEAT_BIN`, () => {
			const fixture = makeLauncherFixture();
			installSuccessfulBwrap(fixture);
			const override = path.join(fixture.root, invalidOverride);
			if (invalidOverride === "non-executable") {
				fs.copyFileSync("/bin/true", override);
				fs.chmodSync(override, 0o644);
			}
			try {
				const result = runLauncher(
					fixture,
					implementationArgs(fixture.workspace),
					"opencode-wrapper",
					{ OPENCODE_SEAT_BIN: override },
				);
				expect(result.exitCode, result.stderr.toString()).toBe(69);
				expect(JSON.parse(result.stdout.toString()).launcher_status).toBe(
					"blocked_opencode_seat_bin_invalid",
				);
			} finally {
				fs.rmSync(fixture.root, { force: true, recursive: true });
			}
		});
	}

	it("reports an actionable blocker for a text-script opencode on PATH", () => {
		const fixture = makeLauncherFixture();
		installSuccessfulBwrap(fixture);
		try {
			const shimPath = path.join(fixture.fakeBin, "opencode");
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
				{ FAKE_VERSION_EXIT: "127", OPENCODE_SEAT_BIN: null },
			);
			expect(result.exitCode, result.stderr.toString()).toBe(69);
			const report = JSON.parse(result.stdout.toString());
			expect(report.launcher_status).toBe("blocked_opencode_shim_detected");
			expect(result.stderr.toString()).toContain(shimPath);
			expect(result.stderr.toString()).toContain("network-resolving shim");
			expect(result.stderr.toString()).toContain("OPENCODE_SEAT_BIN");
			expect(result.stderr.toString()).not.toContain(
				"blocked_opencode_version_check_failed",
			);
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});

	it("treats exit 127 from an ELF PATH binary as a shim blocker", () => {
		const fixture = makeLauncherFixture();
		fs.copyFileSync("/bin/true", path.join(fixture.fakeBin, "opencode"));
		fs.chmodSync(path.join(fixture.fakeBin, "opencode"), 0o755);
		installSuccessfulBwrap(fixture);
		try {
			const result = runLauncher(
				fixture,
				implementationArgs(fixture.workspace),
				"opencode-wrapper",
				{ FAKE_VERSION_EXIT: "127", OPENCODE_SEAT_BIN: null },
			);
			expect(result.exitCode, result.stderr.toString()).toBe(69);
			const report = JSON.parse(result.stdout.toString());
			expect(report.launcher_status).toBe("blocked_opencode_shim_detected");
			expect(result.stderr.toString()).toContain("version check exited 127");
		} finally {
			fs.rmSync(fixture.root, { force: true, recursive: true });
		}
	});
});
