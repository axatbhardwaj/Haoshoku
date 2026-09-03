import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	buildSshConfigBlock,
	buildSshdDropIn,
	configureSshd,
	countAuthorizedKeys,
	mergeAuthorizedKeys,
	publicSshRuleRemovable,
	replaceManagedBlock,
} from "../src/helpers/configure_sshd.js";

const KEY_A =
	"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAa pc";
const KEY_B =
	"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBb phone";
const RUNNING = JSON.stringify({
	BackendState: "Running",
	Self: { DNSName: "vps.t.ts.net." },
});
const NEEDS_LOGIN = JSON.stringify({ BackendState: "NeedsLogin" });

let home;
let projectRoot;

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-sshd-home-"));
	projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-sshd-root-"));
	fs.mkdirSync(path.join(projectRoot, "configs", "ssh"), { recursive: true });
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
	fs.rmSync(projectRoot, { recursive: true, force: true });
});

function repoKeys(content) {
	fs.writeFileSync(
		path.join(projectRoot, "configs", "ssh", "authorized_keys"),
		content,
	);
}

function harness({
	osId = "debian-server",
	ufw = true,
	status = RUNNING,
	runResult = () => true,
	answer = true,
} = {}) {
	const commands = [];
	const prompts = [];
	const messages = { info: [], warning: [], success: [] };
	return {
		commands,
		prompts,
		messages,
		opts: {
			osId,
			home,
			projectRoot,
			userName: "xzat",
			hostName: "box",
			stagingDir: home,
			commandExistsImpl: async (c) => (c === "ufw" ? ufw : true),
			run: async (command) => {
				commands.push(command);
				if (command.startsWith("ssh-keygen")) {
					const keyPath = command.match(/-f (\S+)/)[1];
					fs.writeFileSync(keyPath, "private");
					fs.writeFileSync(`${keyPath}.pub`, `${KEY_A}\n`);
				}
				return runResult(command);
			},
			capture: async () => ({
				exitCode: 0,
				stdout: status,
				stderr: "",
				failed: false,
			}),
			prompt: async (message) => {
				prompts.push(message);
				return answer;
			},
			logImpl: {
				info: (m) => messages.info.push(m),
				warning: (m) => messages.warning.push(m),
				success: (m) => messages.success.push(m),
				dim() {},
				error() {},
			},
		},
	};
}

const read = (...p) => fs.readFileSync(path.join(home, ".ssh", ...p), "utf8");

describe("pure helpers", () => {
	it("drop-in disables password and keyboard-interactive auth", () => {
		const dropIn = buildSshdDropIn();
		expect(dropIn).toContain("PasswordAuthentication no");
		expect(dropIn).toContain("KbdInteractiveAuthentication no");
		expect(dropIn).toContain("PubkeyAuthentication yes");
	});

	it("merges keys as a union, keeping existing lines and skipping comments", () => {
		const merged = mergeAuthorizedKeys(
			`${KEY_A}\n`,
			`# header\n${KEY_A} renamed\n${KEY_B}\n`,
		);
		expect(merged).toBe(`${KEY_A}\n${KEY_B}\n`);
		expect(countAuthorizedKeys(merged)).toBe(2);
		expect(mergeAuthorizedKeys("", "# only comments\n")).toBe("");
	});

	it("ssh config block lists mesh hosts and forwards the agent only to vps", () => {
		const block = buildSshConfigBlock();
		expect(block).toContain("Host pc laptop vps");
		expect(block).toMatch(/Host pc\n\s+User xzat/);
		expect(block).toMatch(/Host laptop\n\s+User xzat/);
		expect(block).toMatch(/Host vps\n\s+User root\n\s+ForwardAgent yes/);
		expect(block.match(/ForwardAgent/g).length).toBe(1);
	});

	it("replaces the managed block idempotently and keeps user content", () => {
		const block = buildSshConfigBlock();
		const once = replaceManagedBlock("Host work\n    User me\n", block);
		const twice = replaceManagedBlock(
			`${once}Host after\n    Port 2222\n`,
			buildSshConfigBlock({ users: { pc: "new", laptop: "new", vps: "new" } }),
		);
		expect(once.startsWith("Host work\n    User me\n")).toBe(true);
		expect(twice).toContain("Host work");
		expect(twice).toContain("Host after");
		expect(twice).toContain("User new");
		expect(twice).not.toContain("User xzat");
		expect(twice.split("haoshoku mesh >>>").length).toBe(2);
	});

	it("lockout gate needs Running tailscale and at least one key", () => {
		expect(
			publicSshRuleRemovable({ tailscaleRunning: true, authorizedKeyCount: 1 }),
		).toBe(true);
		expect(
			publicSshRuleRemovable({
				tailscaleRunning: false,
				authorizedKeyCount: 1,
			}),
		).toBe(false);
		expect(
			publicSshRuleRemovable({ tailscaleRunning: true, authorizedKeyCount: 0 }),
		).toBe(false);
	});
});

