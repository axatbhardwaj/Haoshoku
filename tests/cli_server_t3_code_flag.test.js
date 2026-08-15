import { describe, expect, it } from "bun:test";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const cli = path.join(projectRoot, "haoshoku.js");
const cliUtils = path.join(projectRoot, "src/common/cli_utils.js");
const t3Helper = path.join(
	projectRoot,
	"src/helpers/configure_t3_code_server.js",
);

function runServerMode(detectedOS) {
	const childScript = `
		import { mock } from "bun:test";
		mock.module(${JSON.stringify(cliUtils)}, () => ({
			detectOS: () => ${JSON.stringify(detectedOS)},
			findActiveModeFlags: (options) => options.serverT3Code ? ["serverT3Code"] : [],
		}));
		mock.module(${JSON.stringify(t3Helper)}, () => ({
			configureT3CodeServer: async () => {
				console.log("T3_HELPER_CALLED");
				return true;
			},
		}));
		process.argv = [process.execPath, ${JSON.stringify(cli)}, "--server-t3-code"];
		await import(${JSON.stringify(cli)} + "?server-t3-code-" + ${JSON.stringify(detectedOS)});
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

describe("--server-t3-code", () => {
	it("rejects non-Debian hosts before invoking the installer", () => {
		const result = runServerMode("arch");
		expect(result.exitCode).toBe(2);
		expect(result.output).toContain("requires a Debian-family host");
		expect(result.output).not.toContain("T3_HELPER_CALLED");
	});

	it("invokes the headless installer on Debian-family hosts", () => {
		const result = runServerMode("debian-server");
		expect(result.exitCode, result.output).toBe(0);
		expect(result.output).toContain("T3_HELPER_CALLED");
	});
});
