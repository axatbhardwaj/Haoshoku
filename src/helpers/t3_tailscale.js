import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

export const T3_VERSION_FLOOR = "0.0.46-nightly.20261003.2610";
export const SERVICE_ACTIVE_COMMAND =
	"systemctl --user is-active --quiet t3code.service";
const SERVE_STATUS_COMMAND = "tailscale serve status --json";
export const READINESS_ATTEMPTS = 30;
const READINESS_INTERVAL_MS = 2000;
const HTTPS_TIMEOUT_MS = 5000;

export function shellQuote(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function meetsT3Floor(output) {
	const version = (output ?? "").trim().replace(/^(?:t3 v|v)/, "");
	return (
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
			version,
		) && Bun.semver.order(version, T3_VERSION_FLOOR) >= 0
	);
}

export function parseJson(output) {
	try {
		return JSON.parse(output);
	} catch {
		return null;
	}
}

export async function ensureTailscaleOperator({
	user,
	probe,
	runCommandImpl,
	logger,
	retryFlag = "--server-t3-code",
}) {
	try {
		const prefs = parseJson(await probe("tailscale debug prefs"));
		if (!prefs || typeof prefs.OperatorUser !== "string") {
			throw new Error("Cannot verify Tailscale operator preferences");
		}
		if (prefs.OperatorUser === user) return true;
		if (prefs.OperatorUser) {
			logger.warning(
				`Replacing Tailscale operator ${prefs.OperatorUser} with ${user}`,
			);
		}
		if (
			!(await runCommandImpl(
				`sudo -n tailscale set --operator=${shellQuote(user)}`,
			))
		) {
			throw new Error(`Cannot set Tailscale operator to ${user}`);
		}
		return true;
	} catch (error) {
		logger.warning(
			`Tailscale operator configuration failed: ${error.message}. Run sudo tailscale set --operator=${shellQuote(user)}, then retry haoshoku ${retryFlag}.`,
		);
		return false;
	}
}

function tailscaleHttpsUrl(config) {
	if (config?.TCP?.[443]?.HTTPS !== true) return null;
	for (const [hostPort, web] of Object.entries(config.Web ?? {})) {
		if (
			/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net:443$/i.test(hostPort) &&
			web?.Handlers?.["/"]?.Proxy === "http://127.0.0.1:3773"
		) {
			return `https://${hostPort.slice(0, -4)}`;
		}
	}
	return null;
}

export function writeServiceDropIn(home, name, content, fsImpl = fs) {
	const directory = path.join(home, ".config/systemd/user/t3code.service.d");
	const file = path.join(directory, name);
	try {
		if (fsImpl.readFileSync(file, "utf8") === content) return false;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	fsImpl.mkdirSync(directory, { recursive: true });
	fsImpl.writeFileSync(file, content);
	return true;
}

async function verifyT3Loopback(probe, logger, fail) {
	let listeners;
	try {
		listeners = await probe("ss -Hltn 'sport = :3773'");
	} catch {
		// ss may be absent on an otherwise ready machine.
	}
	if (!listeners) {
		logger.warning(
			"T3 bind could not be verified: ss is unavailable or reports no listeners on port 3773",
		);
		return true;
	}
	for (const line of listeners.split("\n")) {
		const local = line.trim().split(/\s+/)[3] ?? "";
		const address = local.replace(/:3773$/, "").replace(/^\[(.*)\]$/, "$1");
		if (
			!(
				address === "::1" ||
				(isIP(address) === 4 && address.startsWith("127."))
			)
		) {
			return fail(
				`T3 listener ${local || line} is not loopback. T3 must listen on 127.0.0.1 and be exposed only via Tailscale Serve.`,
			);
		}
	}
	return true;
}

export async function waitForT3Tailscale({
	probe,
	t3 = "t3",
	fetchImpl = fetch,
	sleepImpl = Bun.sleep,
	maxReadinessAttempts = READINESS_ATTEMPTS,
	logger,
	fail,
	retryFlag = "--server-t3-code",
	tailnetOnly = false,
}) {
	const attempts =
		Number.isInteger(maxReadinessAttempts) && maxReadinessAttempts > 0
			? Math.min(maxReadinessAttempts, READINESS_ATTEMPTS)
			: READINESS_ATTEMPTS;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const config = parseJson(await probe(SERVE_STATUS_COMMAND));
		const url =
			tailnetOnly && Object.values(config?.AllowFunnel ?? {}).some(Boolean)
				? null
				: tailscaleHttpsUrl(config);
		if (url) {
			let ready = false;
			try {
				const response = await fetchImpl(url, {
					signal: AbortSignal.timeout(HTTPS_TIMEOUT_MS),
					redirect: "error",
				});
				await response.body?.cancel();
				ready = response.ok;
			} catch {
				// Serve and HTTPS certificates can take time to become available.
			}
			if (ready) {
				if (!(await verifyT3Loopback(probe, logger, fail))) return false;
				logger.success(`T3 Code service and Tailscale HTTPS are ready: ${url}`);
				logger.info(
					`Pair your phone on the same tailnet with: ${t3} pair --tailscale`,
				);
				return true;
			}
		}
		if (attempt < attempts - 1) await sleepImpl(READINESS_INTERVAL_MS);
	}
	return fail(
		`Tailscale HTTPS is not ready. Inspect ${SERVE_STATUS_COMMAND} for a tailnet HTTPS route to http://127.0.0.1:3773. Enable tailnet HTTPS certificates; non-root users need tailscale set --operator=$USER. Retry haoshoku ${retryFlag}.`,
	);
}
