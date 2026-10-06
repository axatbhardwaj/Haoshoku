import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

const LOG_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.log$/;
const OUTPUT_LIMIT = 16_384;
let activeRun;

export function redactLog(value) {
	return stripVTControlCharacters(String(value))
		.replace(
			/\b(?:ghp_|gho_|github_pat_|sk-|tskey-)[A-Za-z0-9_-]+/g,
			"[REDACTED]",
		)
		.replace(/\bBearer\s+[^\s"'\\]+/gi, "Bearer [REDACTED]")
		.replace(
			/(\b(?:[A-Z_]*_)?(?:password|token)\s*=\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s&;"'\\]+)/gi,
			"$1[REDACTED]",
		)
		.replace(/https:\/\/login\.tailscale\.com\/a\/[^\s"'\\]+/gi, "[REDACTED]");
}

export function logDirectory(env = process.env) {
	return path.join(
		env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(), ".local/state"),
		"haoshoku/logs",
	);
}

export function listRunLogs(dir) {
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && LOG_NAME.test(entry.name))
		.map((entry) => entry.name)
		.sort();
}

function readOptional(file) {
	try {
		return fs.readFileSync(file, "utf8").trim();
	} catch {
		return "unknown";
	}
}

/** Redact before bounding output, so truncation cannot expose a token suffix. */
function bounded(value) {
	const safe = redactLog(value);
	return safe.length <= OUTPUT_LIMIT
		? safe
		: `${safe.slice(0, OUTPUT_LIMIT)}\n[output capped]`;
}

export function startRunLog({
	version,
	argv = process.argv,
	env = process.env,
	now = new Date(),
	fsImpl = fs,
	warn = console.warn,
} = {}) {
	let warned = false;
	let writable = true;
	const unavailable = () => {
		writable = false;
		if (!warned) {
			warned = true;
			try {
				warn("Run logging unavailable; continuing without a log.");
			} catch {
				/* best effort */
			}
		}
	};
	const dir = logDirectory(env);
	const run = {
		path: null,
		failures: new Set(),
		write(value) {
			if (!writable) return;
			try {
				fsImpl.appendFileSync(run.path, `${bounded(value)}\n`);
			} catch {
				unavailable();
			}
		},
	};
	activeRun = run;
	try {
		fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
		if (fsImpl.lstatSync(dir).isSymbolicLink())
			throw new Error("Symlink log directory");
		fsImpl.chmodSync(dir, 0o700);
		// Exclusive creation preserves earlier runs even within the same millisecond.
		for (let offset = 0; offset < 100; offset++) {
			const filename = `${new Date(now.getTime() + offset).toISOString().replaceAll(":", "-")}.log`;
			try {
				const file = path.join(dir, filename);
				const fd = fsImpl.openSync(file, "wx", 0o600);
				fsImpl.closeSync(fd);
				run.path = file;
				break;
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
			}
		}
		if (!run.path) throw new Error("Log timestamp exhausted");
		for (const old of listRunLogs(dir).slice(0, -20))
			fsImpl.unlinkSync(path.join(dir, old));
		const osRelease = readOptional("/etc/os-release");
		const field = (key) =>
			osRelease
				.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]
				?.replace(/^"|"$/g, "") || "unknown";
		const omarchyRoot = path.join(
			env.HOME || os.homedir(),
			".local/share/omarchy",
		);
		const omarchy = fs.existsSync(omarchyRoot) || Bun.which("omarchy") !== null;
		run.write(
			`Haoshoku ${version}\nArgv: ${JSON.stringify(argv)}\nDate: ${now.toISOString()}\nOS NAME: ${field("NAME")}\nOS VERSION: ${field("VERSION")}\nOmarchy: ${omarchy ? `present (${readOptional(path.join(omarchyRoot, "version"))})` : "absent"}\nKernel: ${os.release()}\nArch: ${os.arch()}\nRuntime: ${import.meta.dir.startsWith("/$bunfs/") ? "compiled binary" : "source"}`,
		);
	} catch {
		unavailable();
	}
	return run;
}

export function recordOutput(level, message, failure = true) {
	activeRun?.write(`[${level}] ${message}`);
	if (level === "error" && failure) activeRun?.failures.add(redactLog(message));
}
