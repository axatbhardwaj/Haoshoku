import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { shellQuote } from "./t3_tailscale.js";

const DROP_IN = "/etc/systemd/logind.conf.d/90-haoshoku-iosatellite.conf";
const LID_KEYS = [
	"HandleLidSwitch",
	"HandleLidSwitchExternalPower",
	"HandleLidSwitchDocked",
];
const CONTENT = `# Managed by Haoshoku: iosatellite always-awake worker\n[Login]\n${LID_KEYS.map((key) => `${key}=ignore`).join("\n")}\n`;

// cat-config supplies logind's file precedence; only active [Login] assignments count.
function lidSettings(config) {
	let section;
	const settings = new Map();
	for (const raw of config.split("\n")) {
		const line = raw.trim();
		if (!line || /^[#;]/.test(line)) continue;
		if (line.startsWith("[")) section = line;
		else if (section === "[Login]") {
			const match =
				/^(HandleLidSwitch(?:ExternalPower|Docked)?)\s*=\s*(.*?)\s*$/.exec(
					line,
				);
			if (match) settings.set(match[1], match[2]);
		}
	}
	return settings;
}

/** Install without restarting logind: a restart can disrupt graphical sessions. */
export async function configureIosatellitePower({
	fsImpl = fs,
	tmpDir = tmpdir(),
	runCommandImpl,
	captureCommandImpl,
	logger,
}) {
	const run = async (command) => {
		if (!(await runCommandImpl(command))) throw new Error(`Failed: ${command}`);
	};
	const inspect = async (command) => {
		const result = await captureCommandImpl(command, { expectFailure: true });
		if (result.exitCode !== 0)
			throw new Error(`Cannot verify lid policy: ${command}`);
		return result.stdout;
	};
	let previous;
	try {
		previous = fsImpl.readFileSync(DROP_IN, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (previous !== CONTENT) {
		const stageDir = fsImpl.mkdtempSync(
			path.join(tmpDir, "haoshoku-iosatellite-"),
		);
		const stage = path.join(stageDir, "logind.conf");
		try {
			fsImpl.writeFileSync(stage, CONTENT, { mode: 0o600 });
			await run(
				"sudo -n install -d -o root -g root -m 0755 /etc/systemd/logind.conf.d",
			);
			await run(
				`sudo -n install -o root -g root -m 0644 ${shellQuote(stage)} ${shellQuote(DROP_IN)}`,
			);
			if (fsImpl.readFileSync(DROP_IN, "utf8") !== CONTENT)
				throw new Error(
					"Managed logind lid drop-in was not installed correctly",
				);
		} finally {
			if (fsImpl.existsSync(stage)) fsImpl.unlinkSync(stage);
			fsImpl.rmdirSync(stageDir);
		}
	}
	const effective = lidSettings(
		await inspect("systemd-analyze cat-config systemd/logind.conf"),
	);
	for (const key of LID_KEYS) {
		if (effective.get(key) !== "ignore")
			throw new Error(
				`${key} is not ignore in effective logind configuration; resolve conflicting drop-ins before reboot`,
			);
	}
	let rebootRequired = false;
	for (const key of LID_KEYS) {
		const value = await inspect(
			`busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager ${key}`,
		);
		if (!/^s "[^"\n]*"$/.test(value.trim()))
			throw new Error(
				`Cannot read running logind ${key}; inspect systemd-logind before relying on lid policy`,
			);
		if (value.trim() !== 's "ignore"') rebootRequired = true;
	}
	if (rebootRequired)
		logger.warning(
			"Reboot required: iosatellite lid policy is saved but not active in logind. Keep the lid open, reboot, then rerun haoshoku --tailscale-t3; closed-lid readiness is unverified.",
		);
	else
		logger.info(
			"iosatellite logind lid ignores are active; real closed-lid AC job, SSH and T3 checks are still required.",
		);
	const inhibitors = await inspect(
		"systemd-inhibit --list --no-legend --no-pager",
	);
	if (/\bhandle-lid-switch\b/.test(inhibitors))
		logger.warning(
			"A desktop inhibitor owns handle-lid-switch; verify its lid policy and real closed-lid AC behavior before relying on this worker.",
		);
}
