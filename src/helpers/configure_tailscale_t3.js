import fs from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { log, runCommand, runCommandCapture } from "../common/utils.js";
import {
	ensureTailscaleOperator,
	meetsT3Floor,
	parseJson,
	SERVICE_ACTIVE_COMMAND,
	shellQuote,
	T3_VERSION_FLOOR,
	waitForT3Tailscale,
	writeTailscaleDropIn,
} from "./t3_tailscale.js";

/** Configure tailnet-only phone access after the Arch T3 package is installed. */
export async function configureTailscaleT3({
	home = homedir(),
	user = userInfo().username,
	env = process.env,
	fsImpl = fs,
	captureCommandImpl = runCommandCapture,
	runCommandImpl = runCommand,
	fetchImpl = fetch,
	sleepImpl = Bun.sleep,
	maxReadinessAttempts,
	logger = log,
} = {}) {
	const fail = (message) => {
		logger.warning(
			`${message} — continuing setup. Retry haoshoku --tailscale-t3.`,
		);
		return false;
	};
	const probe = async (command) => {
		const result = await captureCommandImpl(command);
		return result.exitCode === 0 ? result.stdout.trim() : null;
	};
	const run = async (command, options) => {
		if (!(await runCommandImpl(command, options)))
			throw new Error(`Failed: ${command}`);
	};

	try {
		if ((await probe("pacman -Q tailscale")) === null) {
			await run("sudo -n pacman -S --needed --noconfirm tailscale");
		}
		if (
			(await probe("systemctl is-enabled --quiet tailscaled.service")) ===
				null ||
			(await probe("systemctl is-active --quiet tailscaled.service")) === null
		) {
			await run("sudo -n systemctl enable --now tailscaled.service");
		}
		let status = parseJson(await probe("tailscale status --json"));
		if (status?.BackendState === "NeedsLogin") {
			logger.info(
				"Tailscale browser login: open the login URL printed below; waiting for login to complete...",
			);
			await run("sudo -n tailscale up", {
				stdout: "inherit",
				stderr: "inherit",
			});
			status = parseJson(await probe("tailscale status --json"));
		}
		if (status?.BackendState !== "Running") {
			return fail(
				"Tailscale is not logged in and running. Inspect tailscale status",
			);
		}
		const operator =
			user === "root" && env.SUDO_USER && env.SUDO_USER !== "root"
				? env.SUDO_USER
				: user;
		if (
			!(await ensureTailscaleOperator({
				user: operator,
				retryFlag: "--tailscale-t3",
				probe,
				runCommandImpl,
				logger,
			}))
		)
			return false;
		if (!meetsT3Floor(await probe("t3 --version"))) {
			return fail(
				`T3 must be >= ${T3_VERSION_FLOOR}; install/update t3code-nightly-bin and ensure t3 is on PATH`,
			);
		}

		const changed = writeTailscaleDropIn(home, fsImpl);
		let installed = true;
		try {
			fsImpl.readFileSync(
				path.join(home, ".config/systemd/user/t3code.service"),
				"utf8",
			);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			installed = false;
		}
		if (!installed) {
			await run(
				`t3 service install --base-dir ${shellQuote(path.join(home, ".t3"))}`,
			);
		} else {
			if (changed) await run("systemctl --user daemon-reload");
			const enabled = await probe(
				"systemctl --user is-enabled --quiet t3code.service",
			);
			const active = await probe(SERVICE_ACTIVE_COMMAND);
			if (enabled === null || active === null) {
				await run("systemctl --user enable --now t3code.service");
			}
			if (changed && active !== null) await run("t3 service restart");
		}
		if ((await probe(SERVICE_ACTIVE_COMMAND)) === null) {
			return fail(
				"T3 service is not active. Inspect systemctl --user status t3code.service",
			);
		}
		return await waitForT3Tailscale({
			probe,
			fetchImpl,
			sleepImpl,
			maxReadinessAttempts,
			logger,
			fail,
			retryFlag: "--tailscale-t3",
			tailnetOnly: true,
		});
	} catch (error) {
		return fail(`Tailscale/T3 configuration failed: ${error.message}`);
	}
}
