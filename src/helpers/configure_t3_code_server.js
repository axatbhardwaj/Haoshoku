import fs from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { ensureNode24Runtime } from "../common/node_24_runtime.js";
import { log, runCommand, runCommandCapture } from "../common/utils.js";
import { isT3NodeVersionSupported, prepareT3Cli } from "./t3_cli.js";
import { preflightT3Desktop } from "./t3_desktop_preflight.js";
import {
	ensureTailscaleOperator,
	SERVICE_ACTIVE_COMMAND,
	READINESS_ATTEMPTS,
	latestT3Stable,
	parseJson,
	shellQuote,
	waitForT3Tailscale,
	writeServiceDropIn,
} from "./t3_tailscale.js";

function getNodeVersion() {
	const result = Bun.spawnSync(["node", "--version"], {
		stderr: "ignore",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) return null;
	return new TextDecoder().decode(result.stdout).trim();
}

export { isT3NodeVersionSupported } from "./t3_cli.js";

export async function ensureT3NodeRuntime({
	getNodeVersionImpl = getNodeVersion,
	runCommandImpl = runCommand,
	logger = log,
} = {}) {
	return (
		(await ensureNode24Runtime({
			readRuntimeImpl: getNodeVersionImpl,
			isRuntimeSupported: isT3NodeVersionSupported,
			runInstallStepImpl: (step) => runCommandImpl(step.command),
			installMessage: (currentVersion) =>
				`Installing a T3 Code-compatible Node.js runtime (current: ${currentVersion ?? "missing"})...`,
			incompatibleMessage: (installedVersion) =>
				`Node.js ${installedVersion ?? "is still unavailable"}; T3 Code requires ^22.16, ^23.11, or >=24.10.`,
			logger,
		})) !== null
	);
}

function writeServiceDropIns(home, uid, fsImpl) {
	writeServiceDropIn(
		home,
		"axstack-path.conf",
		'[Service]\nEnvironment="PATH=%h/.local/bin:%h/.bun/bin:%h/.grok/bin:/usr/local/bin:/usr/bin:/bin"\n',
		fsImpl,
	);
	writeServiceDropIn(
		home,
		"axstack-tailscale.conf",
		"[Service]\nEnvironment=T3CODE_TAILSCALE_SERVE=true\n",
		fsImpl,
	);
	for (const [name, content] of [
		["axstack-sandbox.conf", "[Service]\nEnvironment=IS_SANDBOX=1\n"],
		[
			"browser-sandbox.conf",
			"[Service]\nEnvironment=T3CODE_SERVER_BROWSER_SANDBOX=0\n",
		],
	]) {
		if (uid === 0) {
			writeServiceDropIn(home, name, content, fsImpl);
		} else {
			const file = path.join(
				home,
				".config/systemd/user/t3code.service.d",
				name,
			);
			if (fsImpl.existsSync(file)) fsImpl.unlinkSync(file);
		}
	}
}

export async function configureT3CodeServer({
	home = homedir(),
	uid = process.getuid(),
	user = userInfo().username,
	env = process.env,
	fsImpl = fs,
	ensureNodeImpl = ensureT3NodeRuntime,
	latestStableImpl = latestT3Stable,
	captureCommandImpl = runCommandCapture,
	runCommandImpl = runCommand,
	fetchImpl = fetch,
	sleepImpl = Bun.sleep,
	maxReadinessAttempts = READINESS_ATTEMPTS,
	logger = log,
} = {}) {
	const probe = async (command) => {
		try {
			const result = await captureCommandImpl(command, {
				expectFailure: true,
				shell: command.startsWith("command -v "),
			});
			return result.exitCode === 0 ? result.stdout.trim() : null;
		} catch {
			return null;
		}
	};
	const fail = (message) => {
		logger.error(message);
		return false;
	};

	if ((await probe("tailscale status")) === null) {
		return fail(
			"Tailscale must be installed and logged in before T3 setup. Run tailscale status and complete login yourself, then retry haoshoku --server-t3-code.",
		);
	}
	if (!(await ensureNodeImpl({ runCommandImpl, logger }))) return false;

	const prepared = await prepareT3Cli({ home, fsImpl, probe, runCommandImpl, latestStableImpl, fail });
	if (!prepared) return false;
	const { t3, latest, cliVersion } = prepared;

	const desktop = await preflightT3Desktop({
		home,
		env,
		fsImpl,
		captureCommandImpl,
		fail,
		stableVersion: latest,
		cliVersion,
	});
	if (!desktop) return false;
	const connectStatusCommand = `${t3} connect status --json`;
	const connect = parseJson(await probe(connectStatusCommand));
	if (typeof connect?.desired !== "boolean") {
		return fail(
			`Cannot verify Connect exposure. Inspect: ${connectStatusCommand}`,
		);
	}
	if (connect.desired) {
		const unlink = `${t3} connect unlink`;
		if (!(await runCommandImpl(unlink))) {
			return fail(
				`Connect unlink failed; setup is incomplete. Retry: ${unlink}`,
			);
		}
		const unlinked = parseJson(await probe(connectStatusCommand));
		if (unlinked?.desired !== false) {
			return fail(
				`Connect is not confirmed disabled. Inspect: ${connectStatusCommand}`,
			);
		}
	}

	if (uid !== 0) {
		// Operator access gates HTTPS Serve, not local service installation.
		await ensureTailscaleOperator({
			user,
			probe,
			runCommandImpl,
			logger,
		});
	}

	try {
		writeServiceDropIns(home, uid, fsImpl);
	} catch (error) {
		return fail(
			`Cannot write T3 service drop-ins: ${error.message}. Fix permissions and retry haoshoku --server-t3-code.`,
		);
	}
	const serviceInstall = `${t3} service install --base-dir ${shellQuote(desktop.baseDir)}`;
	if (!(await runCommandImpl(serviceInstall))) {
		return fail(
			`T3 service installation failed. Retry with: ${serviceInstall}`,
		);
	}
	if (!(await runCommandImpl(SERVICE_ACTIVE_COMMAND))) {
		return fail(
			`T3 service is not active. Inspect with: ${SERVICE_ACTIVE_COMMAND}`,
		);
	}

	return waitForT3Tailscale({
		probe,
		t3,
		fetchImpl,
		sleepImpl,
		maxReadinessAttempts,
		logger,
		fail,
	});
}
