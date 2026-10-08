import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRunLog } from "../src/common/run_log.js";

import * as ghStack from "../src/helpers/configure_gh_stack.js";
import { configureUserApps } from "../src/os_scripts/cachyos.js";

const { installGhStack } = ghStack;

function userAppDoubles(overrides = {}) {
	return {
		promptUserImpl: async () => false,
		commandExistsImpl: async () => false,
		configureGitImpl: async () => {},
		configureBrowserIntegrationImpl: async () => {},
		configureAudioImpl: async () => {},
		configureBashImpl: () => {},
		configureFastfetchImpl: async () => {},
		configureGhosttyImpl: async () => {},
		runCommandImpl: async () => true,
		enableServicesImpl: async () => {},
		configureClaudeImpl: async () => {},
		installGhStackImpl: async () => {},
		configureCodexImpl: async () => {},
		syncAgentsConfigImpl: async () => {},
		configureAxstackImpl: async () => ({ ok: true }),
		configureAgentAccountsImpl: async () => true,
		...overrides,
	};
}

describe("gh stack provisioning", () => {
	it("detects the real gh extension row and rejects unrelated extensions", () => {
		expect(
			ghStack.ghStackIsInstalled?.("gh stack\tgithub/gh-stack\tv0.1.0"),
		).toBe(true);
		expect(
			ghStack.ghStackIsInstalled?.(
				"gh dash\tdlvhdr/gh-dash\tv4.12.0\ngh foo\towner/other\tv1.0.0",
			),
		).toBe(false);
	});

	it("installs gh stack on the Arch path without offering a prompt", async () => {
		const offers = [];
		let installCalls = 0;

		await configureUserApps(
			userAppDoubles({
				promptUserImpl: async (message, initial) => {
					offers.push({ message, initial });
					return false;
				},
				installGhStackImpl: async () => {
					installCalls += 1;
				},
			}),
		);

		expect(offers.map(({ message }) => message)).not.toContain(
			"Install GitHub gh-stack extension?",
		);
		expect(installCalls).toBe(1);
	});

	it("does nothing when gh-stack is already listed as an extension", async () => {
		const commands = [];
		const messages = [];
		const result = await installGhStack({
			commandExistsImpl: async () => true,
			runner: async (argv) => {
				commands.push(argv);
				return {
					exitCode: 0,
					stdout: "gh stack\tgithub/gh-stack\tv0.1.0",
				};
			},
			logImpl: {
				info: (message) => messages.push(message),
				success: (message) => messages.push(message),
				warning: (message) => messages.push(message),
			},
		});

		expect(result).toBe("already-installed");
		expect(commands).toEqual([["gh", "extension", "list"]]);
		expect(messages).toEqual([]);
	});

	it("skips with a clear message when gh is absent from PATH", async () => {
		const messages = [];
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "gh-stack-summary-"));
		const run = startRunLog({ env: { HOME: home, XDG_STATE_HOME: home } });
		const result = await installGhStack({
			commandExistsImpl: async () => false,
			runner: async () => {
				throw new Error("runner should not be called");
			},
			logImpl: {
				info: (message) => messages.push(message),
				success() {},
				warning() {},
			},
		});

		expect(result).toBe("missing-gh");
		expect(messages.join("\n")).toContain("gh");
		expect(messages.join("\n")).toContain("Skipping");
		run.finish(0, (message) => messages.push(message));
		try {
			expect(messages.at(-1)).toContain("haoshoku --gh-stack");
			expect(messages.at(-1)).toContain("Install GitHub CLI");
		} finally {
			fs.rmSync(home, { recursive: true });
		}
	});

	it("warns and continues when the gh stack install command throws", async () => {
		const warnings = [];
		const continued = [];

		await configureUserApps(
			userAppDoubles({
				installGhStackImpl: () =>
					installGhStack({
						commandExistsImpl: async () => true,
						runner: async (argv) => {
							if (argv.join(" ") === "gh extension list") {
								return { exitCode: 0, stdout: "" };
							}
							throw new Error("authentication required");
						},
						logImpl: {
							info() {},
							success() {},
							warning: (message) => warnings.push(message),
						},
					}),
				configureCodexImpl: async () => continued.push("codex"),
				configureAxstackImpl: async () => ({ ok: true }),
				syncAgentsConfigImpl: async () => continued.push("agents"),
			}),
		);

		expect(warnings.join("\n")).toContain("authentication required");
		expect(warnings.join("\n")).toContain("continuing");
		expect(continued).toEqual(["codex", "agents"]);
	});

	it("returns a non-zero CLI status when standalone installation fails", () => {
		const cliPath = new URL("../haoshoku.js", import.meta.url).pathname;
		const helperPath = new URL(
			"../src/helpers/configure_gh_stack.js",
			import.meta.url,
		).pathname;
		const child = Bun.spawnSync(
			[
				process.execPath,
				"--eval",
				`
					import { mock } from "bun:test";
					mock.module(${JSON.stringify(helperPath)}, () => ({
						installGhStack: async () => "failed",
					}));
					process.argv = [process.execPath, ${JSON.stringify(cliPath)}, "--gh-stack"];
					await import(${JSON.stringify(cliPath)});
				`,
			],
			{ stderr: "pipe", stdout: "pipe" },
		);

		expect(child.exitCode).toBe(1);
	});
});

// Exercise the real CLI and gh runner with an inert executable, including exit summary.
it.each([
	4, 1, 0,
])("prints only needed gh-stack next steps (gh exit %s)", (status) => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "gh-stack-cli-"));
	const bin = path.join(home, "bin");
	fs.mkdirSync(bin);
	fs.writeFileSync(
		path.join(bin, "gh"),
		`#!/bin/sh
printf '%s\\n' "$*" >> '${home}/commands'
if [ "$1 $2" = "extension list" ]; then exit ${status}; fi
exit 0
`,
		{ mode: 0o755 },
	);
	try {
		const child = Bun.spawnSync(
			[process.execPath, "haoshoku.js", "--gh-stack"],
			{
				env: {
					...process.env,
					HOME: home,
					XDG_STATE_HOME: home,
					PATH: `${bin}:${process.env.PATH}`,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const output =
			new TextDecoder().decode(child.stdout) +
			new TextDecoder().decode(child.stderr);
		const commands = fs.readFileSync(path.join(home, "commands"), "utf8");
		expect(child.exitCode, output).toBe(status === 0 ? 0 : 1);
		if (status === 0) {
			expect(commands).toContain("extension install github/gh-stack");
			expect(output).not.toContain("Next steps:");
		} else {
			expect(commands).not.toContain("extension install");
			const summary = output.slice(output.indexOf("Next steps:"));
			expect(output.indexOf("Next steps:")).toBeGreaterThan(
				output.indexOf("Log:"),
			);
			expect(summary).toContain("haoshoku --gh-stack");
			expect(summary).not.toContain("haoshoku --axstack");
			if (status === 4) {
				expect(output).toContain("not authenticated");
				expect(summary).toContain("gh auth login");
			} else {
				expect(summary).toContain("exit code 1");
				expect(summary).not.toContain("not authenticated");
			}
			const logs = fs.readdirSync(path.join(home, "haoshoku/logs"));
			expect(
				fs.readFileSync(path.join(home, "haoshoku/logs", logs[0]), "utf8"),
			).toContain(summary.trim());
		}
	} finally {
		fs.rmSync(home, { recursive: true });
	}
});
