import { expect } from "bun:test";
export const dropIn =
	"/home/test/.config/systemd/user/t3code.service.d/axstack-tailscale.conf";
export const content = '[Service]\nEnvironment="T3CODE_TAILSCALE_SERVE=true"\n';
export const pathDropIn =
	"/home/test/.config/systemd/user/t3code.service.d/axstack-path.conf";
export const pathContent =
	'[Service]\nEnvironment="PATH=%h/.local/bin:%h/.bun/bin:%h/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin"\n';
export const sleepTargets = [
	"sleep.target",
	"suspend.target",
	"hibernate.target",
	"hybrid-sleep.target",
	"suspend-then-hibernate.target",
];
export const maskProbe = (target) =>
	`systemctl show ${target} --property=UnitFileState --value`;
export const listenerCommand = "ss -Hltn 'sport = :3773'";
export const url = "https://laptop.tail123.ts.net";
export const serve = {
	TCP: { 443: { HTTPS: true } },
	Web: {
		"laptop.tail123.ts.net:443": {
			Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } },
		},
	},
};

export function fixture({ fresh = false, loggedOut = fresh } = {}) {
	let serviceActive = !fresh;
	let operator = fresh ? "" : "test";
	const events = [];
	const warnings = [];
	const messages = [];
	const files = new Map(
		fresh
			? []
			: [
					[dropIn, content],
					[
						"/home/test/.t3/runtime/service-state.json",
						'{"protocol":3,"activeVersion":"0.1.0"}',
					],
					[pathDropIn, pathContent],
					[
						"/home/test/.config/systemd/user/t3code.service",
						"[Service]\nEnvironment=T3CODE_HOME=/home/test/.t3\n",
					],
				],
	);
	const masks = new Map(sleepTargets.map((target) => [target, "masked"]));
	const mutations = [];
	const overrides = new Map();
	const options = {
		latestStableImpl: async () => "0.1.0",
		home: "/home/test",
		hostname: "fixture",
		user: "test",
		deviceType: "pc",
		env: {},
		fsImpl: {
			lstatSync(file) { if (files.get(file)?.startsWith("symlink:")) return { isSymbolicLink: () => true }; throw Object.assign(new Error("absent fixture alias"), { code: "ENOENT" }); },
			readlinkSync: (file) => files.get(file)?.slice("symlink:".length),
			realpathSync: () => "/home/test/.local/lib/node_modules/t3/bin/t3.js",
			existsSync: (file) => files.has(file),
			readdirSync: () => [],
			statSync: () => {
				throw Object.assign(new Error("absent fixture"), { code: "ENOENT" });
			},
			readFileSync: (file) => {
				if (!files.has(file))
					throw Object.assign(new Error("missing"), { code: "ENOENT" });
				return files.get(file);
			},
			mkdirSync: (file) => mutations.push(`mkdir ${file}`),
			writeFileSync: (file, value) => {
				mutations.push(`write ${file}`);
				files.set(file, value);
			},
		},
		captureCommandImpl: async (command) => {
			events.push(command);
			if (overrides.has(command)) {
				const value = overrides.get(command);
				if (value instanceof Error) throw value;
				return value;
			}
			let stdout = "";
			let exitCode = 0;
			if (command === "node --version") stdout = "v24.10.0";
			else if (command === "command -v node") stdout = "/usr/bin/node";
			else if (command === "npm --version") stdout = "10.9.3";
			else if (command.startsWith("systemctl --user show "))
				stdout = fresh
					? "LoadState=not-found\nEnvironment=\n"
					: "LoadState=loaded\nExecStart={ path=/home/test/.t3/runtime/versions/1/t3 ; argv[]=/home/test/.t3/runtime/versions/1/t3 __service-launcher ; }\nEnvironment=T3CODE_HOME=/home/test/.t3\n";
			else if (
				command.startsWith("systemctl --user list-") ||
				command === "ps -eo pid=,comm=,args="
			)
				stdout = "";
			else if (command === "command -v t3code t3code-nightly") exitCode = 1;
			else if (command.startsWith("systemctl show "))
				stdout = masks.get(command.split(" ")[2]);
			else if (command.startsWith("loginctl show-user ")) stdout = "Linger=yes";
			else if (command === listenerCommand)
				stdout = "LISTEN 0 128 127.0.0.1:3773 0.0.0.0:*";
			else if (command === "command -v t3") stdout = "/usr/bin/t3";
			else if (command.startsWith("pacman -Qqo ")) stdout = "t3code-bin";
			else if (command === "/usr/bin/t3 --version") stdout = "t3 v0.1.0";
			else if (command === "pacman -Q t3code-bin") exitCode = 1;
			else if (command === "pacman -Q t3code-nightly-bin")
				stdout = "t3code-nightly-bin 0.0.46";
			else if (command === "pacman -Q tailscale") exitCode = fresh ? 1 : 0;
			else if (command.includes("--user is-active"))
				exitCode = serviceActive ? 0 : 1;
			else if (command.includes("is-enabled") || command.includes("is-active"))
				exitCode = fresh ? 1 : 0;
			else if (command === "tailscale status --json")
				stdout = JSON.stringify({
					BackendState: loggedOut ? "NeedsLogin" : "Running",
				});
			else if (command === "tailscale debug prefs")
				stdout = JSON.stringify({ OperatorUser: operator });
			else if (command === "t3 --version") stdout = "t3 v0.1.0";
			else if (command === "tailscale serve status --json")
				stdout = JSON.stringify(serve);
			else throw new Error(`Unexpected probe: ${command}`);
			return { stdout, exitCode };
		},
		runCommandImpl: async (command, init) => {
			events.push(command);
			mutations.push(command);
			if (command.startsWith("sudo -n tailscale set --operator=")) {
				operator = options.env.SUDO_USER || options.user;
				overrides.delete("tailscale debug prefs");
			}
			if (command.startsWith("sudo -n systemctl mask "))
				for (const target of command.split(" ").slice(4))
					masks.set(target, "masked");
			if (command.includes(" service install")) serviceActive = true;
			if (command === "sudo -n tailscale up") {
				expect(init).toMatchObject({ stdout: "inherit", stderr: "inherit" });
				loggedOut = false;
			}
			return true;
		},
		fetchImpl: async (target, init) => {
			events.push(target);
			expect(init.redirect).toBe("error");
			return new Response("ready");
		},
		sleepImpl: async () => {},
		maxReadinessAttempts: 1,
		logger: {
			warning: (message) => warnings.push(message),
			info: (message) => messages.push(message),
			success: (message) => messages.push(message),
		},
	};
	return {
		options,
		events,
		mutations,
		warnings,
		messages,
		files,
		overrides,
		masks,
	};
}

export function seedManagedNpm(f) {
	f.files.set("/home/test/.local/bin/t3", "symlink:../lib/node_modules/t3/bin/t3.js");
	f.files.set("/home/test/.local/lib/node_modules/t3/package.json", '{"name":"t3","version":"0.1.0","bin":{"t3":"bin/t3.js"}}');
}
