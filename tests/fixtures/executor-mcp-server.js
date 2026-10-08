import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Generate a disposable identity outside the repo; never commit a private key.
const tlsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-tls-"));
export const certFile = path.join(tlsRoot, "cert.pem");
const keyFile = path.join(tlsRoot, "key.pem");
const generated = Bun.spawnSync(
	[
		"openssl",
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		keyFile,
		"-out",
		certFile,
		"-days",
		"1",
		"-subj",
		"/CN=127.0.0.1",
		"-addext",
		"subjectAltName=IP:127.0.0.1",
		"-config",
		"/dev/null",
	],
	{ stdout: "ignore", stderr: "pipe" },
);
if (generated.exitCode !== 0)
	throw new Error("TLS fixture generation failed; openssl is required.");
// Shared across test files: retain files until every CLI child has finished.
process.on("exit", () => fs.rmSync(tlsRoot, { recursive: true }));
export const cert = fs.readFileSync(certFile, "utf8");
export function createExecutorStub(auth) {
	return Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		tls: {
			cert,
			key: Bun.file(keyFile),
		},
		async fetch(request) {
			const message = await request.json();
			if (request.headers.get("Authorization") !== auth)
				return new Response(auth, { status: 401 });
			if (message.method === "notifications/initialized") {
				if (
					request.headers.get("Mcp-Session-Id") !== "fixture-session" ||
					request.headers.get("MCP-Protocol-Version") !== "2025-03-26"
				)
					return new Response(null, { status: 400 });
				return new Response(null, { status: 202 });
			}
			if (
				request.method !== "POST" ||
				message.method !== "initialize" ||
				message.jsonrpc !== "2.0" ||
				message.id !== 1 ||
				message.params?.protocolVersion !== "2025-03-26" ||
				!message.params?.clientInfo?.name ||
				!request.headers.get("Accept")?.includes("application/json") ||
				!request.headers.get("Accept")?.includes("text/event-stream")
			)
				return new Response(null, { status: 400 });
			const result = {
				protocolVersion: "2025-03-26",
				capabilities: {},
				serverInfo: { name: "fixture", version: "1" },
			};
			const reply = { jsonrpc: "2.0", id: message.id, result };
			const route = new URL(request.url).pathname;
			if (route === "/unauthorized") return new Response(auth, { status: 401 });
			if (route === "/invalid")
				return Response.json({
					jsonrpc: "2.0",
					id: message.id,
					error: { code: -1, message: auth },
				});
			if (route === "/wrong-id") return Response.json({ ...reply, id: 99 });
			if (route === "/stall")
				return new Response(new ReadableStream({}), {
					headers: { "Content-Type": "text/event-stream" },
				});
			if (route === "/sse")
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(
								new TextEncoder().encode(
									`: heartbeat\r\n\r\nevent: message\r\ndata: ${JSON.stringify(reply)}\r\n\r\n`,
								),
							);
						},
					}),
					{
						headers: {
							"Content-Type": "text/event-stream",
							"Mcp-Session-Id": "fixture-session",
						},
					},
				);
			return Response.json(reply, {
				headers: { "Mcp-Session-Id": "fixture-session" },
			});
		},
	});
}