describe("configureSshd", () => {
	it("refuses unknown OS ids", async () => {
		const h = harness({ osId: "gentoo" });
		expect(await configureSshd(h.opts)).toBe(false);
		expect(h.commands).toEqual([]);
	});

	it("generates a key only when missing and prints the public key", async () => {
		repoKeys(`${KEY_B}\n`);
		const h = harness();
		await configureSshd(h.opts);
		expect(h.commands.filter((c) => c.startsWith("ssh-keygen")).length).toBe(1);
		expect(
			h.messages.info.some((m) => m.includes(KEY_A) && m.includes("1Password")),
		).toBe(true);

		const again = harness();
		await configureSshd(again.opts);
		expect(again.commands.some((c) => c.startsWith("ssh-keygen"))).toBe(false);
	});

	it("merges repo keys into authorized_keys and writes the mesh ssh config", async () => {
		fs.mkdirSync(path.join(home, ".ssh"));
		fs.writeFileSync(
			path.join(home, ".ssh", "authorized_keys"),
			`${KEY_A} old\n`,
		);
		repoKeys(`${KEY_A}\n${KEY_B}\n`);
		await configureSshd(harness().opts);
		expect(read("authorized_keys")).toBe(`${KEY_A} old\n${KEY_B}\n`);
		expect(read("config")).toContain("Host pc laptop vps");
	});

	it("leaves password auth and the public rule alone when no keys exist", async () => {
		repoKeys("# nothing yet\n");
		fs.mkdirSync(path.join(home, ".ssh"));
		fs.writeFileSync(path.join(home, ".ssh", "id_ed25519"), "x");
		const h = harness();
		expect(await configureSshd(h.opts)).toBe(true);
		expect(h.commands.some((c) => c.includes("50-haoshoku.conf"))).toBe(false);
		expect(h.commands.some((c) => c.includes("ufw"))).toBe(false);
		expect(h.messages.warning[0]).toContain("No authorized keys");
	});

	it("applies the drop-in, restarts the Debian ssh unit, and removes the public rule after confirmation", async () => {
		repoKeys(`${KEY_B}\n`);
		const h = harness();
		expect(await configureSshd(h.opts)).toBe(true);
		expect(h.commands).toContain("sudo systemctl enable --now ssh");
		expect(
			h.commands.some(
				(c) =>
					c.startsWith("sudo mv") &&
					c.endsWith("/etc/ssh/sshd_config.d/50-haoshoku.conf"),
			),
		).toBe(true);
		expect(h.commands).toContain("sudo systemctl restart ssh");
		expect(h.commands).toContain(
			"sudo ufw allow in on tailscale0 to any port 22 proto tcp",
		);
		expect(h.prompts.length).toBe(1);
		expect(h.commands.at(-1)).toBe("sudo ufw delete allow ssh");
	});

	it("keeps the public rule when tailscale is not Running, or the user declines", async () => {
		repoKeys(`${KEY_B}\n`);
		const down = harness({ status: NEEDS_LOGIN });
		await configureSshd(down.opts);
		expect(down.prompts.length).toBe(0);
		expect(down.commands).not.toContain("sudo ufw delete allow ssh");

		const declined = harness({ answer: false });
		await configureSshd(declined.opts);
		expect(declined.prompts.length).toBe(1);
		expect(declined.commands).not.toContain("sudo ufw delete allow ssh");
	});

	it("on Arch uses the sshd unit, adds the tailnet rule, and never touches the public rule", async () => {
		repoKeys(`${KEY_B}\n`);
		const h = harness({ osId: "arch" });
		expect(await configureSshd(h.opts)).toBe(true);
		expect(h.commands).toContain("sudo systemctl enable --now sshd");
		expect(h.commands).toContain(
			"sudo ufw allow in on tailscale0 to any port 22 proto tcp",
		);
		expect(h.commands).not.toContain("sudo ufw delete allow ssh");
		expect(h.prompts.length).toBe(0);
	});

	it("skips firewall rules when ufw is absent", async () => {
		repoKeys(`${KEY_B}\n`);
		const h = harness({ ufw: false });
		expect(await configureSshd(h.opts)).toBe(true);
		expect(h.commands.some((c) => c.includes("ufw"))).toBe(false);
	});

	it("returns false when the drop-in cannot be applied", async () => {
		repoKeys(`${KEY_B}\n`);
		const h = harness({ runResult: (c) => !c.startsWith("sudo mv") });
		expect(await configureSshd(h.opts)).toBe(false);
		expect(h.commands.some((c) => c.includes("ufw"))).toBe(false);
	});
});
