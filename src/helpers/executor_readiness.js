async function readProbe(url, fetchImpl, timeoutMs) {
	const controller = new AbortController();
	let reader;
	let timer;
	try {
		return await Promise.race([
			(async () => {
				const response = await fetchImpl(url, {
					redirect: "error",
					signal: controller.signal,
				});
				if (
					!response.ok ||
					response.redirected ||
					(response.url && response.url !== url) ||
					!response.headers
						.get("content-type")
						?.split(";")[0]
						.trim()
						.toLowerCase()
						.endsWith("/json")
				)
					throw new Error("invalid response");
				reader = response.body.getReader();
				const chunks = [];
				let size = 0;
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > 16_384) throw new Error("oversized response");
					chunks.push(value);
				}
				return JSON.parse(await new Blob(chunks).text());
			})(),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("probe timeout")), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
		controller.abort();
		if (reader) void reader.cancel().catch(() => {});
	}
}

export async function verifyExecutorReady(
	origin,
	{ fetchImpl, sleepImpl, readinessAttempts = 5, probeTimeoutMs = 5_000 },
) {
	if (
		!Number.isInteger(readinessAttempts) ||
		readinessAttempts < 1 ||
		readinessAttempts > 5 ||
		!Number.isFinite(probeTimeoutMs) ||
		probeTimeoutMs <= 0 ||
		probeTimeoutMs > 5_000
	)
		return false;
	for (let attempt = 0; attempt < readinessAttempts; attempt++) {
		try {
			for (const base of ["http://127.0.0.1:4788", origin]) {
				const health = await readProbe(
					`${base}/api/health`,
					fetchImpl,
					probeTimeoutMs,
				);
				if (health?.status !== "ok") throw new Error("unhealthy");
				const metadata = await readProbe(
					`${base}/.well-known/oauth-authorization-server`,
					fetchImpl,
					probeTimeoutMs,
				);
				const issuer = new URL(metadata.issuer);
				if (
					issuer.origin !== origin ||
					issuer.username ||
					issuer.password ||
					issuer.search ||
					issuer.hash ||
					metadata.authorization_endpoint !==
						`${origin}/api/auth/mcp/authorize` ||
					metadata.token_endpoint !== `${origin}/api/auth/mcp/token` ||
					metadata.registration_endpoint !== `${origin}/api/auth/mcp/register`
				)
					throw new Error("wrong application origin");
			}
			return true;
		} catch {
			if (attempt + 1 < readinessAttempts) await sleepImpl(1_000);
		}
	}
	return false;
}
