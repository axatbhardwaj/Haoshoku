import { describe, expect, it } from "bun:test";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const cli = path.join(projectRoot, "haoshoku.js");
const cliUtils = path.join(projectRoot, "src/common/cli_utils.js");
const executorHelper = path.join(
	projectRoot,
	"src/helpers/configure_executor.js",
);

function runServerMode(detectedOS, { helperResult = true } = {}) {
	const childScript = `
		import { mock } from "bun:test";
		mock.module(${JSON.stringify(cliUtils)}, () => ({
			detectOS: () => ${JSON.stringify(detectedOS)},
			findActiveModeFlags: (options) => options.serverExecutor ? ["serverExecutor"] : [],
		}));
		mock.module(${JSON.stringify(executorHelper)}, () => ({
			configureExecutor: async () => {
				console.log("EXECUTOR_HELPER_CALLED");
				return ${JSON.stringify(helperResult)};
			},
		}));
		process.argv = [process.execPath, ${JSON.stringify(cli)}, "--server-executor"];
		await import(${JSON.stringify(cli)} + "?server-executor-" + ${JSON.stringify(detectedOS)} + "-" + ${JSON.stringify(String(helperResult))});
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

describe("--server-executor", () => {
	it("rejects non-Debian hosts before invoking the installer", () => {
		const { exitCode, output } = runServerMode("arch");
		expect(output).not.toContain("EXECUTOR_HELPER_CALLED");
		expect(output).toContain(
			"--server-executor requires a Debian-family host.",
		);
		expect(exitCode).toBe(2);
	});

	it("runs the helper on a Debian server host", () => {
		const { exitCode, output } = runServerMode("debian-server");
		expect(output).toContain("EXECUTOR_HELPER_CALLED");
		expect(exitCode).toBe(0);
	});

	it("propagates helper failure as a non-zero exit", () => {
		const { exitCode, output } = runServerMode("debian-server", {
			helperResult: false,
		});
		expect(output).toContain("EXECUTOR_HELPER_CALLED");
		expect(exitCode).toBe(1);
	});
});
