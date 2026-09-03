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
		expect(help).toContain("arch, debian-server");
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
		]) {
			expect(source).toContain(`"${flag}"`);
		}
	});

	it("offers Matt Pocock skills without legacy orchestration modes", () => {
		const help = output(["--help"]);
		expect(help).toContain("Matt Pocock skills");
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
		expect(normalizedHelp).toContain("T3 Connect");
		const t3Option = normalizedHelp.slice(
			normalizedHelp.indexOf("--server-t3-code"),
			normalizedHelp.indexOf("--skills"),
		);
		expect(t3Option).not.toContain("Tailscale");
	});

	it("documents T3 Connect instead of mandatory Tailscale server access", () => {
		const readme = fs.readFileSync(README, "utf8");
		expect(readme).toContain("npx --yes t3@latest connect link --headless");
		expect(readme).not.toContain("It also installs Tailscale when needed");
		expect(readme).not.toContain("pair --tailscale");
	});
});
