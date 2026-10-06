import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PROJECT_ROOT } from "../common/paths.js";

import { log } from "../common/utils.js";

const HERMES_PROBE = String.raw`
import json
import os
import sys
from pathlib import Path

mode = sys.argv[1]
home = Path(sys.argv[2])

def private_env():
    values = {}
    try:
        for raw in (home / ".env").read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            values[key.strip()] = value
    except (OSError, UnicodeError):
        pass
    return values

def telegram_identity():
    import yaml
    data = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8")) or {}
    telegram = ((data.get("platforms") or {}).get("telegram") or {})
    channel = telegram.get("home_channel") or {}
    chat_id = channel.get("chat_id") if isinstance(channel, dict) else None
    env = private_env()
    chat_id = env.get("TELEGRAM_HOME_CHANNEL") or chat_id
    users = [item.strip() for item in env.get("TELEGRAM_ALLOWED_USERS", "").split(",") if item.strip()]
    if len(users) != 1 or str(chat_id or "").strip() != users[0]:
        return None
    return {"chatId": users[0], "userId": users[0]}

def telegram_credentials():
    return {"ready": bool(private_env().get("TELEGRAM_BOT_TOKEN", "").strip())}

def gateway_activity():
    from gateway.control_socket import query_gateway_control
    status = query_gateway_control(home, "status")
    if not isinstance(status, dict) or status.get("gateway_state") != "running":
        return {"activity": "unknown"}
    try:
        active = max(0, int(status.get("active_agents", 0)))
    except (TypeError, ValueError):
        return {"activity": "unknown"}
    return {"activity": "busy" if active else "idle"}

try:
    if mode == "telegram-identity":
        result = telegram_identity()
    elif mode == "telegram-credentials":
        result = telegram_credentials()
    else:
        result = gateway_activity()
except Exception:
    if mode == "telegram-identity":
        result = None
    elif mode == "telegram-credentials":
        result = {"ready": False}
    else:
        result = {"activity": "unknown"}
print(json.dumps(result, separators=(",", ":")))
`;

async function defaultRunProcess(argv, options = {}) {
	try {
		const child = Bun.spawn(argv, {
			cwd: options.cwd,
			env: options.env,
			stderr: options.stdio === "inherit" ? "inherit" : "pipe",
			stdin: options.stdio === "inherit" ? "inherit" : "ignore",
			stdout: options.stdio === "inherit" ? "inherit" : "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			child.stdout ? new Response(child.stdout).text() : "",
			child.stderr ? new Response(child.stderr).text() : "",
		]);
		return { exitCode, stdout, stderr };
	} catch (error) {
		return {
			exitCode: 127,
			stdout: "",
			stderr: error?.message ?? String(error),
		};
	}
}

function executableAt(candidate, fsImpl) {
	if (!candidate) return null;
	try {
		const stat = fsImpl.statSync(candidate);
		return stat.isFile() && (stat.mode & 0o111) !== 0 ? candidate : null;
	} catch {
		return null;
	}
}

function findExecutable(command, candidates, whichImpl, fsImpl) {
	return (
		whichImpl(command) ??
		candidates.map((item) => executableAt(item, fsImpl)).find(Boolean) ??
		null
	);
}

function findHermesPython(hermesHome, fsImpl) {
	return [
		"/usr/local/lib/hermes-agent/venv/bin/python",
		path.join(hermesHome, "hermes-agent", "venv", "bin", "python"),
	]
		.map((candidate) => executableAt(candidate, fsImpl))
		.find(Boolean);
}

async function runHermesProbe({
	mode,
	hermesHome,
	fsImpl,
	environment,
	runProcessImpl,
}) {
	const python = findHermesPython(hermesHome, fsImpl);
	if (!python) return null;
	const result = await runProcessImpl(
		[python, "-c", HERMES_PROBE, mode, hermesHome],
		{ env: { ...environment, HERMES_HOME: hermesHome } },
	);
	if (result.exitCode !== 0) return null;
	try {
		return JSON.parse(result.stdout);
	} catch {
		return null;
	}
}

