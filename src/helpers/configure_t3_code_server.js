import { commandExists, log, runCommand } from "../common/utils.js";

const NODESOURCE_SETUP_COMMAND =
	"curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -";
const NODE_INSTALL_COMMAND = "sudo apt install -y nodejs";
const T3_SERVICE_INSTALL_COMMAND = "npx --yes t3@latest service install";
const T3_SERVICE_STATUS_COMMAND = "npx --yes t3@latest service status";
const T3_TAILSCALE_PAIR_COMMAND = "npx --yes t3@latest pair --tailscale";
const TAILSCALE_SERVE_STATUS_COMMAND = "tailscale serve status";
const TAILSCALE_INSTALL_COMMAND =
	"curl -fsSL https://tailscale.com/install.sh | sh";

function getNodeVersion() {
	const result = Bun.spawnSync(["node", "--version"], {
		stderr: "ignore",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) return null;
	return new TextDecoder().decode(result.stdout).trim();
}

function getProcessUserContext() {
	if (process.getuid?.() === 0) return { isRoot: true, username: null };

	const result = Bun.spawnSync(["id", "-un"], {
		stderr: "ignore",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) return { isRoot: false, username: null };
	return {
		isRoot: false,
		username: new TextDecoder().decode(result.stdout).trim(),
	};
}

function getTailscaleBackendState() {
	const result = Bun.spawnSync(["tailscale", "status", "--json"], {
		stderr: "ignore",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) return null;
	return parseTailscaleBackendState(
		new TextDecoder().decode(result.stdout).trim(),
	);
}

export function parseTailscaleBackendState(output) {
	try {
		const state = JSON.parse(output)?.BackendState;
		return typeof state === "string" ? state : null;
	} catch {
		return null;
	}
}

export function parseT3ConnectStatus(output) {
	try {
		const value = JSON.parse(output);
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
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

export function isSafeUnixUsername(username) {
	return (
		typeof username === "string" && /^[a-z_][a-z0-9_-]*\$?$/i.test(username)
	);
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

export async function ensureTailscaleService({
	commandExistsImpl = commandExists,
	getBackendStateImpl = getTailscaleBackendState,
	getUserContextImpl = getProcessUserContext,
	runCommandImpl = runCommand,
	logger = log,
} = {}) {
	if (!(await commandExistsImpl("tailscale"))) {
		logger.info("Installing Tailscale for private T3 Code access...");
		if (!(await runCommandImpl(TAILSCALE_INSTALL_COMMAND))) {
			logger.error(
				`Tailscale installation failed. Retry with: ${TAILSCALE_INSTALL_COMMAND}`,
			);
			return false;
		}
		if (!(await commandExistsImpl("tailscale"))) {
			logger.error("Tailscale was installed but its CLI is still unavailable.");
			return false;
		}
	}

	const userContext = await getUserContextImpl();
	const privilegePrefix = userContext.isRoot ? "" : "sudo ";
	const enableCommand = `${privilegePrefix}systemctl enable --now tailscaled`;
	const enabledCommand = `${privilegePrefix}systemctl is-enabled tailscaled`;
	const activeCommand = `${privilegePrefix}systemctl is-active tailscaled`;

	if (!(await runCommandImpl(enableCommand))) {
		logger.error(
			`Could not enable and start tailscaled. Retry with: ${enableCommand}`,
		);
		return false;
	}
	if (!(await runCommandImpl(enabledCommand))) {
		logger.error(
			`tailscaled is not enabled at boot. Retry with: ${enabledCommand}`,
		);
		return false;
	}
	if (!(await runCommandImpl(activeCommand))) {
		logger.error(`tailscaled is not running. Retry with: ${activeCommand}`);
		return false;
	}

	if ((await getBackendStateImpl()) !== "Running") {
		const upCommand = `${privilegePrefix}tailscale up`;
		logger.info("Connecting this server to its Tailnet...");
		if (!(await runCommandImpl(upCommand))) {
			logger.error(`Tailscale authentication failed. Retry with: ${upCommand}`);
			return false;
		}
		if ((await getBackendStateImpl()) !== "Running") {
			logger.error(
				`Tailscale is not connected after authentication. Retry with: ${upCommand}`,
			);
			return false;
		}
	}

	if (!userContext.isRoot) {
		if (!isSafeUnixUsername(userContext.username)) {
			logger.error(
				"Could not resolve a safe Unix username for Tailscale operator access.",
			);
			return false;
		}
		const operatorCommand = `sudo tailscale set --operator=${userContext.username}`;
		if (!(await runCommandImpl(operatorCommand))) {
			logger.error(
				`Could not grant Tailscale operator access. Retry with: ${operatorCommand}`,
			);
			return false;
		}
	}

	return true;
}

export async function configureT3CodeServer({
	ensureNodeImpl = ensureT3NodeRuntime,
	ensureTailscaleImpl = ensureTailscaleService,
	runCommandImpl = runCommand,
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
	if (!(await ensureTailscaleImpl({ runCommandImpl, logger }))) return false;

	logger.info("Creating a private Tailscale pairing endpoint...");
	if (!(await runCommandImpl(T3_TAILSCALE_PAIR_COMMAND))) {
		logger.error(
			`T3 Code Tailscale pairing failed. Retry with: ${T3_TAILSCALE_PAIR_COMMAND}`,
		);
		return false;
	}
	if (!(await runCommandImpl(TAILSCALE_SERVE_STATUS_COMMAND))) {
		logger.error(
			`Tailscale Serve could not be verified. Retry with: ${TAILSCALE_SERVE_STATUS_COMMAND}`,
		);
		return false;
	}

	logger.success(
		"T3 Code and Tailscale are running persistently with private Tailnet access.",
	);
	logger.info(
		"For unattended VPS access, disable key expiry for this device or use an appropriately tagged server auth key.",
	);
	return true;
}
