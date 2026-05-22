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
		const proc = spawn(useShell ? ["sh", "-c", command] : command.split(" "), {
			cwd: options.cwd,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});

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
	const proc = spawn(["which", command], {
		stdout: "ignore",
		stderr: "ignore",
	});
	const exitCode = await proc.exited;
	return exitCode === 0;
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

/** Prompt user for yes/no confirmation. */
export async function promptUser(message, initial = false) {
	await drainStdin();
	const { default: prompts } = await import("prompts");
	const response = await prompts({
		type: "confirm",
		name: "value",
		message: message,
		initial: initial,
	});
	return response.value;
}

/**
 * Copy `src` to `dest`, preserving any existing `dest` as `${dest}.bak` first.
 * Single rolling backup — re-running overwrites the previous .bak.
 */
export function safeCopyFile(src, dest) {
	if (fs.existsSync(dest)) {
		fs.copyFileSync(dest, `${dest}.bak`);
		log.info(`Backed up existing ${path.basename(dest)} to ${dest}.bak`);
	}
	fs.copyFileSync(src, dest);
}

/** Recursively copy a directory tree (files and nested dirs). */
export function copyDirRecursive(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirRecursive(srcPath, destPath);
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
 * Read deviceType from ~/.haoshoku.json (populated by `haoshoku --hyprland`'s
 * promptDeviceType). Returns the literal string if it's a known variant
 * (`"pc"` or `"laptop"`); otherwise returns `DEFAULT_DEVICE_TYPE` (`"pc"`).
 * This fallback is for config families where the PC variant is the safest
 * mainstream default. Hardware-specific flows that must not guess (for example
 * WirePlumber audio routing) should call readConfiguredDeviceType() instead.
 */
export function readDeviceType(home) {
	return readConfiguredDeviceType(home) ?? DEFAULT_DEVICE_TYPE;
}
