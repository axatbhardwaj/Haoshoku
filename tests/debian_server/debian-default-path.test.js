import { describe, expect, it } from "bun:test";
import { runDefaultSetupWithSafeDoubles } from "./fixtures.js";

describe("Debian default path", () => {
	it("runs every server-applicable developer component in deliberate order", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles();
		const prompts = events.filter(({ type }) => type === "prompt");
		const helpers = events
			.filter(({ type }) => type === "helper")
			.map(({ name }) => name);

		expect(prompts).toContainEqual({
			type: "prompt",
			message: "Configure git?",
			initial: true,
		});
		expect(prompts.some(({ message }) => message.includes("gh-stack"))).toBe(
			false,
		);
		expect(
			prompts.filter(({ message }) =>
				/Claude stay-awake|Claude Remote Control|PR watch/.test(message),
			),
		).toEqual([]);
		expect(prompts).toContainEqual({
			type: "prompt",
			message: expect.stringContaining("daily disk cleanup"),
			initial: false,
		});
		expect(prompts.some(({ message }) => message.includes("device"))).toBe(
			false,
		);
		expect(prompts.some(({ message }) => /T3 Code|Hermes/i.test(message))).toBe(
			false,
		);
		expect(helpers).toEqual([
			"git",
			"claude",
			"gh-stack",
			"worktree-cleanup",
			"codex",
			"agents",
			"axstack",
			"hermes-relay",
			"t3-code-server",
		]);
		expect(result).toBe(true);
	});

	it("requires T3 Code without a prompt and runs the same server helper", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles();

		expect(result).toBe(true);
		expect(events).toContainEqual({ type: "helper", name: "t3-code-server" });
		expect(events).not.toContainEqual({ type: "helper", name: "paseo-server" });
	});

	it("reports Axstack failure without failing the remaining default setup", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			axstackResult: false,
		});

		expect(result).toBe(true);
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining("Axstack setup is incomplete"),
		});
	});

	it("reports Claude and Codex install failures without failing setup", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			claudeResult: { ok: false, reason: "installer unavailable" },
			codexResult: { ok: false, reason: "registry unavailable" },
		});

		expect(result).toBe(true);
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining(
				"Claude CLI installation failed: installer unavailable",
			),
		});
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining(
				"Codex CLI installation failed: registry unavailable",
			),
		});
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining(
				"Claude (installer unavailable); Codex (registry unavailable)",
			),
		});
	});

	it("continues server setup when Codex rejects ambiguous config", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			codexError: "Ambiguous multiline TOML",
		});
		expect(result).toBe(true);
		expect(events).toContainEqual({ type: "helper", name: "agents" });
		expect(events).toContainEqual({ type: "helper", name: "axstack" });
		expect(events).not.toContainEqual({
			type: "helper",
			name: "paseo-profiles",
		});
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining("Ambiguous multiline TOML"),
		});
	});

	it("propagates required T3 Code setup failure without prompting", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			t3Result: false,
		});

		expect(result).toBe(false);
		expect(
			events.filter(
				({ type, message }) => type === "prompt" && /T3 Code/i.test(message),
			),
		).toEqual([]);
		expect(events.at(-1)).toEqual({
			type: "error",
			message: "Debian Server setup finished, but T3 Code was not configured.",
		});
	});

	it("propagates Hermes failure without prompting for Hermes", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			relayResult: false,
		});
		const helpers = events
			.filter(({ type }) => type === "helper")
			.map(({ name }) => name);

		expect(result).toBe(false);
		expect(helpers).toContain("hermes-relay");
		expect(
			events.filter(
				({ type, message }) => type === "prompt" && /hermes/i.test(message),
			),
		).toEqual([]);
		expect(events.at(-1)).toEqual({
			type: "error",
			message:
				"Debian Server setup finished, but the Hermes relay is incomplete.",
		});
	});
	it("never calls the retired Paseo helper during successful or failed setup", () => {
		for (const options of [{}, { t3Result: false }, { relayResult: false }]) {
			const { events, result } = runDefaultSetupWithSafeDoubles(options);
			expect(result).toBe(!Object.values(options).includes(false));
			expect(events).toContainEqual({ type: "helper", name: "hermes-relay" });
			expect(events).toContainEqual({ type: "helper", name: "t3-code-server" });
			expect(events).not.toContainEqual({
				type: "helper",
				name: "paseo-server",
			});
		}
	});
});

// First Usage slice: exercise the public firewall and whole Debian outcome.
