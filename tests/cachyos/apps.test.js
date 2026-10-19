import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { log } from "../../src/common/utils.js";
import { configureUserApps, ensureRustToolchain } from "../../src/os_scripts/cachyos.js";

describe("user app configuration", () => {
	it.each([
		"iobox",
		"pc",
		"laptop",
	])("creates alt accounts only for %s after agent setup", async (deviceType) => {
		const events = [];
		const noop = async () => {};
		await configureUserApps({
        syncWorktreeCleanupImpl: async () => {},
			deviceType,
			isOmarchy: true,
			commandExistsImpl: noop,
			promptUserImpl: noop,
			configureGitImpl: noop,
			configureBrowserIntegrationImpl: noop,
			configureAudioImpl: noop,
			configureBashImpl: noop,
			configureFastfetchImpl: noop,
			configureGhosttyImpl: noop,
			runCommandImpl: noop,
			enableServicesImpl: noop,
			configureClaudeImpl: async () => events.push("claude"),
			installGhStackImpl: noop,
			configureCodexImpl: async () => events.push("codex"),
			syncAgentsConfigImpl: async () => events.push("agents"),
			configureAxstackImpl: async () => ({ ok: true }),
			configureAgentAccountsImpl: async () => {
				events.push("accounts");
				return true;
			},
		});
		expect(events).toEqual([
			"claude",
			"codex",
			"agents",
			...(deviceType === "iobox" ? ["accounts"] : []),
		]);
	});

	it.each([
		false,
		"throws",
	])("reports incomplete iobox alt accounts (%s)", async (outcome) => {
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);
		const noop = async () => {};
		try {
			await configureUserApps({
        syncWorktreeCleanupImpl: async () => {},
				deviceType: "iobox",
				isOmarchy: true,
				commandExistsImpl: noop,
				promptUserImpl: noop,
				configureGitImpl: noop,
				configureBrowserIntegrationImpl: noop,
				configureAudioImpl: noop,
				configureBashImpl: noop,
				configureFastfetchImpl: noop,
				configureGhosttyImpl: noop,
				runCommandImpl: noop,
				enableServicesImpl: noop,
				configureClaudeImpl: noop,
				installGhStackImpl: noop,
				configureCodexImpl: noop,
				syncAgentsConfigImpl: noop,
				configureAxstackImpl: async () => ({ ok: true }),
				configureAgentAccountsImpl: async () => {
					if (outcome === "throws") throw new Error("fixture error");
					return false;
				},
			});
			expect(warnings.join(" ")).toContain("Agent accounts incomplete");
			expect(warnings.join(" ")).toContain("haoshoku --agent-accounts");
		} finally {
			log.warning = originalWarning;
		}
	});

	it("runs portable app setup without retired services or offers", async () => {
		const events = [];
		const prompts = [];
		const record = (name) => async () => events.push(name);

		await configureUserApps({
        syncWorktreeCleanupImpl: async () => {},
			promptUserImpl: async (message, initial) => {
				prompts.push({ message, initial });
				return true;
			},
			commandExistsImpl: async () => false,
			configureGitImpl: record("git"),
			configureBrowserIntegrationImpl: record("browser"),
			configureAudioImpl: record("audio"),
			configureBashImpl: record("bash"),
			configureFastfetchImpl: record("fastfetch"),
			configureGhosttyImpl: record("ghostty"),
			configureWarpImpl: async () => {
				throw new Error("Warp configuration must remain dormant");
			},
			runCommandImpl: record("uosc"),
			enableServicesImpl: record("services"),
			configureClaudeImpl: record("claude"),
			installGhStackImpl: record("gh-stack"),
			configureCodexImpl: record("codex"),
			syncAgentsConfigImpl: record("agents"),
			configureAgentAccountsImpl: async () => true,
			configureAxstackImpl: async () => {
				events.push("axstack");
				return { ok: true };
			},
		});

		expect(events).toEqual([
			"git",
			"browser",
			"audio",
			"bash",
			"fastfetch",
			"ghostty",
			"uosc",
			"services",
			"claude",
			"gh-stack",
			"codex",
			"agents",
			"axstack",
		]);
		expect(prompts).toEqual([{ message: "Configure git?", initial: true }]);
	});

	it("warns when Claude or Codex installation fails", async () => {
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);
		const noop = async () => {};

		try {
			await configureUserApps({
        syncWorktreeCleanupImpl: async () => {},
				promptUserImpl: async () => false,
				commandExistsImpl: async () => false,
				configureGitImpl: noop,
				configureBrowserIntegrationImpl: noop,
				configureAudioImpl: noop,
				configureBashImpl: noop,
				configureFastfetchImpl: noop,
				configureGhosttyImpl: noop,
				runCommandImpl: noop,
				enableServicesImpl: noop,
				configureClaudeImpl: async () => ({
					ok: false,
					reason: "install command failed",
				}),
				installGhStackImpl: noop,
				configureCodexImpl: async () => ({
					ok: false,
					reason: "registry unavailable",
				}),
				syncAgentsConfigImpl: noop,
				configureAgentAccountsImpl: noop,
				configureAxstackImpl: async () => ({ ok: true }),
			});

			expect(warnings).toContainEqual(
				expect.stringContaining(
					"Claude CLI installation failed: install command failed",
				),
			);
			expect(warnings).toContainEqual(
				expect.stringContaining(
					"Codex CLI installation failed: registry unavailable",
				),
			);
		} finally {
			log.warning = originalWarning;
		}
	});

	it("continues app setup when Codex rejects ambiguous config", async () => {
		const events = [];
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);
		const noop = async () => {};
		try {
			await configureUserApps({
        syncWorktreeCleanupImpl: async () => {},
				promptUserImpl: async () => false,
				commandExistsImpl: async () => false,
				configureGitImpl: noop,
				configureBrowserIntegrationImpl: noop,
				configureAudioImpl: noop,
				configureBashImpl: noop,
				configureFastfetchImpl: noop,
				configureGhosttyImpl: noop,
				runCommandImpl: noop,
				enableServicesImpl: noop,
				configureClaudeImpl: async () => ({ ok: true }),
				installGhStackImpl: noop,
				configureCodexImpl: async () => {
					throw new Error("Ambiguous multiline TOML");
				},
				syncAgentsConfigImpl: async () => events.push("agents"),
				configureAgentAccountsImpl: noop,
				configureAxstackImpl: async () => {
					events.push("axstack");
					return { ok: true };
				},
			});
			expect(events).toEqual(["agents", "axstack"]);
			expect(warnings).toContainEqual(
				expect.stringContaining("Ambiguous multiline TOML"),
			);
		} finally {
			log.warning = originalWarning;
		}
	});
});

