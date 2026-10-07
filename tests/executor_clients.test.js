import { expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve(import.meta.dir, "..", "haoshoku.js");
const endpoint = "https://executor.example.test:8444/mcp";
const auth = `Bearer ${Buffer.from("disposable auth fixture").toString("hex")}`;
function fixture() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "executor-clients-"));
	return {
		home,
		claude: path.join(home, ".claude.json"),
		codex: path.join(home, ".codex/config.toml"),
		env: {
			...process.env,
			HOME: home,
			CODEX_HOME: "",
			CLAUDE_CONFIG_DIR: undefined,
			XDG_CONFIG_HOME: path.join(home, "config"),
			XDG_STATE_HOME: path.join(home, "state"),
			EXECUTOR_AUTHORIZATION: auth,
		},
	};
}
function run(f, args = ["--executor-clients", endpoint]) {
	const child = Bun.spawnSync([process.execPath, cli, ...args], { env: f.env });
	return {
		code: child.exitCode,
		output: child.stdout.toString() + child.stderr.toString(),
	};
}
function seed(file, bytes) {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	fs.writeFileSync(file, bytes, { mode: 0o600 });
}

it("advertises explicit Claude/Codex client setup", () => {
	const result = run(fixture(), ["--help"]);
	expect(result.code).toBe(0);
	expect(result.output).toContain("--executor-clients <https-endpoint>");
});
it("writes both documented HTTP env-reference entries for an ordinary user", () => {
	const f = fixture();
	const result = run(f);
	expect(result.code).toBe(0);
	const claude = JSON.parse(fs.readFileSync(f.claude, "utf8"));
	const codex = Bun.TOML.parse(fs.readFileSync(f.codex, "utf8"));
	expect(claude.mcpServers.executor).toEqual({
		type: "http",
		url: endpoint,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Assert the serialized reference, not a resolved secret.
		headers: { Authorization: "${EXECUTOR_AUTHORIZATION}" },
	});
	expect(codex.mcp_servers.executor).toEqual({
		url: endpoint,
		env_http_headers: { Authorization: "EXECUTOR_AUTHORIZATION" },
	});
	expect(fs.statSync(f.claude).mode & 0o777).toBe(0o600);
	expect(fs.statSync(f.codex).mode & 0o777).toBe(0o600);
	expect(result.output).toContain("Configuration written");
	expect(result.output).toContain("not verified");
	for (const file of [f.claude, f.codex])
		expect(fs.readFileSync(file, "utf8").includes(auth)).toBe(false);
	expect(result.output.includes(auth)).toBe(false);
});

