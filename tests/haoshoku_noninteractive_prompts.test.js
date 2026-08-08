import { describe, expect, it } from "bun:test";
import path from "node:path";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function runEntrypoint({ args = [], detectedOS, input = "" } = {}) {
	const cliPath = path.resolve(import.meta.dir, "..", "haoshoku.js");
	const cliUtilsPath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"common",
		"cli_utils.js",
	);
	const setupModulePath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"os_scripts",
		"cachyos.js",
	);
	const skillManagerPath = path.resolve(
		import.meta.dir,
		"..",
		"src",
		"helpers",
		"skill_manager.js",
	);
	const detectionMock =
		detectedOS === undefined
			? ""
			: `
				mock.module(${JSON.stringify(cliUtilsPath)}, () => ({
					detectOS: () => ${JSON.stringify(detectedOS)},
					findActiveModeFlags: () => [],
				}));
			`;
	const childScript = `
		import { mock } from "bun:test";
		${detectionMock}
		mock.module(${JSON.stringify(setupModulePath)}, () => ({
			runCachyOSSetup: async () => {
				console.log("ARCH_SETUP_CALLED");
				return true;
			},
		}));
		mock.module(${JSON.stringify(skillManagerPath)}, () => ({
			CACHE_DIR: "/haoshoku-test-cache",
			printAvailableSkills: () => {},
			syncSkills: () => {
				console.log("SKILL_SYNC_CALLED");
				return { status: "ok" };
			},
		}));
		process.argv = [process.execPath, ${JSON.stringify(cliPath)}, ...${JSON.stringify(args)}];
		await import(${JSON.stringify(cliPath)});
	`;

	const startedAt = performance.now();
	const child = Bun.spawnSync(
		["timeout", "3", process.execPath, "--eval", childScript],
		{
			stdin: encoder.encode(input),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	return {
		durationMs: performance.now() - startedAt,
		exitCode: child.exitCode,
		output: `${decoder.decode(child.stdout)}\n${decoder.decode(child.stderr)}`,
	};
}

describe("non-interactive entrypoint prompts", () => {
	it("declines a bare run when OS detection and interactive selection are unavailable", () => {
		const result = runEntrypoint({ detectedOS: null, input: "invalid\n" });

		expect(result.exitCode).toBe(1);
		expect(result.durationMs).toBeLessThan(3000);
		expect(result.output).toContain("Interactive OS selection unavailable");
		expect(result.output).toContain("declining setup");
		expect(result.output).toContain("--os arch");
		expect(result.output).toContain("--os debian-server");
		expect(result.output).not.toContain("Select the target operating system");
		expect(result.output).not.toContain("ARCH_SETUP_CALLED");
	});

	it("does not start an auto-detected setup from a piped yes answer", () => {
		const result = runEntrypoint({ detectedOS: "arch", input: "yes\n" });

		expect(result.exitCode).toBe(0);
		expect(result.durationMs).toBeLessThan(3000);
		expect(result.output).toContain(
			'Interactive confirmation unavailable; declining "Detected arch — run the full arch setup now?".',
		);
		expect(result.output).not.toContain("ARCH_SETUP_CALLED");
	});

	it("declines skill sync after an explicit setup when stdin has no answer", () => {
		const result = runEntrypoint({ args: ["--os", "arch"] });

		expect(result.exitCode).toBe(0);
		expect(result.durationMs).toBeLessThan(3000);
		expect(result.output).toContain("ARCH_SETUP_CALLED");
		expect(result.output).toContain(
			'Interactive confirmation unavailable; declining "Sync Claude Code skills from configured sources?".',
		);
		expect(result.output).not.toContain("SKILL_SYNC_CALLED");
	});
});
