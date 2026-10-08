// A short authenticated initialize check, not tool or integration discovery.
async function initializeReply(response) {
	if (response.headers.get("content-type")?.includes("application/json"))
		return response.json();
	if (!response.headers.get("content-type")?.includes("text/event-stream"))
		throw new Error("Unsupported MCP response");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) throw new Error("Missing MCP response");
			size += value.length;
			if (size > 65536) throw new Error("MCP response too large");
			buffer += decoder.decode(value, { stream: true });
			while (true) {
				const match = /\r?\n\r?\n/.exec(buffer);
				if (!match) break;
				const frame = buffer.slice(0, match.index);
				buffer = buffer.slice(match.index + match[0].length);
				const data = frame
					.split(/\r?\n/)
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).replace(/^ /, ""))
					.join("\n");
				if (!data) continue;
				const message = JSON.parse(data);
				if (message.id === 1) return message;
			}
		}
	} finally {
		await reader.cancel();
	}
}

export async function checkExecutorConnection(url, authorization, fetchImpl) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 5000);
	const headers = {
		Authorization: authorization,
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
	};
	const options = {
		method: "POST",
		headers,
		redirect: "error",
		signal: controller.signal,
	};
	try {
		const response = await fetchImpl(url, {
			...options,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-03-26",
					capabilities: {},
					clientInfo: { name: "haoshoku-connectivity-check", version: "1" },
				},
			}),
		});
		if (!response.ok) throw new Error("MCP initialize failed");
		const reply = await initializeReply(response);
		if (
			reply.jsonrpc !== "2.0" ||
			reply.id !== 1 ||
			reply.error ||
			reply.result?.protocolVersion !== "2025-03-26" ||
			!reply.result.capabilities ||
			!reply.result.serverInfo?.name ||
			!reply.result.serverInfo?.version
		)
			throw new Error("Invalid MCP initialize response");
		headers["MCP-Protocol-Version"] = reply.result.protocolVersion;
		const session = response.headers.get("Mcp-Session-Id");
		if (session) headers["Mcp-Session-Id"] = session;
		const initialized = await fetchImpl(url, {
			...options,
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "notifications/initialized",
			}),
		});
		if (!initialized.ok) throw new Error("MCP initialized failed");
		await initialized.body?.cancel();
	} finally {
		clearTimeout(timer);
	}
}