it("preserves unrelated JSON bytes and TOML comments/settings, then reruns without writes", () => {
	const f = fixture();
	const opaque = Buffer.from("existing inline fixture credential").toString(
		"hex",
	);
	const json = ` { "settings" : {"auth":"${opaque}", "nested":[1,{"keep":true}]}, "mcpServers" : {"other":{"type":"http","url":"https://other.invalid","headers":{"X-Key":"${opaque}"}}} }\n`;
	const toml = `# keep this exact comment\nmodel = "fixture"\n[mcp_servers.other]\nurl = "https://other.invalid"\nhttp_headers = { "X-Key" = "${opaque}" } # opaque\n`;
	seed(f.claude, json);
	seed(f.codex, toml);
	expect(run(f).code).toBe(0);
	const afterJSON = fs.readFileSync(f.claude, "utf8");
	const afterTOML = fs.readFileSync(f.codex, "utf8");
	expect(afterJSON.includes(json.slice(0, json.indexOf("} }\n")))).toBe(true);
	expect(afterTOML.startsWith(toml)).toBe(true);
	expect(JSON.parse(afterJSON).settings.auth === opaque).toBe(true);
	expect(
		Bun.TOML.parse(afterTOML).mcp_servers.other.http_headers["X-Key"] ===
			opaque,
	).toBe(true);
	const stats = [f.claude, f.codex].map((file) => fs.statSync(file));
	const result = run(f);
	expect(result.code).toBe(0);
	expect(result.output).toContain("already matches");
	for (const [i, file] of [f.claude, f.codex].entries()) {
		expect(fs.readFileSync(file, "utf8") === [afterJSON, afterTOML][i]).toBe(
			true,
		);
		expect(fs.statSync(file).mtimeMs).toBe(stats[i].mtimeMs);
		expect(fs.statSync(file).ino).toBe(stats[i].ino);
	}
	const files = fs
		.readdirSync(f.home, { recursive: true })
		.map((rel) => path.join(f.home, rel))
		.filter((file) => fs.lstatSync(file).isFile());
	for (const file of files) {
		const bytes = fs.readFileSync(file, "utf8");
		expect(bytes.includes(auth)).toBe(false);
		if (![f.claude, f.codex].includes(file))
			expect(bytes.includes(opaque)).toBe(false);
	}
	expect(result.output.includes(opaque)).toBe(false);
	expect(files.some((file) => /backup|\.bak|\.tmp/.test(file))).toBe(false);
});
it("uses custom config homes rather than XDG or default locations", () => {
	const f = fixture();
	f.env.CLAUDE_CONFIG_DIR = path.join(f.home, "custom-claude");
	f.env.CODEX_HOME = path.join(f.home, "custom-codex");
	expect(run(f).code).toBe(0);
	expect(
		fs.existsSync(path.join(f.env.CLAUDE_CONFIG_DIR, ".claude.json")),
	).toBe(true);
	expect(fs.existsSync(path.join(f.env.CODEX_HOME, "config.toml"))).toBe(true);
	expect(fs.existsSync(f.claude)).toBe(false);
	expect(fs.existsSync(f.codex)).toBe(false);
});
it.each([
	"claude",
	"codex",
])("refuses a conflicting %s executor without writing either config", (client) => {
	const f = fixture();
	const json =
		client === "claude"
			? '{"mcpServers":{"executor":{"type":"http","url":"https://other.invalid","headers":{"Authorization":"inline-fixture"}}}}'
			: '{"keep":true}';
	const toml =
		client === "codex"
			? '[mcp_servers.executor]\nurl="https://other.invalid"\n'
			: "# keep\n";
	seed(f.claude, json);
	seed(f.codex, toml);
	const result = run(f);
	expect(result.code).toBe(1);
	expect(result.output).toContain("executor entry conflicts");
	expect(result.output).toContain("reconcile it manually");
	expect(fs.readFileSync(f.claude, "utf8") === json).toBe(true);
	expect(fs.readFileSync(f.codex, "utf8") === toml).toBe(true);
	expect(result.output.includes("inline-fixture")).toBe(false);
});
it.each([
	["claude", "{bad"],
	["claude", "[]"],
	["claude", '{"mcpServers":null}'],
	["claude", '{"mcpServers":{},"mcpServers":{}}'],
	["claude", '{"keep":{"x":1,"x":2}}'],
	["codex", "[broken"],
	["codex", "mcp_servers=[]"],
	["codex", 'model="a"\nmodel="b"'],
])("refuses malformed/unsupported %s config without any mutation", (client, bytes) => {
	const f = fixture();
	seed(f[client], bytes);
	const result = run(f);
	expect(result.code).toBe(1);
	expect(result.output).toContain("config is malformed or unsupported");
	expect(fs.readFileSync(f[client], "utf8") === bytes).toBe(true);
	expect(fs.existsSync(f[client === "claude" ? "codex" : "claude"])).toBe(
		false,
	);
});
it.each([
	"claude",
	"codex",
])("refuses symlinked %s files and preserves the other config", (client) => {
	const f = fixture();
	const target = path.join(f.home, "original");
	seed(target, "opaque fixture");
	fs.mkdirSync(path.dirname(f[client]), { recursive: true });
	fs.symlinkSync(target, f[client]);
	const result = run(f);
	expect(result.code).toBe(1);
	expect(result.output).toContain("unsafe config path");
	expect(fs.readFileSync(target, "utf8") === "opaque fixture").toBe(true);
	expect(fs.existsSync(f[client === "claude" ? "codex" : "claude"])).toBe(
		false,
	);
});

