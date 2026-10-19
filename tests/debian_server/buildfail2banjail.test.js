import { describe, expect, it } from "bun:test";
import { buildFail2banJail } from "../../src/os_scripts/debian_server.js";

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
