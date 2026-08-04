import { describe, expect, it } from "bun:test";

import {
	configureBrowserIntegration,
	configureUserApps,
} from "../src/os_scripts/cachyos.js";

describe("CachyOS browser integration", () => {
	// Mutation caught: installing scripts or MIME defaults before the registry is
	// seeded exposes the default-browser handler to an unconfigured profile.
	it("seeds Chromium profiles before deploying MIME handlers and scripts", async () => {
		const calls = [];
		const record = (name) => async () => calls.push(name);

		await configureBrowserIntegration({
			configureChromiumProfilesImpl: record("profiles"),
			configureMimeappsImpl: record("mimeapps"),
			installUserScriptsImpl: record("scripts"),
		});

		expect(calls).toEqual(["profiles", "mimeapps", "scripts"]);
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
});