it.each(
	[
		[],
		["http://executor.example.test/mcp"],
		["https://user:fixture@example.test/mcp"],
		["https://example.test/mcp?key=fixture"],
		["https://example.test/mcp#fixture"],
		["https://example.test/mcp", "--codex"],
		["https://example.test/mcp", "--server-executor", "https://example.test"],
		["https://example.test/mcp", "--os", "arch"],
		["https://example.test/mcp", "extra"],
		["https://example.test\\bad"],
		["https://*.example.test/mcp"],
	].map((args) => ({ args })),
)("rejects malformed endpoint/combined modes before logs or config", ({
	args,
}) => {
	const f = fixture();
	const result = run(f, ["--executor-clients", ...args]);
	expect(result.code).toBe(2);
	expect(result.output).toContain("Usage: haoshoku --executor-clients");
	expect(fs.readdirSync(f.home)).toEqual([]);
	expect(result.output.includes("user:fixture")).toBe(false);
	expect(result.output.includes("key=fixture")).toBe(false);
});
it.each([
	undefined,
	"",
	"Bearer ",
	"raw-fixture",
	"Bearer fixture\r\nInjected: bad",
])("reports missing/unsupported authentication without echoing it", (value) => {
	const f = fixture();
	f.env.EXECUTOR_AUTHORIZATION = value;
	const result = run(f);
	expect(result.code).toBe(2);
	expect(result.output).toContain("Set nonempty EXECUTOR_AUTHORIZATION");
	expect(fs.readdirSync(f.home)).toEqual([]);
	expect(result.output.includes("raw-fixture")).toBe(false);
	expect(result.output.includes("Injected")).toBe(false);
});
it("supports the inline endpoint form without logging the endpoint", () => {
	const f = fixture();
	const result = run(f, [`--executor-clients=${endpoint}`]);
	expect(result.code).toBe(0);
	const logs = fs.readdirSync(path.join(f.env.XDG_STATE_HOME, "haoshoku/logs"));
	const bytes = fs.readFileSync(
		path.join(f.env.XDG_STATE_HOME, "haoshoku/logs", logs[0]),
		"utf8",
	);
	expect(bytes.includes(endpoint)).toBe(false);
	expect(bytes.includes(auth)).toBe(false);
});

// Faults cross the real filesystem boundary; parsing and writing stay real.
import { configureExecutorClients } from "../src/helpers/configure_executor_clients.js";
function setupWith(f, fsImpl) {
	const output = [];
	const ok = configureExecutorClients(endpoint, {
		env: f.env,
		fsImpl,
		print: (line) => output.push(line),
	});
	return { ok, output: output.join("\n") };
}
it.each([
	false,
	true,
])("recovers both configs after a second-file write failure (existing=%s)", (existing) => {
	const f = fixture();
	if (existing) {
		seed(f.claude, '{"keep":true}');
		seed(f.codex, "# keep\n");
	}
	const descriptors = new Map();
	let failed = false;
	const fsImpl = {
		...fs,
		openSync(file, ...args) {
			const fd = fs.openSync(file, ...args);
			descriptors.set(fd, file);
			return fd;
		},
		writeSync(fd, ...args) {
			if (descriptors.get(fd) === f.codex && !failed) {
				failed = true;
				throw new Error("injected write failure");
			}
			return fs.writeSync(fd, ...args);
		},
	};
	const result = setupWith(f, fsImpl);
	expect(result.ok).toBe(false);
	expect(result.output).toContain(
		"original config contents restored/preserved",
	);
	if (existing) {
		expect(fs.readFileSync(f.claude, "utf8") === '{"keep":true}').toBe(true);
		expect(fs.readFileSync(f.codex, "utf8") === "# keep\n").toBe(true);
	} else {
		expect(fs.existsSync(f.claude)).toBe(false);
		expect(fs.existsSync(f.codex)).toBe(false);
	}
});
it("detects an input changed after both files were opened, before writing either", () => {
	const f = fixture();
	seed(f.claude, '{"keep":true}');
	seed(f.codex, "# keep\n");
	const fsImpl = {
		...fs,
		openSync(file, ...args) {
			const fd = fs.openSync(file, ...args);
			if (file === f.codex) fs.writeFileSync(f.claude, '{"concurrent":true}');
			return fd;
		},
	};
	const result = setupWith(f, fsImpl);
	expect(result.ok).toBe(false);
	expect(fs.readFileSync(f.claude, "utf8") === '{"concurrent":true}').toBe(
		true,
	);
	expect(fs.readFileSync(f.codex, "utf8") === "# keep\n").toBe(true);
});
it("reports uncertain recovery truthfully without leaking filesystem errors", () => {
	const f = fixture();
	seed(f.claude, '{"keep":true}');
	seed(f.codex, "# keep\n");
	let writes = 0;
	const fsImpl = {
		...fs,
		writeSync(...args) {
			if (++writes >= 2) throw new Error(auth);
			return fs.writeSync(...args);
		},
	};
	const result = setupWith(f, fsImpl);
	expect(result.ok).toBe(false);
	expect(result.output).toContain("recovery could not be confirmed");
	expect(result.output.includes(auth)).toBe(false);
});