describe("Rust toolchain preparation", () => {
	it("preserves Rust when rustc and cargo are already available", async () => {
		const commands = [];
		const result = await ensureRustToolchain({
			commandExistsImpl: async (command) =>
				command === "rustc" || command === "cargo",
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			withSpinnerImpl: async (_label, operation) => operation(),
		});

		expect(result).toBe(true);
		expect(commands).toEqual([]);
	});

	for (const { availableCommand, missingCommand } of [
		{ availableCommand: "rustc", missingCommand: "cargo" },
		{ availableCommand: "cargo", missingCommand: "rustc" },
	]) {
		it(`installs Rust when ${missingCommand} is missing`, async () => {
			const commands = [];
			const result = await ensureRustToolchain({
				commandExistsImpl: async (command) => command === availableCommand,
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
				withSpinnerImpl: async (_label, operation) => operation(),
			});

			expect(result).toBe(true);
			expect(commands).toEqual([
				"curl https://sh.rustup.rs -sSf | sh -s -- -y",
			]);
		});
	}

	it("reports failure when rustup fails", async () => {
		const result = await ensureRustToolchain({
			commandExistsImpl: async () => false,
			runCommandImpl: async () => false,
			withSpinnerImpl: async (_label, operation) => operation(),
		});

		expect(result).toBe(false);
	});
});

describe("Omarchy-owned defaults", () => {
	it("provisions both native desktop assistants", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);

		expect(packages).toContain("claude-desktop");
		expect(packages).toContain("openai-codex-desktop");
	});

	it("provisions Omakade from the application list", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);

		expect(packages).toContain("omakade");
	});

	it("keeps KDE, Fish, and appearance packages out of the application list", () => {
		const packages = fs.readFileSync(
			path.resolve(import.meta.dir, "..", "..", "common", "paru_applist.txt"),
			"utf8",
		);
		for (const removed of [
			"fish",
			"partitionmanager",
			"dolphin",
			"kvantum",
			"okular",
			"merkuro",
		]) {
			expect(packages.split(/\s+/)).not.toContain(removed);
		}
	});

	it("keeps Chromium installed and provisions Brave Origin", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);
		expect(packages).toContain("chromium");
		expect(packages).toContain("brave-origin-bin");
		for (const retired of [
			"brave-bin",
			"floorp-bin",
			"google-chrome",
			"thorium-browser-avx2-bin",
		]) {
			expect(packages).not.toContain(retired);
		}
	});

	it("keeps optional gaming packages behind the gaming prompt", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\s+/);
		expect(packages).not.toContain("protonup-rs-bin");
		expect(packages).not.toContain("steam-native-runtime");
	});

	it("does not manage Stremio and its retired Qt5 dependency chain", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);
		expect(packages).not.toContain("stremio");
	});
});

