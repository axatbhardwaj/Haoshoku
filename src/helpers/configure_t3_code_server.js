import { log, runCommand } from "../common/utils.js";

const NODESOURCE_SETUP_COMMAND =
	"curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -";
const NODE_INSTALL_COMMAND = "sudo apt install -y nodejs";
const T3_SERVICE_INSTALL_COMMAND = "npx --yes t3@latest service install";
const T3_SERVICE_STATUS_COMMAND = "npx --yes t3@latest service status";
const T3_CONNECT_LINK_COMMAND = "npx --yes t3@latest connect link --headless";
const T3_SERVICE_UPDATE_COMMAND = "npx --yes t3@latest service update";
const T3_SERVICE_RESTART_COMMAND = "systemctl --user restart t3code.service";
const T3_CONNECT_DIAGNOSTIC_COMMAND = "npx --yes t3@latest connect status";
const T3_CONNECT_STATUS_ARGS = [
	"npx",
	"--yes",
	"t3@latest",
	"connect",
	"status",
	"--json",
];
const T3_CONNECT_POLL_INTERVAL_MS = 2000;
const T3_CONNECT_MAX_ATTEMPTS = 30;

function getNodeVersion() {
	const result = Bun.spawnSync(["node", "--version"], {
		stderr: "ignore",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) return null;
	return new TextDecoder().decode(result.stdout).trim();
}

export function parseT3ConnectStatus(output) {
	try {
		const value = JSON.parse(output);
		if (!value || typeof value !== "object" || Array.isArray(value))
			return null;
		if (
			typeof value.desired !== "boolean" ||
			typeof value.authenticated !== "boolean" ||
			typeof value.linked !== "boolean"
		) {
			return null;
		}
		return {
			desired: value.desired,
			authenticated: value.authenticated,
			linked: value.linked,
			relayUrl: typeof value.relayUrl === "string" ? value.relayUrl : null,
			relayClientAvailable: value.relayClient?.status === "available",
		};
	} catch {
		return null;
	}
}

export function isT3ConnectReady(status) {
	return Boolean(
		status?.desired &&
			status.authenticated &&
			status.linked &&
			status.relayUrl?.trim() &&
			status.relayClientAvailable,
	);
}

export function canResumeT3Connect(status) {
	return Boolean(
		status?.desired && status.authenticated && status.relayClientAvailable,
	);
}

export function readT3ConnectStatus({ spawnSyncImpl = Bun.spawnSync } = {}) {
	const result = spawnSyncImpl(T3_CONNECT_STATUS_ARGS, {
		stderr: "ignore",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) return null;
	return parseT3ConnectStatus(new TextDecoder().decode(result.stdout).trim());
}

export function isT3NodeVersionSupported(version) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
	if (!match) return false;

	const major = Number(match[1]);
	const minor = Number(match[2]);
	if (major === 22) return minor >= 16;
	if (major === 23) return minor >= 11;
	if (major === 24) return minor >= 10;
	return major > 24;
}

export async function ensureT3NodeRuntime({
	getNodeVersionImpl = getNodeVersion,
	runCommandImpl = runCommand,
	logger = log,
} = {}) {
	const currentVersion = await getNodeVersionImpl();
	if (isT3NodeVersionSupported(currentVersion)) return true;

	logger.info(
		`Installing a T3 Code-compatible Node.js runtime (current: ${currentVersion ?? "missing"})...`,
	);
	if (!(await runCommandImpl(NODESOURCE_SETUP_COMMAND))) {
		logger.error("Could not configure the NodeSource Node.js 24 repository.");
		return false;
	}
	if (!(await runCommandImpl(NODE_INSTALL_COMMAND))) {
		logger.error("Could not install Node.js 24.");
		return false;
	}

	const installedVersion = await getNodeVersionImpl();
	if (!isT3NodeVersionSupported(installedVersion)) {
		logger.error(
			`Node.js ${installedVersion ?? "is still unavailable"}; T3 Code requires ^22.16, ^23.11, or >=24.10.`,
		);
		return false;
	}
	return true;
}

export async function ensureT3Connect({
	getConnectStatusImpl = readT3ConnectStatus,
	runCommandImpl = runCommand,
	sleepImpl = Bun.sleep,
	maxAttempts = T3_CONNECT_MAX_ATTEMPTS,
	logger = log,
} = {}) {
	const initialStatus = await getConnectStatusImpl();
	if (isT3ConnectReady(initialStatus)) {
		logger.info(
			"T3 Connect is already provisioned; keeping the existing link.",
		);
		return true;
	}

	if (canResumeT3Connect(initialStatus)) {
		logger.info("Resuming the stored T3 Connect authorization...");
	} else {
		logger.info("Authorizing this server with T3 Connect...");
		if (!(await runCommandImpl(T3_CONNECT_LINK_COMMAND))) {
			logger.error(
				`T3 Connect authorization failed. Retry with: ${T3_CONNECT_LINK_COMMAND}`,
			);
			return false;
		}
	}

	if (!(await runCommandImpl(T3_SERVICE_UPDATE_COMMAND))) {
		logger.error(
			`T3 Code service update failed. Retry with: ${T3_SERVICE_UPDATE_COMMAND}`,
		);
		return false;
	}
	if (!(await runCommandImpl(T3_SERVICE_RESTART_COMMAND))) {
		logger.error(
			`T3 Code service restart failed. Retry with: ${T3_SERVICE_RESTART_COMMAND}`,
		);
		return false;
	}

	logger.info("Waiting for the T3 Connect environment link and relay...");
	const attempts =
		Number.isInteger(maxAttempts) && maxAttempts > 0
			? maxAttempts
			: T3_CONNECT_MAX_ATTEMPTS;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (isT3ConnectReady(await getConnectStatusImpl())) {
			if (!(await runCommandImpl(T3_SERVICE_STATUS_COMMAND))) {
				logger.error(
					`T3 Code service could not be verified after T3 Connect provisioning. Retry with: ${T3_SERVICE_STATUS_COMMAND}`,
				);
				return false;
			}
			return true;
		}
		if (attempt < attempts - 1) {
			await sleepImpl(T3_CONNECT_POLL_INTERVAL_MS);
		}
	}

	logger.error(
		`T3 Connect did not finish provisioning. Inspect with: ${T3_CONNECT_DIAGNOSTIC_COMMAND}`,
	);
	return false;
}

