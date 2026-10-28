import { isEngineeringWorker } from "../common/device_type.js";
import fs from "node:fs";
import { homedir, hostname as getHostname, userInfo } from "node:os";
import path from "node:path";
import { loadFleet, readFleetStatus } from "../common/fleet.js";
import {
	log,
	readDeviceType,
	runCommand,
	runCommandCapture,
} from "../common/utils.js";
import { configureIosatellitePower } from "./configure_iosatellite_power.js";
import { prepareArchT3Cli } from "./t3_cli.js";
import { configureT3Op } from "./configure_t3_op.js";
import { preflightT3Desktop } from "./t3_desktop_preflight.js";
import {
	ensureTailscaleOperator,
	latestT3Stable,
	parseJson,
	SERVICE_ACTIVE_COMMAND,
	shellQuote,
	waitForT3Tailscale,
	writeServiceDropIn,
} from "./t3_tailscale.js";

/** Configure tailnet-only phone access after the Arch T3 package is installed. */
export async function configureTailscaleT3({
	home = homedir(),
	hostname = getHostname(),
	deviceType = readDeviceType(home),
	user = userInfo().username,
	env = process.env,
	fsImpl = fs,
	latestStableImpl = latestT3Stable,
	captureCommandImpl = runCommandCapture,
	runCommandImpl = runCommand,
	fetchImpl = fetch,
	sleepImpl = Bun.sleep,
	maxReadinessAttempts,
	logger = log,
} = {}) {
	const fail = (message) => {
		if (isEngineeringWorker(deviceType)) throw new Error(message);
		logger.warning(
			`${message} — continuing setup. Retry haoshoku --tailscale-t3.`,
		);
		return false;
	};
	const probe = async (command, options) => {
		const result = await captureCommandImpl(command, {
			...options,
			expectFailure: true,
		});
		return result.exitCode === 0 ? result.stdout.trim() : null;
	};
	const run = async (command, options) => {
		if (!(await runCommandImpl(command, options)))
			throw new Error(`Failed: ${command}`);
	};

	let step = "Tailscale";
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
		) {
			if (isEngineeringWorker(deviceType))
				return fail("Tailscale operator configuration failed");
			return false;
		}
		step = "T3 service";
		const stablePackage = await probe("pacman -Q t3code-bin");
		const nightlyPackage = await probe("pacman -Q t3code-nightly-bin");
		if (stablePackage !== null && nightlyPackage !== null) {
			logger.warning(
				`Both T3 packages are installed: ${stablePackage}; ${nightlyPackage}. Inspect t3code-bin and t3code-nightly-bin for conflicting installs.`,
			);
		}
		const { t3, latest, cliVersion, env: t3Env } = await prepareArchT3Cli({
			home, env, fsImpl, captureCommandImpl, runCommandImpl, latestStableImpl, logger,
		});

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
		step = "linger";
		if (!operator || operator === "root") {
			fail("linger requires a non-root setup user");
		} else {
			const lingerCommand = `loginctl show-user ${shellQuote(operator)} -p Linger`;
			const linger = await probe(lingerCommand);
			if (linger !== "Linger=yes") {
				await run(`sudo -n loginctl enable-linger ${shellQuote(operator)}`);
				if ((await probe(lingerCommand)) !== "Linger=yes")
					return fail("linger was not enabled after enable-linger");
			}
		}
		if (isEngineeringWorker(deviceType)) {
			step = "sleep mask";
			const targets = [
				"sleep.target",
				"suspend.target",
				"hibernate.target",
				"hybrid-sleep.target",
				"suspend-then-hibernate.target",
			];
			const unmasked = [];
			const maskCommand = (target) =>
				`systemctl show ${target} --property=UnitFileState --value`;
			for (const target of targets) {
				const state = await probe(maskCommand(target));
				if (!state) return fail(`sleep mask: cannot verify ${target}`);
				if (state !== "masked") unmasked.push(target);
			}
			if (unmasked.length) {
				await run(`sudo -n systemctl mask ${unmasked.join(" ")}`);
				for (const target of unmasked)
					if ((await probe(maskCommand(target))) !== "masked")
						return fail(`sleep mask: ${target} was not masked`);
			}
		}
		if (deviceType === "iosatellite") {
			step = "lid policy";
			await configureIosatellitePower({
				fsImpl,
				runCommandImpl,
				captureCommandImpl,
				logger,
			});
		}
		step = "T3 service";
		let changed = writeServiceDropIn(
			home,
			"axstack-tailscale.conf",
			'[Service]\nEnvironment="T3CODE_TAILSCALE_SERVE=true"\n',
			fsImpl,
		);
		changed =
			writeServiceDropIn(
				home,
				"axstack-path.conf",
				'[Service]\nEnvironment="PATH=%h/.local/bin:%h/.bun/bin:%h/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin"\n',
				fsImpl,
			) || changed;
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
		if (!installed || desktop.serviceNeedsUpdate) {
			await run(`${t3} service install --base-dir ${shellQuote(desktop.baseDir)}`, { env: t3Env });
		} else {
			if (changed) await run("systemctl --user daemon-reload");
			const enabled = await probe(
				"systemctl --user is-enabled --quiet t3code.service",
			);
			const active = await probe(SERVICE_ACTIVE_COMMAND);
			if (enabled === null || active === null) {
				await run("systemctl --user enable --now t3code.service");
			}
			if (changed && active !== null)
				await run(
					`${t3} service restart --base-dir ${shellQuote(desktop.baseDir)}`,
					{ env: t3Env },
				);
		}
		if ((await probe(SERVICE_ACTIVE_COMMAND)) === null) {
			return fail(
				"T3 service is not active. Inspect systemctl --user status t3code.service",
			);
		}
		const ready = await waitForT3Tailscale({
			probe,
			fetchImpl,
			sleepImpl,
			maxReadinessAttempts,
			logger,
			fail,
			retryFlag: "--tailscale-t3",
			tailnetOnly: true,
		});
		if (ready && isEngineeringWorker(deviceType)) {
			step = "1Password token drop-in";
			await configureT3Op({ home, fsImpl, runCommandImpl, logger });
		}
		if (ready)
			await printFleetPairings({
				hostname,
				baseDir: desktop.baseDir,
				t3, env: t3Env,
				captureCommandImpl,
				logger,
			});
		return ready;
	} catch (error) {
		if (isEngineeringWorker(deviceType))
			throw new Error(`${step} failed: ${error.message}`);
		return fail(`${step} configuration failed: ${error.message}`);
	}
}

