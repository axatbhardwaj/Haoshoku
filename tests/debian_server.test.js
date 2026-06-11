import { describe, expect, it } from "bun:test";
import {
	buildFail2banJail,
	setupFirewall,
} from "../src/os_scripts/debian_server.js";

// A fake `run` that records every command it sees and returns a configured
// result per command substring. Defaults to `true` (success) for any command
// not explicitly mapped.
function makeFakeRun(overrides = {}) {
	const calls = [];
	const run = async (command) => {
		calls.push(command);
		for (const [needle, result] of Object.entries(overrides)) {
			if (command.includes(needle)) return result;
		}
		return true;
	};
	return { run, calls };
}

function makeFakePrompt(value = true) {
	const calls = [];
	const prompt = async (message) => {
		calls.push(message);
		return value;
	};
	return { prompt, calls };
}

describe("buildFail2banJail", () => {
	const jail = buildFail2banJail();

	it("declares the [sshd] jail block", () => {
		expect(jail).toContain("[sshd]");
	});

	it("uses the systemd backend (Debian 12+ has no rsyslog/auth.log by default)", () => {
		expect(jail).toMatch(/^\s*backend\s*=\s*systemd\s*$/m);
	});

	it("keeps logpath = /var/log/auth.log (systemd backend ignores it)", () => {
		expect(jail).toMatch(/logpath\s*=\s*\/var\/log\/auth\.log/);
	});

	it("enables the jail", () => {
		expect(jail).toMatch(/enabled\s*=\s*true/);
	});

	it("is a pure function — repeated calls return identical content", () => {
		expect(buildFail2banJail()).toBe(jail);
	});
});

describe("setupFirewall (UFW lockout gate)", () => {
	it("does NOT enable UFW when the SSH allow rule fails (remote lockout risk)", async () => {
		const { run, calls } = makeFakeRun({ "ufw allow ssh": false });
		const { prompt, calls: promptCalls } = makeFakePrompt(true);

		await setupFirewall({ run, prompt });

		expect(calls.some((c) => c.includes("ufw enable"))).toBe(false);
		// It must not even reach the enable prompt.
		expect(promptCalls.length).toBe(0);
	});

	it("enables UFW when all rules succeed and the user confirms", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: promptCalls } = makeFakePrompt(true);

		await setupFirewall({ run, prompt });

		expect(promptCalls.length).toBe(1);
		expect(calls.some((c) => c.includes("ufw enable"))).toBe(true);
	});

	it("does NOT enable UFW when rules succeed but the user declines", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt } = makeFakePrompt(false);

		await setupFirewall({ run, prompt });

		expect(calls.some((c) => c.includes("ufw enable"))).toBe(false);
	});

	it("runs the SSH allow rule before deciding to enable", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt } = makeFakePrompt(true);

		await setupFirewall({ run, prompt });

		expect(calls.some((c) => c.includes("ufw allow ssh"))).toBe(true);
	});
});
