import { describe, expect, it } from "bun:test";

import * as ghStack from "../src/helpers/configure_gh_stack.js";
import { configureUserApps } from "../src/os_scripts/cachyos.js";

const { installGhStack } = ghStack;

function userAppDoubles(overrides = {}) {
	return {
		promptUserImpl: async () => false,
		configureGitImpl: async () => {},
		configureBrowserIntegrationImpl: async () => {},
		configureAudioImpl: async () => {},
		configureBashImpl: () => {},
		configureFastfetchImpl: async () => {},
		configureKittyImpl: async () => {},
		runCommandImpl: async () => true,
		enableServicesImpl: async () => {},
		configureClaudeImpl: async () => {},
		installGhStackImpl: async () => {},
		configureClaudeStayAwakeImpl: async () => {},
		configureClaudeRemoteControlImpl: async () => {},
		configurePrWatchImpl: async () => {},
		syncWorktreeCleanupImpl: async () => {},
		configureCodexImpl: async () => {},
		configureSkillsImpl: async () => true,
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
				configureSkillsImpl: async () => continued.push("skills"),
			}),
		);

		expect(warnings.join("\n")).toContain("authentication required");
		expect(warnings.join("\n")).toContain("continuing");
		expect(continued).toEqual(["codex", "skills"]);
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