async function printFleetPairings({
	t3, env,
	hostname,
	baseDir,
	captureCommandImpl,
	logger,
}) {
	const fleet = loadFleet();
	if (
		!fleet.hosts.some(
			(host) => host.hostname === hostname && host.os === "arch",
		)
	)
		return;
	try {
		await readFleetStatus({ fleet, captureCommandImpl });
	} catch {
		logger.warning(
			`Skipping fleet pairing: Tailscale must be Running on ${fleet.tailnet}.`,
		);
		return;
	}
	for (const client of fleet.hosts.filter(
		(host) =>
			host.hostname !== hostname && ["control", "access"].includes(host.role),
	)) {
		try {
			const result = await captureCommandImpl(
				`${t3} pair --tailscale --base-dir ${shellQuote(baseDir)} --ttl 15m --label ${shellQuote(client.hostname)}`,
				{ env, log: false, stdin: "ignore", expectFailure: true },
			);
			const link = /^Pairing URL: (https:\/\/\S+)$/m.exec(result.stdout)?.[1];
			if (result.exitCode !== 0 || !link) throw new Error("mint failed");
			logger.info(
				`${client.hostname}: ${link} (expires in 15 minutes; paste in Add environment)`,
			);
		} catch {
			logger.warning(
				`Could not mint fleet pairing link for ${client.hostname}. Retry: t3 pair --tailscale --base-dir ${shellQuote(baseDir)} --ttl 15m --label ${shellQuote(client.hostname)}`,
			);
		}
	}
}
