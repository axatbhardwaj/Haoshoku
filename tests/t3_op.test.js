import { afterEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureTailscaleT3 } from "../src/helpers/configure_tailscale_t3.js";

const homes = [];
const secret = "fixture-op-secret";
const dropContent =
	"[Service]\nEnvironmentFile=-%h/.config/op/service-account.env\n";
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true });
});

function fixture() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "op-t3-"));
	homes.push(home);
	const envFile = path.join(home, ".config/op/service-account.env");
	const drop = path.join(
		home,
		".config/systemd/user/t3code.service.d/haoshoku-op.conf",
	);
	const commands = [],
		messages = [],
		writes = [];
	const options = {
		home,
		deviceType: "iobox",
		user: "fixture",
		env: {},
		fsImpl: {
			...fs,
			readdirSync: (dir) =>
				dir.startsWith(home) && fs.existsSync(dir) ? fs.readdirSync(dir) : [],
			statSync: (file) => {
				if (!file.startsWith(home))
					throw Object.assign(new Error("absent"), { code: "ENOENT" });
				return fs.statSync(file);
			},
			writeFileSync: (file, value) => {
				writes.push(file);
				fs.writeFileSync(file, value);
			},
		},
		captureCommandImpl: async (command) => {
			let stdout = "",
				exitCode = 0;
			if (command.includes("show t3code.service"))
				stdout = "LoadState=not-found\n";
			else if (command.includes("list-") || command.startsWith("ps "))
				stdout = "";
			else if (
				command === "command -v t3code t3code-nightly" ||
				command === "pacman -Q t3code-bin"
			)
				exitCode = 1;
			else if (command === "command -v t3") stdout = "/usr/bin/t3";
			else if (command === "t3 --version")
				stdout = "t3 v0.0.46-nightly.20261004.2644";
			else if (command === "tailscale status --json")
				stdout = '{"BackendState":"Running"}';
			else if (command === "tailscale debug prefs")
				stdout = '{"OperatorUser":"fixture"}';
			else if (command.startsWith("loginctl ")) stdout = "Linger=yes";
			else if (command.startsWith("systemctl show ")) stdout = "masked";
			else if (command === "tailscale serve status --json")
				stdout = JSON.stringify({
					TCP: { 443: { HTTPS: true } },
					Web: {
						"fixture.tail123.ts.net:443": {
							Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } },
						},
					},
				});
			else if (command.startsWith("ss "))
				stdout = "LISTEN 0 128 127.0.0.1:3773 *:*";
			else if (
				!command.includes("is-active") &&
				!command.includes("is-enabled") &&
				!command.startsWith("pacman -Q ")
			)
				throw new Error(`Unexpected probe: ${command}`);
			return { stdout, exitCode };
		},
		runCommandImpl: async (command) => {
			commands.push(command);
			return true;
		},
		fetchImpl: async () => new Response("ready"),
		sleepImpl: async () => {},
		maxReadinessAttempts: 1,
		logger: Object.fromEntries(
			["info", "warning", "success"].map((level) => [
				level,
				(message) => messages.push(message),
			]),
		),
	};
	const token = (value = `OP_SERVICE_ACCOUNT_TOKEN=${secret}\n`) => {
		fs.mkdirSync(path.dirname(envFile), { recursive: true });
		fs.writeFileSync(envFile, value, { mode: 0o600 });
	};
	return {
		home,
		envFile,
		drop,
		commands,
		messages,
		writes,
		options,
		token,
		run: () => configureTailscaleT3(options),
	};
}

it.each([
	true,
	false,
])("activates a valid iobox token only once (newline=%s)", async (newline) => {
	const f = fixture();
	f.token(`OP_SERVICE_ACCOUNT_TOKEN=${secret}${newline ? "\n" : ""}`);
	expect(await f.run()).toBe(true);
	expect(fs.existsSync(f.drop)).toBe(true);
	expect(fs.readFileSync(f.drop, "utf8")).toBe(dropContent);
	expect(f.commands.slice(-2)).toEqual([
		"systemctl --user daemon-reload",
		"systemctl --user restart t3code",
	]);
	f.commands.length = f.writes.length = 0;
	// Token rotation leaves the drop-in alone and needs the operator restart.
	f.token(`OP_SERVICE_ACCOUNT_TOKEN=${secret}-rotated\n`);
	expect(await f.run()).toBe(true);
	expect(f.writes).toEqual([]);
	expect(f.commands).not.toContain("systemctl --user restart t3code");
	expect(f.messages.join(" ")).toContain("systemctl --user restart t3code");
	expect(f.messages.join(" ").includes(secret)).toBe(false);
});
