import fs from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import {
	log,
	readDeviceType,
	runCommand,
	runCommandCapture,
} from "../common/utils.js";
import { configureT3Op } from "./configure_t3_op.js";
import { preflightT3Desktop } from "./t3_desktop_preflight.js";
import {
	ensureTailscaleOperator,
	meetsT3Floor,
	parseJson,
	SERVICE_ACTIVE_COMMAND,
	shellQuote,
	T3_VERSION_FLOOR,
	waitForT3Tailscale,
	writeServiceDropIn,
} from "./t3_tailscale.js";

/** Configure tailnet-only phone access after the Arch T3 package is installed. */
export async function configureTailscaleT3({
	home = homedir(),
	deviceType = readDeviceType(home),
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
		if (deviceType === "iobox") throw new Error(message);
		logger.warning(
			`${message} — continuing setup. Retry haoshoku --tailscale-t3.`,
		);
		return false;
	};
	const probe = async (command, options) => {
		const result = await captureCommandImpl(command, options);
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
			if (deviceType === "iobox")
				return fail("Tailscale operator configuration failed");
			return false;
		}
		step = "T3 service";
		const version = await probe("t3 --version");
		const resolved = await probe("command -v t3", { shell: true });
		if (resolved && resolved !== "/usr/bin/t3") {
			const packagedVersion = await probe("/usr/bin/t3 --version");
			logger.warning(
				`T3 on PATH is ${resolved} (${version ?? "unknown version"}), shadowing packaged /usr/bin/t3 (${packagedVersion ?? "unknown version"}). Inspect these installs.`,
			);
		}
		const stablePackage = await probe("pacman -Q t3code-bin");
		const nightlyPackage = await probe("pacman -Q t3code-nightly-bin");
		if (stablePackage !== null && nightlyPackage !== null) {
			logger.warning(
				`Both T3 packages are installed: ${stablePackage}; ${nightlyPackage}. Inspect t3code-bin and t3code-nightly-bin for conflicting installs.`,
			);
		}
		if (!meetsT3Floor(version)) {
			return fail(
				`T3 must be >= ${T3_VERSION_FLOOR}; install/update t3code-nightly-bin and ensure t3 is on PATH`,
			);
		}

		const desktop = await preflightT3Desktop({
			home,
			env,
			fsImpl,
			captureCommandImpl,
			fail,
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
		if (deviceType === "iobox") {
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
		if (!installed) {
			await run(`t3 service install --base-dir ${shellQuote(desktop.baseDir)}`);
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
					`t3 service restart --base-dir ${shellQuote(desktop.baseDir)}`,
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
		if (ready && deviceType === "iobox") {
			step = "1Password token drop-in";
			await configureT3Op({ home, fsImpl, runCommandImpl, logger });
		}
		return ready;
	} catch (error) {
		if (deviceType === "iobox")
			throw new Error(`${step} failed: ${error.message}`);
		return fail(`${step} configuration failed: ${error.message}`);
	}
}
