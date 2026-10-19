import { describe, expect, it } from "bun:test";
import { makeFakeRun, makeFakePrompt, runDefaultSetupWithSafeDoubles } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("tailnet firewall prerequisites", () => {
	it("refuses fresh Debian without working Tailscale before any UFW mutation", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: prompts } = makeFakePrompt(true);
		const result = await setupFirewall({
			run,
			prompt,
			capture: async () => ({
				exitCode: 127,
				failed: true,
				stdout: "",
				stderr: "tailscale: command not found",
			}),
		});
		expect(calls).toEqual([]);
		expect(prompts).toEqual([]);
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/Tailscale/i);
	});
	it("reports overall Debian setup incomplete when Tailscale is missing", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			missingTailscale: true,
		});
		expect(result).toBe(false);
		expect(
			events.filter(
				({ type, command }) =>
					type === "command" && command.startsWith("sudo ufw "),
			),
		).toEqual([]);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(/firewall.*incomplete.*retry/i),
		});
	});
});

