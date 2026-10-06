import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "..", "haoshoku.js");
const README = path.resolve(import.meta.dir, "..", "README.md");

function output(args) {
	const result = Bun.spawnSync([process.execPath, CLI, ...args], {
		stderr: "pipe",
		stdout: "pipe",
	});
	return `${new TextDecoder().decode(result.stdout)}\n${new TextDecoder().decode(result.stderr)}`;
}

describe("haoshoku CLI help", () => {
	it("documents Arch/Omarchy as the desktop target", () => {
		const help = output(["--help"]);
		// Normalize whitespace: commander rewraps descriptions to the longest
		// flag term, so longer flags can split "(arch, debian-server)".
		expect(help.replace(/\s+/g, " ")).toContain("arch, debian-server");
		expect(help).toContain("Arch / Omarchy");
	});

	it("does not expose retired desktop and appearance modes", () => {
		const help = output(["--help"]);
		for (const flag of [
			"--plasma",
			"--activities",
			"--kde-theme",
			"--kde-glass",
			"--caelestia-prefs",
			"--sddm-posthook",
			"--lockfix",
			"--zed-theme",
		]) {
			expect(help).not.toContain(flag);
		}
	});

	it("retains portable one-shot configuration modes", () => {
		const source = fs.readFileSync(CLI, "utf8");
		for (const flag of [
			"--claude",
			"--codex",
			"--audio",
			"--mimeapps",
			"--omarchy-appearance",
			"--discord-theme",
		]) {
			expect(source).toContain(`"${flag}"`);
		}
	});

	it("offers Matt Pocock skills without legacy orchestration modes", () => {
		const help = output(["--help"]).replace(/\s+/g, " ");
		expect(help).toContain(
			"Install Matt Pocock skills for Claude Code and Codex",
		);
		expect(help).toContain("Refresh Matt Pocock skills");
		expect(help).toContain("--agent-skills");
		expect(help).not.toContain("--agent-skills-backup");
		expect(help).not.toContain("--paseo-profiles");
		expect(help).not.toContain("--paseo-profiles-backup");
		for (const flag of ["--superpowers", "--agent-os", "--claude-bootstrap"]) {
			expect(help).not.toContain(flag);
		}
	});

	it("documents the Debian-only T3 Code server mode", () => {
		const help = output(["--help"]);
		const normalizedHelp = help.replace(/\s+/g, " ");
		expect(help).toContain("--server-t3-code");
		expect(help).toContain("Debian");
		expect(help).toContain("headless");
		expect(normalizedHelp).toContain("Tailscale");
		expect(normalizedHelp).toContain("Grok CLI on PATH");
		expect(normalizedHelp).not.toContain("T3 Connect");
	});

	it("documents the native headless Paseo server mode", () => {
		const help = output(["--help"]);
		const normalizedHelp = help.replace(/\s+/g, " ");

		expect(help).toContain("--server-paseo");
		expect(normalizedHelp).toContain("native Paseo headless service on Debian");
	});

	it("documents the Debian-only Hermes relay mode", () => {
		const help = output(["--help"]).replace(/\s+/g, " ");

		expect(help).toContain("--server-hermes-relay");
		expect(help).toContain("Hermes relay transport on Debian");
	});

	it("documents Tailscale prerequisites and pairing for the required T3 server", () => {
		const readme = fs.readFileSync(README, "utf8");
		expect(readme).toContain("t3 pair --tailscale");
		expect(readme).toContain("tailscale status");
		expect(readme).toContain("HTTPS certificates");
		expect(readme).toContain("tailscale set --operator=$USER");
		expect(readme).toContain("t3@nightly");
		expect(readme).toContain("0.0.46-nightly.20261003.2610");
		expect(readme).toContain("T3 Code is required");
		expect(readme).toContain(
			"PATH=%h/.local/bin:%h/.bun/bin:%h/.grok/bin:/usr/local/bin:/usr/bin:/bin",
		);
		expect(readme).not.toContain("connect link --headless");
		expect(readme).not.toContain("tailscale serve --https=443 off");
		expect(readme).not.toContain("optional T3 Code");
	});
});
