import { afterEach, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const silentLogger = {
	error() {},
	info() {},
	success() {},
	warning() {},
};

export const listenerCommand = "ss -Hltn 'sport = :3773'";
export const floor = "0.1.0";
export const serveConfig = {
	TCP: { 443: { HTTPS: true } },
	Web: {
		"server.tail123.ts.net:443": {
			Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } },
		},
	},
};
const homes = [];
afterEach(() => {
	for (const home of homes.splice(0)) {
		fs.rmSync(home, { recursive: true });
	}
});

export function fixture({
	version = `t3 v${floor}\n`,
	installedVersion = `t3 v${floor}\n`,
	desired = false,
} = {}) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-t3-"));
	homes.push(home);
	const cli = path.join(home, ".local/bin/t3");
	const packageDir = path.join(home, ".local/lib/node_modules/t3");
	const seedCli = () => {
		fs.mkdirSync(path.join(packageDir, "bin"), { recursive: true });
		fs.mkdirSync(path.dirname(cli), { recursive: true });
		fs.writeFileSync(path.join(packageDir, "bin/t3.js"), "fixture launcher");
		fs.writeFileSync(
			path.join(packageDir, "package.json"),
			JSON.stringify({ name: "t3", version: floor }),
		);
		if (!fs.existsSync(cli))
			fs.symlinkSync("../lib/node_modules/t3/bin/t3.js", cli);
	};
	if (version !== null) seedCli();
	const events = [];
	const errors = [];
	const overrides = new Map();
	const dropIns = path.join(home, ".config/systemd/user/t3code.service.d");
	const installedT3 = `'${home}/.local/bin/t3'`;
	const response = (stdout = "", exitCode = 0) => ({ stdout, exitCode });
	const options = {
		home,
		uid: 1000,
		latestStableImpl: async () => floor,
		user: "test",
		env: {},
		fsImpl: {
			...fs,
			statSync(file, ...args) {
				if (file.startsWith("/usr/") || file.startsWith("/opt/"))
					throw Object.assign(new Error("absent fixture"), { code: "ENOENT" });
				return fs.statSync(file, ...args);
			},
			readdirSync(directory, ...args) {
				if (directory === "/usr/share/applications") return [];
				return fs.readdirSync(directory, ...args);
			},
		},
		ensureNodeImpl: async () => {
			events.push("node");
			return true;
		},
		captureCommandImpl: async (command) => {
			events.push(command);
			if (overrides.has(command)) {
				const value = overrides.get(command);
				if (value instanceof Error) throw value;
				return typeof value === "function" ? value() : value;
			}
			if (command.startsWith("systemctl --user show "))
				return response("LoadState=not-found\nEnvironment=\n");
			if (
				command.startsWith("systemctl --user list-") ||
				command === "ps -eo pid=,comm=,args="
			)
				return response();
			if (command === "command -v t3code t3code-nightly")
				return response("", 1);
			if (command === listenerCommand)
				return response("LISTEN 0 128 127.0.0.1:3773 0.0.0.0:*");
			if (command === "tailscale status") return response("logged in");
			if (command === "tailscale debug prefs")
				return response('{"OperatorUser":"test"}');
			if (command === "command -v t3")
				return response(version === null ? "" : cli, version === null ? 1 : 0);
			if (command === "t3 --version")
				return response(version ?? "", version === null ? 127 : 0);
			if (command === `${installedT3} --version`)
				return response(installedVersion);
			if (command.endsWith("connect status --json"))
				return response(JSON.stringify({ desired }));
			if (command === "tailscale serve status --json")
				return response(JSON.stringify(serveConfig));
			throw new Error(`Unexpected probe: ${command}`);
		},
		runCommandImpl: async (command) => {
			events.push(command);
			if (command.startsWith("npm --global")) seedCli();
			if (command.endsWith("connect unlink")) desired = false;
			if (command.includes(" service install")) {
				expect(
					fs.readFileSync(path.join(dropIns, "axstack-path.conf"), "utf8"),
				).toBe(
					'[Service]\nEnvironment="PATH=%h/.local/bin:%h/.bun/bin:%h/.grok/bin:/usr/local/bin:/usr/bin:/bin"\n',
				);
				expect(
					fs.readFileSync(path.join(dropIns, "axstack-tailscale.conf"), "utf8"),
				).toBe("[Service]\nEnvironment=T3CODE_TAILSCALE_SERVE=true\n");
				const sandbox = path.join(dropIns, "axstack-sandbox.conf");
				expect(fs.existsSync(sandbox)).toBe(options.uid === 0);
				if (options.uid === 0) {
					expect(fs.readFileSync(sandbox, "utf8")).toBe(
						"[Service]\nEnvironment=IS_SANDBOX=1\n",
					);
				}
			}
			return overrides.get(command) ?? true;
		},
		fetchImpl: async (url, init) => {
			events.push(url);
			expect(init.signal).toBeInstanceOf(AbortSignal);
			expect(init.redirect).toBe("error");
			return new Response("T3 ready");
		},
		sleepImpl: async (ms) => events.push(`sleep ${ms}`),
		maxReadinessAttempts: 2,
		logger: { ...silentLogger, error: (message) => errors.push(message) },
	};
	return {
		home,
		dropIns,
		installedT3,
		options,
		events,
		errors,
		overrides,
		response,
	};
}
