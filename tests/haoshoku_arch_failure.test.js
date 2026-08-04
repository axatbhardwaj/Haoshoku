import { describe, expect, it } from "bun:test";
import path from "node:path";

const decoder = new TextDecoder();

describe("Arch CLI dispatch", () => {
	it("exits nonzero without prompting for skill sync when setup fails", () => {
		const cliPath = path.resolve(import.meta.dir, "..", "haoshoku.js");
		const setupModulePath = path.resolve(
			import.meta.dir,
			"..",
			"src",
			"os_scripts",
			"cachyos.js",
		);
		const childScript = `
			import { mock } from "bun:test";
			mock.module(${JSON.stringify(setupModulePath)}, () => ({
				runCachyOSSetup: async () => {
					console.log("ARCH_SETUP_CALLED");
					return false;
				},
			}));
			mock.module("prompts", () => ({
				default: async () => {
					console.log("SKILL_SYNC_PROMPT_CALLED");
					return { syncSkills: false };
				},
			}));
			process.argv = [process.execPath, ${JSON.stringify(cliPath)}, "--os", "arch"];
			await import(${JSON.stringify(cliPath)});
			await Bun.sleep(25);
		`;

		const child = Bun.spawnSync([process.execPath, "--eval", childScript], {
			stderr: "pipe",
			stdout: "pipe",
		});
		const output = `${decoder.decode(child.stdout)}\n${decoder.decode(child.stderr)}`;

		expect(output).toContain("ARCH_SETUP_CALLED");
		expect(output).not.toContain("SKILL_SYNC_PROMPT_CALLED");
		expect(child.exitCode).toBe(1);
	});
});
