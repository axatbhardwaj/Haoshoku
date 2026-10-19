import { describe, expect, it } from "bun:test";
import { makeFakeRun, sshRule, makeFakeCapture, makeFakePrompt } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("setupFirewall (UFW lockout gate)", () => {
	it("does NOT enable UFW when the SSH allow rule fails (remote lockout risk)", async () => {
		const { run, calls } = makeFakeRun({ "to any app OpenSSH": false });
		const { prompt, calls: promptCalls } = makeFakePrompt(true);

		await setupFirewall({ run, prompt, capture: makeFakeCapture().capture });

		expect(calls.some((c) => c.includes("ufw enable"))).toBe(false);
		// It must not even reach the enable prompt.
		expect(promptCalls.length).toBe(0);
	});

	it("enables UFW when all rules succeed and the user confirms", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: promptCalls } = makeFakePrompt(true);

		await setupFirewall({ run, prompt, capture: makeFakeCapture().capture });

		expect(promptCalls.length).toBe(1);
		expect(calls.some((c) => c.includes("ufw enable"))).toBe(true);
	});

	it("does NOT enable UFW when rules succeed but the user declines", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt } = makeFakePrompt(false);

		await setupFirewall({ run, prompt, capture: makeFakeCapture().capture });

		expect(calls.some((c) => c.includes("ufw enable"))).toBe(false);
	});

	it("runs the SSH allow rule before deciding to enable", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt } = makeFakePrompt(true);

		await setupFirewall({ run, prompt, capture: makeFakeCapture().capture });

		expect(calls.some((c) => c === sshRule)).toBe(true);
	});
});

