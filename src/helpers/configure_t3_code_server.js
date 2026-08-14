import { log, runCommand } from "../common/utils.js";

const NODESOURCE_SETUP_COMMAND =
	"curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -";
const NODE_INSTALL_COMMAND = "sudo apt install -y nodejs";
const T3_SERVICE_INSTALL_COMMAND = "npx --yes t3@latest service install";
const T3_SERVICE_STATUS_COMMAND = "npx --yes t3@latest service status";

function getNodeVersion() {
	const result = Bun.spawnSync(["node", "--version"], {
		stderr: "ignore",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) return null;
	return new TextDecoder().decode(result.stdout).trim();
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

export async function configureT3CodeServer({
	ensureNodeImpl = ensureT3NodeRuntime,
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

	logger.success("T3 Code headless server service is installed and running.");
	logger.info("Pair a client later with: npx t3@latest pair");
	return true;
}
