import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const cli = path.join(projectRoot, "haoshoku.js");
const cliUtils = path.join(projectRoot, "src/common/cli_utils.js");
const t3Helper = path.join(
	projectRoot,
	"src/helpers/configure_tailscale_t3.js",
);

function runServerMode(detectedOS, helperResult = true, helperError) {
	const childScript = `
		import { mock } from "bun:test";
		mock.module(${JSON.stringify(cliUtils)}, () => ({
			detectOS: () => ${JSON.stringify(detectedOS)},
			findActiveModeFlags: (options) => options.tailscaleT3 ? ["tailscaleT3"] : [],
		}));
		mock.module(${JSON.stringify(t3Helper)}, () => ({
			configureTailscaleT3: async () => {
				console.log("T3_HELPER_CALLED");
				if (${JSON.stringify(helperError ?? null)}) throw new Error(${JSON.stringify(helperError ?? null)});
				return ${JSON.stringify(helperResult)};
			},
		}));
		process.argv = [process.execPath, ${JSON.stringify(cli)}, "--tailscale-t3"];
		await import(${JSON.stringify(cli)} + "?tailscale-t3-" + ${JSON.stringify(detectedOS)});
	`;

	const home = fs.mkdtempSync(path.join(os.tmpdir(), "tailscale-t3-cli-"));
	try {
		const child = Bun.spawnSync([process.execPath, "--eval", childScript], {
			env: {
				...process.env,
				HOME: home,
				XDG_STATE_HOME: path.join(home, "state"),
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		return {
			exitCode: child.exitCode,
			output: `${new TextDecoder().decode(child.stdout)}\n${new TextDecoder().decode(child.stderr)}`,
		};
	} finally {
		fs.rmSync(home, { recursive: true });
	}
}

describe("--tailscale-t3", () => {
	it("rejects non-Arch hosts before invoking the installer", () => {
		const result = runServerMode("debian-server");
		expect(result.exitCode).toBe(2);
		expect(result.output).toContain("requires an Arch-family host");
		expect(result.output).not.toContain("T3_HELPER_CALLED");
	});

	it("invokes the headless installer on Arch-family hosts", () => {
		const result = runServerMode("arch");
		expect(result.exitCode, result.output).toBe(0);
		expect(result.output).toContain("T3_HELPER_CALLED");
	});
	it("fails the CLI when T3 setup is incomplete", () => {
		const result = runServerMode("arch", false);
		expect(result.exitCode, result.output).toBe(1);
		expect(result.output).toContain("T3_HELPER_CALLED");
	});
});

it("reports a throwing iobox T3 helper cleanly with exit 1", () => {
	const result = runServerMode("arch", false, "linger failed: sudo denied");
	expect(result.exitCode, result.output).toBe(1);
	expect(result.output).toContain("linger failed: sudo denied");
	expect(result.output).not.toContain("at configureTailscaleT3");
	expect(result.output).not.toContain("throw new Error");
	expect(result.output.toLowerCase()).not.toContain("unhandled");
});
