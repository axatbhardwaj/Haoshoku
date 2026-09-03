import { describe, expect, it } from "bun:test";

import {
	HERDR_INSTALL_COMMAND,
	configureHerdr,
} from "../src/helpers/configure_herdr.js";

function harness({ installed = true, runResult = () => true } = {}) {
	const commands = [];
	const messages = { info: [], warning: [], success: [] };
	return {
		commands,
		messages,
		opts: {
			userName: "xzat",
			commandExistsImpl: async () => installed,
			run: async (command) => {
				commands.push(command);
				return runResult(command);
			},
			logImpl: {
				info: (m) => messages.info.push(m),
				warning: (m) => messages.warning.push(m),
				success: (m) => messages.success.push(m),
				dim() {},
				error() {},
			},
		},
	};
}

describe("configureHerdr", () => {
	it("never reinstalls or updates an existing herdr", async () => {
		const h = harness();
		expect(await configureHerdr(h.opts)).toBe("configured");
		expect(h.commands).toEqual([
			"herdr channel set stable",
			"loginctl enable-linger xzat",
		]);
		expect(h.commands.some((c) => c.includes("update"))).toBe(false);
		expect(h.messages.info[0]).toContain("herdr update");
	});

	it("installs via the official installer when missing", async () => {
		const h = harness({ installed: false });
		expect(await configureHerdr(h.opts)).toBe("configured");
		expect(h.commands[0]).toBe(HERDR_INSTALL_COMMAND);
	});

	it("reports failed when the install fails and stops there", async () => {
		const h = harness({ installed: false, runResult: () => false });
		expect(await configureHerdr(h.opts)).toBe("failed");
		expect(h.commands).toEqual([HERDR_INSTALL_COMMAND]);
		expect(h.messages.warning[0]).toContain("haoshoku --herdr");
	});

	it("prints the loginctl command when lingering cannot be enabled", async () => {
		const h = harness({ runResult: (c) => !c.startsWith("loginctl") });
		expect(await configureHerdr(h.opts)).toBe("configured");
		expect(h.messages.warning.at(-1)).toContain("loginctl enable-linger xzat");
	});

	it("warns but continues when the channel cannot be pinned", async () => {
		const h = harness({ runResult: (c) => !c.startsWith("herdr channel") });
		expect(await configureHerdr(h.opts)).toBe("configured");
		expect(h.messages.warning[0]).toContain("herdr channel set stable");
		expect(h.commands).toContain("loginctl enable-linger xzat");
	});
});