it("never echoes an unexpected filesystem exception containing auth", () => {
	const f = fixture();
	seed(f.claude, '{"keep":true}');
	const fsImpl = {
		...fs,
		readFileSync() {
			throw new Error(auth);
		},
	};
	const result = setupWith(f, fsImpl);
	expect(result.ok).toBe(false);
	expect(result.output.includes(auth)).toBe(false);
	expect(fs.existsSync(f.codex)).toBe(false);
});

it("makes a matching helper rerun perform no filesystem mutations", () => {
	const f = fixture();
	expect(setupWith(f, fs).ok).toBe(true);
	const fsImpl = { ...fs };
	for (const method of [
		"openSync",
		"writeSync",
		"ftruncateSync",
		"fsyncSync",
		"mkdirSync",
		"chmodSync",
		"unlinkSync",
	])
		fsImpl[method] = () => {
			throw new Error("unexpected mutation");
		};
	expect(setupWith(f, fsImpl).ok).toBe(true);
});
it.each([
	["codex", 'mcp_servers = { other = { url="https://other.invalid" } }'],
	["codex", "[foo]]\nx=1"],
	["codex", 'x="""multiline\ntext"""'],
	[
		"claude",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Deliberately retain the env reference in an unknown entry.
		'{"mcpServers":{"executor":{"type":"http","url":"https://executor.example.test:8444/mcp","headers":{"Authorization":"${EXECUTOR_AUTHORIZATION}"},"unknown":true}}}',
	],
])("preserves conservative unsupported/unknown %s shapes", (client, bytes) => {
	const f = fixture();
	seed(f[client], bytes);
	expect(run(f).code).toBe(1);
	expect(fs.readFileSync(f[client], "utf8") === bytes).toBe(true);
	expect(fs.existsSync(f[client === "claude" ? "codex" : "claude"])).toBe(
		false,
	);
});
it("refuses a symlinked config directory, a hardlink, and invalid UTF-8", () => {
	for (const kind of ["directory", "hardlink", "encoding"]) {
		const f = fixture();
		const original = path.join(f.home, "original");
		seed(original, '{"keep":true}');
		if (kind === "directory") {
			const dir = path.join(f.home, "real-dir");
			fs.mkdirSync(dir);
			fs.symlinkSync(dir, path.dirname(f.codex));
		} else if (kind === "hardlink") fs.linkSync(original, f.claude);
		else seed(f.claude, Buffer.from([0xff, 0xfe]));
		expect(run(f).code).toBe(1);
		expect(fs.readFileSync(original, "utf8") === '{"keep":true}').toBe(true);
		expect(fs.existsSync(f.codex)).toBe(false);
	}
});

it("removes its new config if descriptor inspection fails before any content write", () => {
	const f = fixture();
	let failed = false;
	const fsImpl = {
		...fs,
		fstatSync(fd) {
			if (!failed) {
				failed = true;
				throw new Error("injected descriptor inspection failure");
			}
			return fs.fstatSync(fd);
		},
	};
	const result = setupWith(f, fsImpl);
	expect(result.ok).toBe(false);
	expect(fs.existsSync(f.claude)).toBe(false);
	expect(fs.existsSync(f.codex)).toBe(false);
});

