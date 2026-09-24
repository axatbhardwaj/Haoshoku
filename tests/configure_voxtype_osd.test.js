import { describe, expect, it } from "bun:test";
import { configureVoxtypeOsd } from "../src/helpers/configure_voxtype_osd.js";

function harness({
	hasVoxtype = true,
	osdEnabled = "true",
	setOk = true,
} = {}) {
	const commands = [];
	return {
		commands,
		options: {
			commandExistsImpl: async (command) => command === "voxtype" && hasVoxtype,
			captureCommandImpl: async (command) => {
				commands.push(command);
				return { exitCode: 0, stdout: `${osdEnabled}\n`, stderr: "" };
			},
			runCommandImpl: async (command) => {
				commands.push(command);
				return command.startsWith("voxtype config set") ? setOk : true;
			},
		},
	};
}

describe("configureVoxtypeOsd", () => {
	it("skips when voxtype is unavailable", async () => {
		const { commands, options } = harness({ hasVoxtype: false });
		expect(await configureVoxtypeOsd(options)).toEqual({ changed: false });
		expect(commands).toEqual([]);
	});

	it("does nothing when the OSD is already off", async () => {
		const { commands, options } = harness({ osdEnabled: "false" });
		expect(await configureVoxtypeOsd(options)).toEqual({ changed: false });
		expect(commands).toEqual(["voxtype config get osd.enabled"]);
	});

	it("turns the OSD off and restarts a running daemon", async () => {
		const { commands, options } = harness();
		expect(await configureVoxtypeOsd(options)).toEqual({ changed: true });
		expect(commands).toEqual([
			"voxtype config get osd.enabled",
			"voxtype config set osd.enabled false",
			"systemctl --user try-restart voxtype.service",
		]);
	});

	it("does not restart the daemon when the config write fails", async () => {
		const { commands, options } = harness({ setOk: false });
		expect(await configureVoxtypeOsd(options)).toEqual({ changed: false });
		expect(commands).toEqual([
			"voxtype config get osd.enabled",
			"voxtype config set osd.enabled false",
		]);
	});
});