export async function configureT3CodeServer({
	ensureNodeImpl = ensureT3NodeRuntime,
	getConnectStatusImpl = readT3ConnectStatus,
	runCommandImpl = runCommand,
	sleepImpl = Bun.sleep,
	maxConnectAttempts = T3_CONNECT_MAX_ATTEMPTS,
	logger = log,
} = {}) {
	if (!(await ensureNodeImpl({ runCommandImpl, logger }))) return false;

	logger.info("Installing the T3 Code headless server service...");
	if (!(await runCommandImpl(T3_SERVICE_INSTALL_COMMAND))) {
		logger.error(
			`T3 Code service installation failed. Retry with: ${T3_SERVICE_INSTALL_COMMAND}`,
		);
		return false;
	}
	if (!(await runCommandImpl(T3_SERVICE_STATUS_COMMAND))) {
		logger.error(
			`T3 Code service could not be verified. Retry with: ${T3_SERVICE_STATUS_COMMAND}`,
		);
		return false;
	}
	if (
		!(await ensureT3Connect({
			getConnectStatusImpl,
			runCommandImpl,
			sleepImpl,
			maxAttempts: maxConnectAttempts,
			logger,
		}))
	) {
		return false;
	}

	logger.success("T3 Code headless server service and T3 Connect are ready.");
	logger.info(
		"Open T3 Code on your phone and sign in to T3 Connect with the same account.",
	);
	return true;
}