// F1: Claude's legacy selector must never leave a successful inactive entry.
function configSnapshot(f) {
	return fs
		.readdirSync(f.home, { recursive: true })
		.sort()
		.filter((rel) => rel !== "state" && !rel.startsWith(`state${path.sep}`))
		.map((rel) => {
			const file = path.join(f.home, rel);
			const stat = fs.lstatSync(file);
			return [
				rel,
				stat.ino,
				stat.mode,
				stat.mtimeMs,
				stat.isSymbolicLink()
					? fs.readlinkSync(file)
					: stat.isFile()
						? Bun.hash(fs.readFileSync(file)).toString()
						: null,
			];
		});
}
function preserved(f, before, result, opaque) {
	expect(JSON.stringify(configSnapshot(f)) === JSON.stringify(before)).toBe(
		true,
	);
	expect(result.output.includes(auth)).toBe(false);
	expect(result.output.includes(opaque)).toBe(false);
	for (const rel of fs.readdirSync(f.home, { recursive: true })) {
		const file = path.join(f.home, rel);
		if (!fs.lstatSync(file).isFile()) continue;
		const bytes = fs.readFileSync(file, "utf8");
		expect(bytes.includes(auth)).toBe(false);
		if (!before.some(([original]) => original === rel))
			expect(bytes.includes(opaque)).toBe(false);
	}
}
it.each([
	false,
	true,
])("refuses Claude legacy config before either client changes (custom=%s)", (custom) => {
	const f = fixture();
	const configHome = path.join(f.home, custom ? "custom-claude" : ".claude");
	if (custom) {
		f.env.CLAUDE_CONFIG_DIR = configHome;
		f.claude = path.join(configHome, ".claude.json");
	}
	const opaque = Buffer.from("legacy original credential").toString("hex");
	seed(path.join(configHome, ".config.json"), `{"opaque":"${opaque}"}`);
	seed(
		f.codex,
		'# independent Codex original\nmodel = "fixture"\n',
	);
	// Default fixture has an existing inactive file; custom fixture has no target.
	if (!custom) seed(f.claude, '{"keep":"inactive original"}');
	const before = configSnapshot(f);
	const result = run(f);
	expect(result.code).toBe(1);
	expect(result.output).toContain("legacy .config.json");
	expect(result.output).toContain("manual user-scope MCP setup");
	preserved(f, before, result, opaque);
});
it.each([
	"0775",
	"symlink",
])("refuses unsafe custom Claude write home %s and preserves both clients", (kind) => {
	const f = defaultLookupFixture(kind);
	f.env.CLAUDE_CONFIG_DIR = f.lookup;
	seed(f.codex, "# independent Codex original\n");
	const before = configSnapshot(f);
	const result = run(f);
	expect(result.code).toBe(1);
	expect(result.output).toContain("unsafe config path");
	preserved(f, before, result, "opaque-unused");
});
it("fails closed on a legacy existence-check error without reading configs or leaking it", () => {
	const f = fixture();
	seed(f.claude, '{"keep":true}');
	seed(f.codex, "# independent original\n");
	const before = configSnapshot(f);
	let reads = 0;
	const result = setupWith(f, {
		...fs,
		lstatSync(file) {
			if (file === path.join(f.home, ".claude/.config.json"))
				throw Object.assign(new Error(auth), { code: "EACCES" });
			return fs.lstatSync(file);
		},
		readFileSync(...args) {
			reads++;
			return fs.readFileSync(...args);
		},
	});
	expect(result.ok).toBe(false);
	expect(result.output).toContain("manual user-scope MCP setup");
	expect(reads).toBe(0);
	preserved(f, before, result, "opaque-unused");
});

it.each([
	["CLAUDE_CODE_CUSTOM_OAUTH_URL", "https://claude.fedstart.com"],
	["USE_STAGING_OAUTH", "1"],
	["USE_LOCAL_OAUTH", "1"],
])("refuses unsupported Claude OAuth environment %s before either write", (variable, value) => {
	for (const existing of [false, true]) {
		const f = fixture();
		f.env[variable] = value;
		const opaque = Buffer.from("variant original credential").toString("hex");
		if (existing) {
			f.env.CLAUDE_CONFIG_DIR = path.join(f.home, "custom-claude");
			f.claude = path.join(f.env.CLAUDE_CONFIG_DIR, ".claude.json");
			seed(f.claude, `{"opaque":"${opaque}"}`);
			seed(f.codex, "# independent Codex original\n");
		}
		const before = configSnapshot(f);
		const result = run(f);
		expect(result.code).toBe(1);
		expect(result.output).toContain("Claude OAuth environment is unsupported");
		expect(result.output).toContain("manual user-scope MCP setup");
		preserved(f, before, result, opaque);
	}
});

