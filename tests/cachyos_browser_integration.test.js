import { describe, expect, it } from "bun:test";

import {
	configureBrowserIntegration,
	configureUserApps,
} from "../src/os_scripts/cachyos.js";

function userAppDoubles(overrides = {}) {
	return {
		promptUserImpl: async () => false,
		commandExistsImpl: async () => false,
		configureGitImpl: async () => {},
		configureBrowserIntegrationImpl: async () => {},
		configureAudioImpl: async () => {},
		configureBashImpl: () => {},
		configureFastfetchImpl: async () => {},
		configureGhosttyImpl: async () => {},
		runCommandImpl: async () => true,
		enableServicesImpl: async () => {},
		configureClaudeImpl: async () => {},
		installGhStackImpl: async () => {},
		configureCodexImpl: async () => {},
		syncAgentsConfigImpl: async () => {},
		configureAxstackImpl: async () => ({ ok: true }),
		configureAgentAccountsImpl: async () => true,
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
				promptUserImpl: async () => false,
				configureBrowserIntegrationImpl: record("browser-integration"),
				configureAudioImpl: record("audio"),
				configureBashImpl: () => calls.push("bash"),
				configureFastfetchImpl: record("fastfetch"),
				runCommandImpl: record("uosc"),
				enableServicesImpl: record("services"),
				configureClaudeImpl: record("claude"),
				configureCodexImpl: record("codex"),
				configureAxstackImpl: async () => ({ ok: true }),
			}),
		);

		expect(calls.slice(0, 2)).toEqual(["browser-integration", "audio"]);
	});
});

describe("device-aware user apps", () => {
	it.each([
		"iobox",
		"pc",
		"laptop",
	])("keeps agents and scripts while routing desktop work for %s", async (deviceType) => {
		const calls = [];
		const record = (name, result) => async () => {
			calls.push(name);
			return result;
		};
		// Exercise the default service helper with injected command and prompt dependencies.
		const result = await configureUserApps({
			isOmarchy: true,
			deviceType,
			configureGitImpl: record("git"),
			promptUserImpl: async (message) => {
				calls.push(message);
				return true;
			},
			commandExistsImpl: async () => false,
			enableServicesImpl: undefined,
			configureBrowserIntegrationImpl: (options) =>
				configureBrowserIntegration({
					...options,
					configureChromiumProfilesImpl: record("profiles"),
					installUserScriptsImpl: record("scripts"),
					configureMimeappsImpl: record("mimeapps"),
				}),
			configureAudioImpl: record("audio"),
			configureBashImpl: record("bash"),
			configureFastfetchImpl: record("fastfetch"),
			configureGhosttyImpl: record("ghostty"),
			runCommandImpl: record("command"),
			configureClaudeImpl: record("claude", { ok: true }),
			installGhStackImpl: record("gh-stack"),
			configureCodexImpl: record("codex", { ok: true }),
			syncAgentsConfigImpl: record("agents"),
			configureAxstackImpl: record("axstack", { ok: true }),
			configureAgentAccountsImpl: async () => true,
		});
		expect(result).toEqual({ claude: { ok: true }, codex: { ok: true } });
		expect(calls).toEqual([
			...(deviceType === "iobox"
				? ["scripts"]
				: ["profiles", "scripts", "mimeapps", "audio"]),
			"bash",
			"fastfetch",
			"ghostty",
			...(deviceType === "iobox"
				? []
				: ["command", "Enable Bluetooth?", "command"]),
			"claude",
			"gh-stack",
			"codex",
			"agents",
			"axstack",
		]);
	});
});
