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
			CLAUDE_CONFIG_DIR: "",
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

