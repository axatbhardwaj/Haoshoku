import { isDeepStrictEqual } from "node:util";

export class ExecutorClientError extends Error {}

const object = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);

// JSON.parse validates syntax; this walk rejects duplicate keys and retains
// object closing offsets so adding one key does not reserialize other settings.
function jsonObjects(text) {
	JSON.parse(text);
	const tokens = [
		...text.matchAll(
			/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g,
		),
	];
	let i = 0;
	function value() {
		const token = tokens[i++];
		if (token[0] === "{") {
			const members = new Map();
			while (tokens[i][0] !== "}") {
				const key = JSON.parse(tokens[i++][0]);
				if (members.has(key)) throw new Error("Duplicate JSON key");
				i++; // colon; syntax already validated
				members.set(key, value());
				if (tokens[i][0] === ",") i++;
			}
			return { members, end: tokens[i++].index };
		}
		if (token[0] === "[") {
			while (tokens[i][0] !== "]") {
				value();
				if (tokens[i][0] === ",") i++;
			}
			i++;
		}
		return {};
	}
	return value();
}

function insertKey(text, node, key, value) {
	return `${text.slice(0, node.end)}${node.members.size ? "," : ""}\n${JSON.stringify(key)}: ${JSON.stringify(value)}\n${text.slice(node.end)}`;
}

function parseCodexConfig(text) {
	// Bun validates values and duplicate keys, but accepts unclosed/extra table
	// brackets. Check table syntax independently; multiline strings are outside
	// this conservative additive writer's supported shapes.
	if (text.includes('"""') || text.includes("'".repeat(3))) throw new Error();
	const key = `(?:[A-Za-z0-9_-]+|"(?:\\\\.|[^"\\\\])*"|'[^']*')`;
	const dotted = `${key}(?:\\s*\\.\\s*${key})*`;
	const header = new RegExp(
		`^\\s*(?:\\[\\s*${dotted}\\s*\\]|\\[\\[\\s*${dotted}\\s*\\]\\])\\s*(?:#.*)?$`,
	);
	for (const line of text.split("\n")) {
		if (line.trimStart().startsWith("[") && !header.test(line))
			throw new Error();
	}
	return Bun.TOML.parse(text);
}

export function planExecutorClientConfig(client, original, url) {
	const expected =
		client === "Claude Code"
			? {
					type: "http",
					url,
					// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude resolves this reference at runtime.
					headers: { Authorization: "${EXECUTOR_AUTHORIZATION}" },
				}
			: { url, env_http_headers: { Authorization: "EXECUTOR_AUTHORIZATION" } };
	let config, node, servers;
	try {
		if (client === "Claude Code") {
			const text = original ?? "{}\n";
			node = jsonObjects(text);
			config = JSON.parse(text);
			if (!object(config)) throw new Error();
			servers = config.mcpServers;
		} else {
			config = parseCodexConfig(original ?? "");
			servers = config.mcp_servers;
		}
		if (servers !== undefined && !object(servers)) throw new Error();
	} catch {
		throw new ExecutorClientError(
			`${client} config is malformed or unsupported; repair it manually, then retry. Both configs left intact.`,
		);
	}
	if (servers && Object.hasOwn(servers, "executor")) {
		if (isDeepStrictEqual(servers.executor, expected)) return original;
		throw new ExecutorClientError(
			`${client} executor entry conflicts; reconcile it manually in the effective user config, then retry. Both configs left intact.`,
		);
	}
	if (client === "Claude Code") {
		const text = original ?? "{}\n";
		return servers
			? insertKey(text, node.members.get("mcpServers"), "executor", expected)
			: insertKey(text, node, "mcpServers", { executor: expected });
	}
	// Extending an inline TOML table is forbidden by TOML even though Bun's
	// parser currently accepts it. Preserve it and ask for explicit reconciliation.
	if (
		/^\s*(?:mcp_servers|["']mcp_servers["'])\s*=|^\s*mcp_servers\./m.test(
			original ?? "",
		)
	)
		throw new ExecutorClientError(
			"Codex config is malformed or unsupported for additive setup; use regular MCP TOML tables, then retry. Both configs left intact.",
		);
	return `${original ?? ""}\n[mcp_servers.executor]\nurl = ${JSON.stringify(url)}\nenv_http_headers = { Authorization = "EXECUTOR_AUTHORIZATION" }\n`;
}
