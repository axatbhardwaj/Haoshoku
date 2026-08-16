import { describe, expect, it } from "bun:test";

import { log } from "../src/common/utils.js";
import {
	configureBrowserIntegration,
	configureUserApps,
} from "../src/os_scripts/cachyos.js";

function userAppDoubles(overrides = {}) {
	return {
		promptUserImpl: async () => false,
		configureGitImpl: async () => {},
		configureBrowserIntegrationImpl: async () => {},
		configureAudioImpl: async () => {},
		configureBashImpl: () => {},
		configureFastfetchImpl: async () => {},
		configureKittyImpl: async () => {},
		runCommandImpl: async () => true,
		enableServicesImpl: async () => {},
		configureClaudeImpl: async () => {},
		installGhStackImpl: async () => {},
		installSuperpowersImpl: async () => {},
		bootstrapClaudePolicyImpl: async () => true,
		configureClaudeStayAwakeImpl: async () => {},
		configureClaudeRemoteControlImpl: async () => {},
		configurePrWatchImpl: async () => {},
		syncWorktreeCleanupImpl: async () => {},
		configureCodexImpl: async () => {},
		configureAgentOsImpl: async () => {},
		...overrides,
	};
}

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

		await configureUserApps(userAppDoubles({
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
		}));

		expect(calls.slice(0, 2)).toEqual(["browser-integration", "audio"]);
	});

	it("continues without bootstrapping private Claude policy when declined", async () => {
		const calls = [];
		const prompts = [];
		const record = (name) => async () => calls.push(name);

		await configureUserApps(userAppDoubles({
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
		}));

		expect(
			prompts.filter(
				({ message, initial }) =>
					message === "Bootstrap private Claude policy repository?" && initial,
			),
		).toHaveLength(1);
		expect(calls.filter((call) => call === "bootstrap")).toHaveLength(0);
		expect(calls).toContain("agent-os");
	});

	it("defaults remote-control services off and does nothing when declined", async () => {
		const calls = [];
		const prompts = [];
		const record = (name) => async () => calls.push(name);

		await configureUserApps(userAppDoubles({
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
			configureClaudeStayAwakeImpl: record("stay-awake"),
			configureClaudeRemoteControlImpl: record("remote-control"),
			configurePrWatchImpl: record("pr-watch"),
			configureCodexImpl: record("codex"),
			configureAgentOsImpl: record("agent-os"),
		}));

		expect({
			prompt: prompts.find(({ message }) =>
				message.includes("Claude Remote Control"),
			),
			remoteCalls: calls.filter((call) => call === "remote-control"),
		}).toEqual({
			prompt: {
				message:
					"Install Claude Remote Control services with all permission checks bypassed? This permanently sets bypassPermissionsModeAccepted: true in ~/.claude.json for every Claude Code session on this machine, not only these services. To undo it, edit ~/.claude.json and remove the flag or set it to false.",
				initial: false,
			},
			remoteCalls: [],
		});
	});

	it("bootstraps private Claude policy after the public baseline", async () => {
		const calls = [];
		const prompts = [];
		const bootstrapCalls = [];
		const record = (name) => async () => calls.push(name);

		await configureUserApps(userAppDoubles({
			promptUserImpl: async (message, initial) => {
				prompts.push({ message, initial });
				return message === "Bootstrap private Claude policy repository?";
			},
			configureBrowserIntegrationImpl: record("browser-integration"),
			configureAudioImpl: record("audio"),
			configureBashImpl: () => calls.push("bash"),
			configureFastfetchImpl: record("fastfetch"),
			runCommandImpl: record("uosc"),
			enableServicesImpl: record("services"),
			configureClaudeImpl: record("claude"),
			bootstrapClaudePolicyImpl: async (options) => {
				calls.push("bootstrap");
				bootstrapCalls.push(options);
				return true;
			},
			configureClaudeStayAwakeImpl: record("stay-awake"),
			configurePrWatchImpl: record("pr-watch"),
			configureCodexImpl: record("codex"),
			configureAgentOsImpl: record("agent-os"),
		}));

		expect(calls.indexOf("bootstrap")).toBe(calls.indexOf("claude") + 1);
		expect(
			prompts.filter(
				({ message, initial }) =>
					message === "Bootstrap private Claude policy repository?" && initial,
			),
		).toHaveLength(1);
		expect(bootstrapCalls).toEqual([{ strict: false }]);
		expect(calls).toContain("agent-os");
	});

	it("warns with a retry command and continues when policy bootstrap fails", async () => {
		const calls = [];
		const warnings = [];
		const bootstrapCalls = [];
		const record = (name) => async () => calls.push(name);
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);

		try {
			await configureUserApps(userAppDoubles({
				promptUserImpl: async (message) =>
					message === "Bootstrap private Claude policy repository?",
				configureBrowserIntegrationImpl: record("browser-integration"),
				configureAudioImpl: record("audio"),
				configureBashImpl: () => calls.push("bash"),
				configureFastfetchImpl: record("fastfetch"),
				runCommandImpl: record("uosc"),
				enableServicesImpl: record("services"),
				configureClaudeImpl: record("claude"),
				bootstrapClaudePolicyImpl: async (options) => {
					bootstrapCalls.push(options);
					return false;
				},
				configureClaudeStayAwakeImpl: record("stay-awake"),
				configurePrWatchImpl: record("pr-watch"),
				configureCodexImpl: record("codex"),
				configureAgentOsImpl: record("agent-os"),
			}));
		} finally {
			log.warning = originalWarning;
		}

		expect(warnings.join("\n")).toContain("haoshoku --claude-bootstrap");
		expect(bootstrapCalls).toEqual([{ strict: false }]);
		expect(calls).toContain("agent-os");
	});
});
