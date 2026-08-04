import { describe, expect, it } from "bun:test";

import { log } from "../src/common/utils.js";
import {
	configureBrowserIntegration,
	configureUserApps,
} from "../src/os_scripts/cachyos.js";

describe("CachyOS browser integration", () => {
	// Mutation caught: activating MIME defaults before the installed wrapper
	// exists can leave the desktop handler pointing at a missing command.
	it("seeds profiles and installs scripts before deploying MIME handlers", async () => {
		const calls = [];
		const record = (name) => async () => calls.push(name);

		await configureBrowserIntegration({
			configureChromiumProfilesImpl: record("profiles"),
			configureMimeappsImpl: record("mimeapps"),
			installUserScriptsImpl: record("scripts"),
		});

		expect(calls).toEqual(["profiles", "scripts", "mimeapps"]);
	});

	it("runs browser integration from the CachyOS user-app setup", async () => {
		const calls = [];
		const record = (name) => async () => calls.push(name);

		await configureUserApps({
			promptUserImpl: async () => false,
			configureBrowserIntegrationImpl: record("browser-integration"),
			configureAudioImpl: record("audio"),
			configureBashImpl: () => calls.push("bash"),
			configureFastfetchImpl: record("fastfetch"),
			runCommandImpl: record("uosc"),
			enableServicesImpl: record("services"),
			configureClaudeImpl: record("claude"),
			configureClaudeStayAwakeImpl: record("stay-awake"),
			configurePrWatchImpl: record("pr-watch"),
			configureCodexImpl: record("codex"),
			configureAgentOsImpl: record("agent-os"),
		});

		expect(calls.slice(0, 2)).toEqual(["browser-integration", "audio"]);
	});

	it("continues without bootstrapping private Claude policy when declined", async () => {
		const calls = [];
		const prompts = [];
		const record = (name) => async () => calls.push(name);

		await configureUserApps({
			promptUserImpl: async (message, initial) => {
				prompts.push({ message, initial });
				return false;
			},
			configureBrowserIntegrationImpl: record("browser-integration"),
			configureAudioImpl: record("audio"),
			configureBashImpl: () => calls.push("bash"),
			configureFastfetchImpl: record("fastfetch"),
			runCommandImpl: record("uosc"),
			enableServicesImpl: record("services"),
			configureClaudeImpl: record("claude"),
			bootstrapClaudePolicyImpl: record("bootstrap"),
			configureClaudeStayAwakeImpl: record("stay-awake"),
			configurePrWatchImpl: record("pr-watch"),
			configureCodexImpl: record("codex"),
			configureAgentOsImpl: record("agent-os"),
		});

		expect(prompts).toContainEqual({
			message: "Bootstrap private Claude policy repository?",
			initial: true,
		});
		expect(calls).not.toContain("bootstrap");
		expect(calls).toContain("agent-os");
	});

	it("bootstraps private Claude policy after the public baseline", async () => {
		const calls = [];
		const record = (name) => async () => calls.push(name);

		await configureUserApps({
			promptUserImpl: async (message) =>
				message === "Bootstrap private Claude policy repository?",
			configureBrowserIntegrationImpl: record("browser-integration"),
			configureAudioImpl: record("audio"),
			configureBashImpl: () => calls.push("bash"),
			configureFastfetchImpl: record("fastfetch"),
			runCommandImpl: record("uosc"),
			enableServicesImpl: record("services"),
			configureClaudeImpl: record("claude"),
			bootstrapClaudePolicyImpl: record("bootstrap"),
			configureClaudeStayAwakeImpl: record("stay-awake"),
			configurePrWatchImpl: record("pr-watch"),
			configureCodexImpl: record("codex"),
			configureAgentOsImpl: record("agent-os"),
		});

		expect(calls.indexOf("bootstrap")).toBe(calls.indexOf("claude") + 1);
		expect(calls).toContain("agent-os");
	});

	it("warns with a retry command and continues when policy bootstrap fails", async () => {
		const calls = [];
		const warnings = [];
		const record = (name) => async () => calls.push(name);
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);

		try {
			await configureUserApps({
				promptUserImpl: async (message) =>
					message === "Bootstrap private Claude policy repository?",
				configureBrowserIntegrationImpl: record("browser-integration"),
				configureAudioImpl: record("audio"),
				configureBashImpl: () => calls.push("bash"),
				configureFastfetchImpl: record("fastfetch"),
				runCommandImpl: record("uosc"),
				enableServicesImpl: record("services"),
				configureClaudeImpl: record("claude"),
				bootstrapClaudePolicyImpl: async () => false,
				configureClaudeStayAwakeImpl: record("stay-awake"),
				configurePrWatchImpl: record("pr-watch"),
				configureCodexImpl: record("codex"),
				configureAgentOsImpl: record("agent-os"),
			});
		} finally {
			log.warning = originalWarning;
		}

		expect(warnings.join("\n")).toContain("haoshoku --claude-bootstrap");
		expect(calls).toContain("agent-os");
	});
});
