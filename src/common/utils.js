import fs from "node:fs";
import path from "node:path";
import { spawn } from "bun";
import chalk from "chalk";

export const log = {
	info: (msg) => console.log(chalk.blue("ℹ ") + chalk.blue(msg)),
	success: (msg) => console.log(chalk.green("✔ ") + chalk.green(msg)),
	warning: (msg) => console.log(chalk.yellow("⚠ ") + chalk.yellow(msg)),
	error: (msg) => console.error(chalk.red("✖ ") + chalk.red(msg)),
	dim: (msg) => console.log(chalk.gray(msg)),
};

export async function runCommand(command, options = { check: true }) {
	log.dim(`Executing: ${command}`);

	// Auto-detect shell usage if not explicitly set
	const useShell =
		options.shell ||
		["|", "&&", ";", ">", "<", "*", "?", "$", '"', "'"].some((char) =>
			command.includes(char),
		);

	try {
		// Shell-routed commands run under bash with pipefail so a failing early
		// pipeline stage (e.g. `curl bad-url | sh`) surfaces as a non-zero exit
		// instead of POSIX sh's last-stage-only status, which masks broken
		// installs as success. Plain commands keep argv-splitting.
		const proc = spawn(
			useShell
				? ["bash", "-c", `set -o pipefail; ${command}`]
				: command.split(" "),
			{
				cwd: options.cwd,
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			},
		);

		const exitCode = await proc.exited;

		if (options.returnExitCode) return exitCode;

		if (options.check && exitCode !== 0) {
			log.error(`Command '${command}' failed with exit code ${exitCode}`);
			return false;
		}
		return exitCode === 0;
	} catch (error) {
		log.error(`Failed to execute command: ${command}`);
		console.error(error);
		if (options.returnExitCode) return 127;
		return false;
	}
}

export async function commandExists(command) {
	// Bun.which resolves PATH in-process — no external `which` binary (absent
	// from Arch's base set) and no spawn that could throw. Kept async because
	// callers await it.
	return Bun.which(command) !== null;
}

/** Drain stale stdin data (e.g. terminal escape sequences from subprocesses). */
async function drainStdin() {
	return new Promise((resolve) => {
		const onData = () => {};
		process.stdin.on("data", onData);
		process.stdin.resume();
		setTimeout(() => {
			process.stdin.removeListener("data", onData);
			process.stdin.pause();
			resolve();
		}, 300);
	});
}

/**
 * Prompt user for yes/no confirmation.
 *
 * On Ctrl+C the underlying `prompts` lib resolves `{}` (value `undefined`),
 * which a naive caller reads as "No" and barrels on with a destructive setup.
 * Instead we pass an `onCancel` handler that warns and aborts the process with
 * exit code 130 (SIGINT convention).
 *
 * `opts.promptFn` / `opts.exit` are injectable for tests; when `promptFn` is
 * injected we skip drainStdin so tests don't wait the 300ms drain.
 */
export async function promptUser(message, initial = false, opts = {}) {
	const exit = opts.exit ?? process.exit;
	const onCancel = () => {
		log.warning("Cancelled — aborting.");
		exit(130);
	};

	let promptFn = opts.promptFn;
	if (!promptFn) {
		await drainStdin();
		promptFn = (await import("prompts")).default;
	}

	const response = await promptFn(
		{
			type: "confirm",
			name: "value",
			message: message,
			initial: initial,
		},
		{ onCancel },
	);
	return response.value;
}

/**
 * Copy `src` to `dest` with separate first-capture and versioned backup slots.
 *
 * If `dest` already has bytes identical to `src`, this is a no-op and neither
 * backup is touched. Before replacing a differing `dest`,
 * `${dest}.haoshoku-first-capture` captures the original live bytes once;
 * safeCopyFile never replaces it. Existing `.orig` captures are migrated into
 * the new slot. The historical `${dest}.bak` path is also populated only when
 * absent for caller compatibility. Every differing deploy preserves the
 * immediately previous live bytes in `${dest}.bak.<timestamp>`, adding a
 * numeric suffix on collision.
 *
 * On an upgraded install that already has an old-code `.bak` but no first
 * capture, the next differing deploy captures whatever is live then; it cannot
 * recover an earlier original already destroyed by old releases. Backups are
 * intentionally not pruned, so later hand-edits remain recoverable.
 *
 * @returns {boolean} true if `dest` was written, false if it was already in sync
 */
