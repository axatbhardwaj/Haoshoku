import fs from "node:fs";
import path from "node:path";
import {
	ExecutorClientError,
	planExecutorClientConfig,
} from "./executor_client_config.js";
import {
	inspectClientFile,
	writeClientPlans,
} from "./executor_client_files.js";

export const EXECUTOR_CLIENT_USAGE =
	"Usage: haoshoku --executor-clients <https-endpoint> (standalone). Export EXECUTOR_AUTHORIZATION with the complete Bearer authorization value; no credentials, query or fragment in the HTTPS URL.";

function refuseLegacyClaudeConfig(configHome, fsImpl) {
	const guidance =
		"Use manual user-scope MCP setup for Claude and Codex in the intended harness environment. Both configs left intact.";
	try {
		// Inspect metadata only: never read or adopt a legacy secret-bearing file.
		fsImpl.lstatSync(path.join(configHome, ".config.json"));
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw new ExecutorClientError(
			`Cannot inspect Claude config layout. ${guidance}`,
		);
	}
	throw new ExecutorClientError(
		`Claude legacy .config.json layout is unsupported. ${guidance}`,
	);
}

export function validateExecutorClientInput(endpoint, env = process.env) {
	if (
		typeof endpoint !== "string" ||
		!/^https:\/\/[^/?#\\\s]+(?:\/[^?#\\\s]*)?$/.test(endpoint)
	)
		throw new ExecutorClientError(EXECUTOR_CLIENT_USAGE);
	let url;
	try {
		url = new URL(endpoint);
	} catch {
		throw new ExecutorClientError(EXECUTOR_CLIENT_USAGE);
	}
	if (
		url.username ||
		url.password ||
		url.hostname.includes("*") ||
		url.hash ||
		url.search
	)
		throw new ExecutorClientError(EXECUTOR_CLIENT_USAGE);
	if (!/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(env.EXECUTOR_AUTHORIZATION || ""))
		throw new ExecutorClientError(
			"Set nonempty EXECUTOR_AUTHORIZATION to the complete Bearer authorization value, then retry. No configuration written.",
		);
	return url.href;
}

export function configureExecutorClients(
	endpoint,
	{ env = process.env, fsImpl = fs, print = console.log } = {},
) {
	try {
		const url = validateExecutorClientInput(endpoint, env);
		if (env.CLAUDE_CONFIG_DIR === "")
			throw new ExecutorClientError(
				"Unset empty CLAUDE_CONFIG_DIR to use the default home, or supply an absolute config home, then retry. Both configs left intact.",
			);
		if (
			env.CLAUDE_CODE_CUSTOM_OAUTH_URL ||
			env.USE_STAGING_OAUTH ||
			env.USE_LOCAL_OAUTH
		)
			throw new ExecutorClientError(
				"Claude OAuth environment is unsupported. Use manual user-scope MCP setup for Claude and Codex in the intended harness environment. Both configs left intact.",
			);
		if (!env.HOME || !path.isAbsolute(env.HOME))
			throw new ExecutorClientError(
				"Use an absolute HOME for the intended agent user.",
			);
		const claude = env.CLAUDE_CONFIG_DIR
			? path.join(env.CLAUDE_CONFIG_DIR, ".claude.json")
			: path.join(env.HOME, ".claude.json");
		const codex = path.join(
			env.CODEX_HOME || path.join(env.HOME, ".codex"),
			"config.toml",
		);
		if ([claude, codex].some((file) => !path.isAbsolute(file)))
			throw new ExecutorClientError("Use absolute harness config homes.");
		refuseLegacyClaudeConfig(
			env.CLAUDE_CONFIG_DIR || path.join(env.HOME, ".claude"),
			fsImpl,
		);
		const plans = [
			["Claude Code", claude],
			["Codex", codex],
		].map(([client, file]) => {
			const plan = inspectClientFile(file, fsImpl);
			return {
				...plan,
				content: planExecutorClientConfig(
					client,
					plan.original?.toString("utf8") ?? null,
					url,
				),
			};
		});
		writeClientPlans(plans, fsImpl);
		const changed = plans.some(
			(plan) => plan.content !== plan.original?.toString("utf8"),
		);
		print(
			`${changed ? "Configuration written" : "Configuration already matches"} for Claude Code and Codex; authenticated MCP handshake/tool discovery not verified. EXECUTOR_AUTHORIZATION must reach future harness sessions.`,
		);
		return true;
	} catch (error) {
		print(
			!(error instanceof ExecutorClientError)
				? "Client setup incomplete; inspect config paths and permissions, then retry."
				: error.message,
		);
		return false;
	}
}
