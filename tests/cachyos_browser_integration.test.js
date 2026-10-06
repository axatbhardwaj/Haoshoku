import { describe, expect, it } from "bun:test";

import {
	configureBrowserIntegration,
	configureUserApps,
} from "../src/os_scripts/cachyos.js";

function userAppDoubles(overrides = {}) {
	return {
		configureBrowserIntegrationImpl: async () => {},
		configureAudioImpl: async () => {},
		configureBashImpl: () => {},
		configureFastfetchImpl: async () => {},
		configureGhosttyImpl: async () => {},
		runCommandImpl: async () => true,
		enableServicesImpl: async () => {},
		configureClaudeImpl: async () => {},
		installGhStackImpl: async () => {},
		configurePrWatchImpl: async () => {},
		configureCodexImpl: async () => {},
		syncAgentsConfigImpl: async () => {},
		configureAxstackImpl: async () => ({ ok: true }),
		configureSkillsImpl: async () => true,
		syncAgentSkillsImpl: async () => true,
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

		await configureUserApps(
			userAppDoubles({
				configureBrowserIntegrationImpl: record("browser-integration"),
				configureAudioImpl: record("audio"),
				configureBashImpl: () => calls.push("bash"),
				configureFastfetchImpl: record("fastfetch"),
				runCommandImpl: record("uosc"),
				enableServicesImpl: record("services"),
				configureClaudeImpl: record("claude"),
				configurePrWatchImpl: record("pr-watch"),
				configureCodexImpl: record("codex"),
				configureAxstackImpl: async () => ({ ok: true }),
				configureSkillsImpl: record("skills"),
			}),
		);

		expect(calls.slice(0, 2)).toEqual(["browser-integration", "audio"]);
	});
});
