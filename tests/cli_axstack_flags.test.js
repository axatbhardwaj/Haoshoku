import { describe, expect, it } from "bun:test";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const cli = path.join(projectRoot, "haoshoku.js");
const cliUtils = path.join(projectRoot, "src/common/cli_utils.js");
const helper = path.join(projectRoot, "src/helpers/configure_axstack.js");

function runFlag(flag, ok) {
	const childScript = `
		import { mock } from "bun:test";
		mock.module(${JSON.stringify(cliUtils)}, () => ({
			detectOS: () => "arch",
			findActiveModeFlags: (options) => [options.axstack ? "axstack" : options.axstackCheck ? "axstackCheck" : null].filter(Boolean),
		}));
		mock.module(${JSON.stringify(helper)}, () => ({
			configureAxstack: async () => { console.log("AXSTACK_INSTALL"); return { ok: ${ok} }; },
			checkAxstack: async () => { console.log("AXSTACK_CHECK"); return { ok: ${ok} }; },
		}));
		process.argv = [process.execPath, ${JSON.stringify(cli)}, ${JSON.stringify(flag)}];
		await import(${JSON.stringify(cli)} + "?axstack-flag=" + ${JSON.stringify(flag)} + "-" + ${ok});
	`;
	const child = Bun.spawnSync([process.execPath, "--eval", childScript], {
		stderr: "pipe",
		stdout: "pipe",
	});
	return {
		exitCode: child.exitCode,
		output: `${new TextDecoder().decode(child.stdout)}\n${new TextDecoder().decode(child.stderr)}`,
	};
}

describe("Axstack CLI modes", () => {
	it.each([
		["--axstack", "AXSTACK_INSTALL"],
		["--axstack-check", "AXSTACK_CHECK"],
	])("wires %s to its helper", (flag, marker) => {
		const result = runFlag(flag, true);
		expect(result.exitCode, result.output).toBe(0);
		expect(result.output).toContain(marker);
	});

	it.each([
		"--axstack",
		"--axstack-check",
	])("sets a nonzero exit for failed %s results", (flag) => {
		const result = runFlag(flag, false);
		expect(result.exitCode, result.output).toBe(1);
	});
});