export function safeCopyFile(src, dest, { now = Date.now } = {}) {
	if (fs.existsSync(dest)) {
		if (fs.readFileSync(dest).equals(fs.readFileSync(src))) {
			log.dim(`${path.basename(dest)} unchanged — skipping`);
			return false;
		}
		const backupMode = fs.statSync(dest).mode & 0o666;
		const firstCapture = `${dest}.haoshoku-first-capture`;
		if (!fs.existsSync(firstCapture)) {
			const legacyFirstCapture = `${dest}.orig`;
			try {
				fs.copyFileSync(
					fs.existsSync(legacyFirstCapture) ? legacyFirstCapture : dest,
					firstCapture,
					fs.constants.COPYFILE_EXCL,
				);
				fs.chmodSync(firstCapture, backupMode);
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
			}
		}
		const legacyBackup = `${dest}.bak`;
		if (!fs.existsSync(legacyBackup)) {
			try {
				fs.copyFileSync(dest, legacyBackup, fs.constants.COPYFILE_EXCL);
				fs.chmodSync(legacyBackup, backupMode);
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
			}
		}
		const backupBase = `${dest}.bak.${now()}`;
		let backup = backupBase;
		let collision = 0;
		while (true) {
			try {
				fs.copyFileSync(dest, backup, fs.constants.COPYFILE_EXCL);
				fs.chmodSync(backup, backupMode);
				break;
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
				collision += 1;
				backup = `${backupBase}.${collision}`;
			}
		}
		log.info(`Backed up existing ${path.basename(dest)} to ${backup}`);
	}
	fs.copyFileSync(src, dest);
	return true;
}

/**
 * Recursively copy a directory tree (files, nested dirs, and symlinks).
 * Set skipSymlinks to omit links while preserving the default copy behavior.
 */
export function copyDirRecursive(src, dest, options = {}) {
	const { skipSymlinks = false, onSkipSymlink } = options;
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isSymbolicLink()) {
			if (skipSymlinks) {
				fs.rmSync(destPath, { recursive: true, force: true });
				onSkipSymlink?.(srcPath);
				continue;
			}
			// Recreate the link verbatim instead of dereferencing it: a symlink
			// to a directory would crash copyFileSync with EISDIR, and a file
			// symlink would be silently dereferenced. lstat (not existsSync,
			// which follows links and misses dangling ones) clears any existing
			// dest first so re-runs don't throw EEXIST.
			if (fs.lstatSync(destPath, { throwIfNoEntry: false })) {
				fs.unlinkSync(destPath);
			}
			fs.symlinkSync(fs.readlinkSync(srcPath), destPath);
		} else if (entry.isDirectory()) {
			copyDirRecursive(srcPath, destPath, options);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

const KNOWN_DEVICE_TYPES = new Set(["pc", "laptop"]);
const DEFAULT_DEVICE_TYPE = "pc";

/** Return the explicitly configured known deviceType, or null when unset. */
export function readConfiguredDeviceType(home) {
	const stateFile = path.join(home, ".haoshoku.json");
	if (!fs.existsSync(stateFile)) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
		if (
			typeof parsed.deviceType === "string" &&
			KNOWN_DEVICE_TYPES.has(parsed.deviceType)
		) {
			return parsed.deviceType;
		}
	} catch (err) {
		log.warning(
			`Malformed ~/.haoshoku.json at ${stateFile}; treating deviceType as unset (${err?.message ?? err})`,
		);
	}
	return null;
}

/**
 * Read deviceType from ~/.haoshoku.json (populated during Omarchy setup or by
 * `haoshoku --device-type`). Returns the literal string if it's a known variant
 * (`"pc"` or `"laptop"`); otherwise returns `DEFAULT_DEVICE_TYPE` (`"pc"`).
 * This fallback is for config families where the PC variant is the safest
 * mainstream default. Hardware-specific flows that must not guess (for example
 * WirePlumber audio routing) should call readConfiguredDeviceType() instead.
 */
export function readDeviceType(home) {
	return readConfiguredDeviceType(home) ?? DEFAULT_DEVICE_TYPE;
}