function readJsonObject(file, fsImpl, logger) {
	try {
		const value = JSON.parse(fsImpl.readFileSync(file, "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new TypeError("root must be a JSON object");
		}
		return value;
	} catch (error) {
		logger.error(`Invalid ${file}; leaving it untouched (${error.message}).`);
		return null;
	}
}

function readHermesRuntimeLock(projectRoot, fsImpl, logger) {
	const lockPath = path.join(
		projectRoot,
		"configs",
		"hermes-relay",
		"hermes-runtime.json",
	);
	const lock = readJsonObject(lockPath, fsImpl, logger);
	if (
		!lock ||
		lock.version !== 1 ||
		lock.installer !== "https://hermes-agent.nousresearch.com/install.sh" ||
		!/^([0-9a-f]{40})$/.test(lock.commit)
	) {
		logger.error(`Invalid Hermes runtime lock ${lockPath}.`);
		return null;
	}
	return lock;
}

async function bootstrapHermes({
	projectRoot,
	hermesHome,
	fsImpl,
	whichImpl,
	runProcessImpl,
	environment,
	logger,
}) {
	const lock = readHermesRuntimeLock(projectRoot, fsImpl, logger);
	if (!lock) return false;
	const curl = findExecutable("curl", ["/usr/bin/curl"], whichImpl, fsImpl);
	const bash = findExecutable("bash", ["/usr/bin/bash"], whichImpl, fsImpl);
	if (!curl || !bash) {
		logger.error(
			"Hermes bootstrap requires curl and bash; configuration is incomplete.",
		);
		return false;
	}
	const cache = path.join(hermesHome, ".cache", "haoshoku");
	fsImpl.mkdirSync(cache, { recursive: true, mode: 0o700 });
	fsImpl.chmodSync(cache, 0o700);
	const temporary = fsImpl.mkdtempSync(path.join(cache, "hermes-install-"));
	const installer = path.join(temporary, "install.sh");
	try {
		const fetched = await runProcessImpl(
			[curl, "-fsSL", lock.installer, "-o", installer],
			{ env: environment },
		);
		if (fetched.exitCode !== 0) {
			logger.error(
				"Pinned Hermes bootstrap failed while fetching the installer.",
			);
			return false;
		}
		const installed = await runProcessImpl(
			[
				bash,
				installer,
				"--commit",
				lock.commit,
				"--skip-setup",
				"--skip-browser",
				"--skip-computer-use",
				"--non-interactive",
			],
			{ env: environment, stdio: "inherit" },
		);
		if (installed.exitCode !== 0) {
			logger.error(
				"Pinned Hermes bootstrap failed; configuration is incomplete.",
			);
			return false;
		}
		return true;
	} finally {
		fsImpl.rmSync(temporary, { recursive: true, force: true });
	}
}

export async function configureHermesRelay({
	home = homedir(),
	projectRoot = PROJECT_ROOT,
	fsImpl = fs,
	runProcessImpl = defaultRunProcess,
	environment = process.env,
	logger = log,
	whichImpl = (command) => Bun.which(command),
	hermesCandidates = [
		path.join(home, ".local", "bin", "hermes"),
		"/usr/local/bin/hermes",
	],
} = {}) {
	const hermesHome = environment.HERMES_HOME || path.join(home, ".hermes");
	let hermes = findExecutable("hermes", hermesCandidates, whichImpl, fsImpl);
	if (!hermes) {
		if (
			!(await bootstrapHermes({
				projectRoot,
				hermesHome,
				fsImpl,
				whichImpl,
				runProcessImpl,
				environment,
				logger,
			}))
		)
			return false;
		hermes = findExecutable("hermes", hermesCandidates, whichImpl, fsImpl);
		if (!hermes) {
			logger.error(
				"Hermes installer completed, but its CLI is unavailable; configuration is incomplete.",
			);
			return false;
		}
	}
	const version = await runProcessImpl([hermes, "--version"], {
		env: environment,
	});
	if (version.exitCode !== 0) {
		logger.error(
			"The existing Hermes CLI is not usable; it was not upgraded or replaced.",
		);
		return false;
	}
	if (!fsImpl.existsSync(path.join(hermesHome, "config.yaml"))) {
		logger.error(
			`Hermes setup is incomplete. Run hermes setup, configure Telegram, then retry: haoshoku --server-hermes-relay. Expected config: ${path.join(hermesHome, "config.yaml")}`,
		);
		return false;
	}
	const probeOptions = { hermesHome, fsImpl, environment, runProcessImpl };
	const credentials = await runHermesProbe({
		...probeOptions,
		mode: "telegram-credentials",
	});
	if (credentials?.ready !== true) {
		logger.error(
			`Hermes setup is incomplete. Set TELEGRAM_BOT_TOKEN in ${path.join(hermesHome, ".env")} without printing it, then retry: haoshoku --server-hermes-relay.`,
		);
		return false;
	}
	const telegram = await runHermesProbe({
		...probeOptions,
		mode: "telegram-identity",
	});
	const chatId = String(telegram?.chatId ?? "").trim();
	const userId = String(telegram?.userId ?? "").trim();
	if (!/^\d+$/.test(userId) || chatId !== userId) {
		logger.error(
			"Hermes setup is incomplete. Configure one TELEGRAM_ALLOWED_USERS owner and a matching private Telegram home channel, then retry: haoshoku --server-hermes-relay.",
		);
		return false;
	}
	const gateway = await runHermesProbe({
		...probeOptions,
		mode: "gateway-activity",
	});
	if (!["idle", "busy"].includes(gateway?.activity)) {
		logger.error(
			"Hermes gateway is not confirmed running. Install startup with hermes gateway install --no-start-now --start-on-login, verify the gateway manually, then retry: haoshoku --server-hermes-relay.",
		);
		return false;
	}
	logger.success("Hermes is ready for Telegram transport on this host.");
	return true;
}
