import { describe, expect, it } from "bun:test";

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
});