it("refuses an explicitly empty Claude config home rather than assuming default legacy lookup", () => {
	const f = fixture();
	f.env.CLAUDE_CONFIG_DIR = "";
	seed(f.claude, '{"keep":true}');
	seed(f.codex, "# independent original\n");
	const before = configSnapshot(f);
	const result = run(f);
	expect(result.code).toBe(1);
	expect(result.output).toContain("Unset empty CLAUDE_CONFIG_DIR");
	preserved(f, before, result, "opaque-unused");
});

// F-D1: default .claude is a legacy lookup path, not a write ancestor.
function defaultLookupFixture(kind) {
	const f = fixture();
	const lookup = path.join(f.home, ".claude");
	const target = kind === "symlink" ? path.join(f.home, "dotfiles") : lookup;
	fs.mkdirSync(target);
	if (kind === "symlink") fs.symlinkSync(target, lookup);
	else fs.chmodSync(target, 0o775);
	return { ...f, lookup, target };
}
it.each([
	"0775",
	"symlink",
])("supports default Claude legacy lookup through %s when no legacy exists", (kind) => {
	const f = defaultLookupFixture(kind);
	const opaque = Buffer.from("lookup original credential").toString("hex");
	const unrelated = path.join(f.target, "unrelated.json");
	seed(unrelated, `{"opaque":"${opaque}"}`);
	const lookupStat = fs.lstatSync(f.lookup);
	const targetStat = fs.statSync(f.target);
	const result = run(f);
	expect(result.code).toBe(0);
	expect(result.output).toContain("Configuration written");
	expect(
		JSON.parse(fs.readFileSync(f.claude, "utf8")).mcpServers.executor.url,
	).toBe(endpoint);
	expect(
		Bun.TOML.parse(fs.readFileSync(f.codex, "utf8")).mcp_servers.executor.url,
	).toBe(endpoint);
	expect(fs.readFileSync(unrelated, "utf8") === `{"opaque":"${opaque}"}`).toBe(
		true,
	);
	for (const [file, before] of [
		[f.lookup, lookupStat],
		[f.target, targetStat],
	]) {
		const after = fs.lstatSync(file);
		expect([after.ino, after.mode, after.mtimeMs]).toEqual([
			before.ino,
			before.mode,
			before.mtimeMs,
		]);
	}
	expect(result.output.includes(opaque)).toBe(false);
	const before = configSnapshot(f);
	const repeat = run(f);
	expect(repeat.code).toBe(0);
	expect(repeat.output).toContain("already matches");
	preserved(f, before, repeat, opaque);
});
it.each([
	"0775",
	"symlink",
])("refuses legacy presence behind default %s without changing either client", (kind) => {
	const f = defaultLookupFixture(kind);
	const opaque = Buffer.from("lookup legacy original credential").toString(
		"hex",
	);
	seed(path.join(f.target, ".config.json"), `{"opaque":"${opaque}"}`);
	seed(f.claude, '{"keep":"independent Claude original"}');
	seed(f.codex, "# independent Codex original\n");
	const before = configSnapshot(f);
	const result = run(f);
	expect(result.code).toBe(1);
	expect(result.output).toContain("manual user-scope MCP setup");
	preserved(f, before, result, opaque);
});
it("refuses an unresolvable default legacy lookup before touching either client", () => {
	const f = fixture();
	fs.symlinkSync(".claude", path.join(f.home, ".claude"));
	seed(f.claude, '{"keep":"independent Claude original"}');
	seed(f.codex, "# independent Codex original\n");
	const files = [f.claude, f.codex];
	const originals = files.map((file) => fs.readFileSync(file));
	const entries = fs.readdirSync(f.home).sort();
	const result = setupWith(f, fs);
	expect(result.ok).toBe(false);
	expect(result.output).toContain("manual user-scope MCP setup");
	for (const [i, file] of files.entries())
		expect(fs.readFileSync(file).equals(originals[i])).toBe(true);
	expect(fs.readdirSync(f.home).sort()).toEqual(entries);
	expect(fs.readdirSync(path.dirname(f.codex))).toEqual(["config.toml"]);
	expect(fs.readlinkSync(path.join(f.home, ".claude"))).toBe(".claude");
	expect(result.output.includes(auth)).toBe(false);
});
