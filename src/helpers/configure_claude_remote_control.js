import fs from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const USER_DEFAULT = userInfo().username;
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");
const SCRIPT = "haoshoku-claude-remote-control";
const UNIT = "claude-remote-control@.service";
const TRUST_WRITE_ATTEMPTS = 3;
export const CLAUDE_REMOTE_CONTROL_INSTANCES = Object.freeze([
	Object.freeze({ instance: "io", relativeRoot: "." }),
	Object.freeze({ instance: "dev", relativeRoot: "dev" }),
	Object.freeze({ instance: "work", relativeRoot: "Work" }),
]);
let atomicWriteSequence = 0;

class ConcurrentStateChangeError extends Error {}

function stateSnapshot(target, fsImpl) {
	try {
		const stats = fsImpl.statSync(target);
		return {
			exists: true,
			dev: stats.dev,
			ino: stats.ino,
			mode: stats.mode,
			size: stats.size,
			mtimeMs: stats.mtimeMs,
			ctimeMs: stats.ctimeMs,
		};
	} catch (error) {
		if (error.code === "ENOENT") return { exists: false };
		throw error;
	}
}

function stateSnapshotsMatch(left, right) {
	return (
		left.exists === right.exists &&
		(!left.exists ||
			(left.dev === right.dev &&
				left.ino === right.ino &&
				left.mode === right.mode &&
				left.size === right.size &&
				left.mtimeMs === right.mtimeMs &&
				left.ctimeMs === right.ctimeMs))
	);
}

function atomicWriteState(target, content, fsImpl, expectedSnapshot) {
	const mode = expectedSnapshot.exists ? expectedSnapshot.mode & 0o777 : 0o600;
	const temporary = path.join(
		path.dirname(target),
		`.${path.basename(target)}.tmp-${process.pid}-${++atomicWriteSequence}`,
	);
	try {
		fsImpl.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
		fsImpl.chmodSync(temporary, mode);
		if (!stateSnapshotsMatch(expectedSnapshot, stateSnapshot(target, fsImpl))) {
			throw new ConcurrentStateChangeError();
		}
		fsImpl.renameSync(temporary, target);
	} catch (error) {
		try {
			if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
		} catch {
			// Preserve the original write failure.
		}
		throw error;
	}
}

function skipWhitespace(source, start) {
	let index = start;
	while (/\s/.test(source[index] ?? "")) index += 1;
	return index;
}

function parseStringNode(source, start) {
	let index = start + 1;
	while (index < source.length) {
		if (source[index] === "\\") {
			index += 2;
			continue;
		}
		if (source[index] === '"') {
			const end = index + 1;
			return {
				type: "string",
				start,
				end,
				value: JSON.parse(source.slice(start, end)),
			};
		}
		index += 1;
	}
	throw new SyntaxError("Unterminated JSON string");
}

function parseNode(source, start = 0) {
	const index = skipWhitespace(source, start);
	const character = source[index];
	if (character === '"') return parseStringNode(source, index);

	if (character === "{") {
		const properties = [];
		let cursor = skipWhitespace(source, index + 1);
		while (source[cursor] !== "}") {
			const keyNode = parseStringNode(source, cursor);
			cursor = skipWhitespace(source, keyNode.end);
			if (source[cursor] !== ":") throw new SyntaxError("Missing colon");
			const value = parseNode(source, cursor + 1);
			properties.push({
				key: keyNode.value,
				start: keyNode.start,
				end: value.end,
				value,
			});
			cursor = skipWhitespace(source, value.end);
			if (source[cursor] === ",") {
				cursor = skipWhitespace(source, cursor + 1);
				continue;
			}
			if (source[cursor] !== "}") throw new SyntaxError("Missing object end");
		}
		return { type: "object", start: index, end: cursor + 1, properties };
	}

	if (character === "[") {
		let cursor = skipWhitespace(source, index + 1);
		while (source[cursor] !== "]") {
			const value = parseNode(source, cursor);
			cursor = skipWhitespace(source, value.end);
			if (source[cursor] === ",") {
				cursor = skipWhitespace(source, cursor + 1);
				continue;
			}
			if (source[cursor] !== "]") throw new SyntaxError("Missing array end");
		}
		return { type: "array", start: index, end: cursor + 1 };
	}

	let end = index;
	while (end < source.length && !/[\s,}\]]/.test(source[end])) end += 1;
	return { type: "literal", start: index, end };
}

function parseRoot(source) {
	JSON.parse(source);
	const root = parseNode(source);
	if (root.type !== "object") throw new SyntaxError("Root must be an object");
	return root;
}

function property(objectNode, key) {
	return objectNode.properties.find((candidate) => candidate.key === key);
}

function replaceRange(source, start, end, replacement) {
	return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function insertProperty(source, objectNode, key, value) {
	const serialized = `${JSON.stringify(key)}:${value}`;
	if (objectNode.properties.length === 0) {
		return replaceRange(
			source,
			objectNode.start + 1,
			objectNode.start + 1,
			serialized,
		);
	}

	const last = objectNode.properties.at(-1);
	const lineStart = source.lastIndexOf("\n", last.start - 1) + 1;
	const prefix = source.slice(lineStart, last.start);
	const separator = /^[\t ]*$/.test(prefix) ? `,\n${prefix}` : ",";
	return replaceRange(
		source,
		last.value.end,
		last.value.end,
		`${separator}${serialized}`,
	);
}

function sessionInstances(home) {
	return CLAUDE_REMOTE_CONTROL_INSTANCES.map(({ instance, relativeRoot }) => ({
		instance,
		relativeRoot,
		root: path.resolve(home, relativeRoot),
		unit: `claude-remote-control@${instance}.service`,
	}));
}

function trustState(roots) {
	return {
		bypassPermissionsModeAccepted: true,
		projects: Object.fromEntries(
			roots.map((root) => [root, { hasTrustDialogAccepted: true }]),
		),
	};
}

function applyTrustState(source, roots) {
	let root = parseRoot(source);
	const projectsProperty = property(root, "projects");
	if (!projectsProperty) {
		const projects = JSON.stringify(trustState(roots).projects);
		source = insertProperty(source, root, "projects", projects);
	} else if (projectsProperty.value.type !== "object") {
		throw new SyntaxError("projects must be an object");
	}

	let projects;
	for (const projectRoot of roots) {
		root = parseRoot(source);
		projects = property(root, "projects").value;
		const project = property(projects, projectRoot);
		if (!project) {
			source = insertProperty(
				source,
				projects,
				projectRoot,
				'{"hasTrustDialogAccepted":true}',
			);
			continue;
		}
		if (project.value.type !== "object") {
			source = replaceRange(
				source,
				project.value.start,
				project.value.end,
				'{"hasTrustDialogAccepted":true}',
			);
			continue;
		}
		const trust = property(project.value, "hasTrustDialogAccepted");
		if (!trust) {
			source = insertProperty(
				source,
				project.value,
				"hasTrustDialogAccepted",
				"true",
			);
		} else if (source.slice(trust.value.start, trust.value.end) !== "true") {
			source = replaceRange(source, trust.value.start, trust.value.end, "true");
		}
	}

	root = parseRoot(source);
	const bypass = property(root, "bypassPermissionsModeAccepted");
	if (!bypass) {
		source = insertProperty(
			source,
			root,
			"bypassPermissionsModeAccepted",
			"true",
		);
	} else if (source.slice(bypass.value.start, bypass.value.end) !== "true") {
		source = replaceRange(source, bypass.value.start, bypass.value.end, "true");
	}
	return source;
}

function claudeStateCanBeUpdated(home, fsImpl) {
	const configPath = path.join(home, ".claude.json");
	const snapshot = stateSnapshot(configPath, fsImpl);
	if (!snapshot.exists) return true;
	try {
		applyTrustState(fsImpl.readFileSync(configPath, "utf8"), []);
		return true;
	} catch (error) {
		log.warning(
			`Malformed ${configPath}; leaving it untouched and skipping Claude Remote Control (${error.message}).`,
		);
		return false;
	}
}

/**
 * Surgically update Claude's runtime state without reformatting unrelated data.
 * Returns false for malformed or repeatedly changing state so setup cannot
 * clobber Claude's concurrent writes or start sessions blocked on trust.
 */
export function updateClaudeProjectTrust({
	home = HOME_DEFAULT,
	fsImpl = fs,
	roots,
} = {}) {
	const configPath = path.join(home, ".claude.json");
	const trustedRoots =
		roots ??
		sessionInstances(home)
			.filter(({ root }) => fsImpl.existsSync(root))
			.map(({ root }) => root);

	for (let attempt = 1; attempt <= TRUST_WRITE_ATTEMPTS; attempt += 1) {
		const snapshot = stateSnapshot(configPath, fsImpl);
		const original = snapshot.exists
			? fsImpl.readFileSync(configPath, "utf8")
			: undefined;
		let source;
		try {
			source = snapshot.exists
				? applyTrustState(original, trustedRoots)
				: `${JSON.stringify(trustState(trustedRoots), null, 2)}\n`;
		} catch (error) {
			log.warning(
				`Malformed ${configPath}; leaving it untouched and skipping Claude Remote Control (${error.message}).`,
			);
			return false;
		}

		if (source === original) return true;
		try {
			atomicWriteState(configPath, source, fsImpl, snapshot);
			return true;
		} catch (error) {
			if (!(error instanceof ConcurrentStateChangeError)) throw error;
			if (attempt < TRUST_WRITE_ATTEMPTS) {
				log.warning(
					`Claude state changed while updating ${configPath}; retrying (${attempt}/${TRUST_WRITE_ATTEMPTS}).`,
				);
				continue;
			}
			log.warning(
				`Claude state kept changing while updating ${configPath}; leaving it untouched after ${TRUST_WRITE_ATTEMPTS} attempts.`,
			);
		}
	}
	return false;
}

function dependenciesAvailable(runner) {
	let tmux;
	try {
		tmux = runner(["sh", "-c", "command -v tmux >/dev/null 2>&1"]);
	} catch {
		// The shared missing-dependency warning below is actionable for both forms.
	}
	if (!tmux || tmux.exitCode !== 0) {
		log.warning(
			"tmux is required for Claude Remote Control; install tmux and retry.",
		);
		return false;
	}

	let systemctl;
	try {
		systemctl = runner(["systemctl", "--user", "--version"]);
	} catch {
		// The shared missing-dependency warning below covers spawn failures too.
	}
	if (!systemctl || systemctl.exitCode !== 0) {
		log.warning(
			"systemctl --user is required for Claude Remote Control; ensure a systemd user manager is available and retry.",
		);
		return false;
	}
	return true;
}

function enableServices(runner, user, enabledUnits, disabledUnits) {
	const disableHint = disabledUnits.length
		? ` && systemctl --user disable --now ${disabledUnits.join(" ")}`
		: "";
	const enableHint = `systemctl --user daemon-reload${disableHint} && systemctl --user enable --now ${enabledUnits.join(" ")}`;
	try {
		const reload = runner(["systemctl", "--user", "daemon-reload"]);
		const disable = disabledUnits.length
			? runner(["systemctl", "--user", "disable", "--now", ...disabledUnits])
			: { exitCode: 0 };
		const enable = runner([
			"systemctl",
			"--user",
			"enable",
			"--now",
			...enabledUnits,
		]);
		if (
			(reload?.exitCode ?? 1) !== 0 ||
			(disable?.exitCode ?? 1) !== 0 ||
			(enable?.exitCode ?? 1) !== 0
		) {
			throw new Error("systemctl enable failed");
		}
		log.success("Enabled Claude Remote Control user services.");
	} catch {
		log.warning(
			`Could not enable Claude Remote Control services. Run manually:\n  ${enableHint}`,
		);
		return false;
	}

	const lingerHint = `loginctl enable-linger ${user}`;
	try {
		const linger = runner(["loginctl", "enable-linger", user]);
		if ((linger?.exitCode ?? 1) !== 0) throw new Error("enable-linger failed");
		log.success(`Enabled systemd user lingering for ${user}.`);
	} catch {
		log.warning(
			`Could not enable systemd user lingering. Run manually:\n  ${lingerHint}`,
		);
	}
	return true;
}

/** Deploy the tmux supervisor and systemd user-unit template. */
export async function syncClaudeRemoteControl(opts = {}) {
	const {
		home = HOME_DEFAULT,
		projectRoot = PROJECT_ROOT_DEFAULT,
		fsImpl = fs,
		enable = true,
		user = USER_DEFAULT,
	} = opts;
	const runner = opts.runner ?? ((args) => Bun.spawnSync(args));
	const repoDir = path.join(projectRoot, "configs", "claude-remote-control");
	const scriptSource = path.join(repoDir, SCRIPT);
	const unitSource = path.join(repoDir, UNIT);
	if (!fsImpl.existsSync(scriptSource) || !fsImpl.existsSync(unitSource)) {
		log.warning(`Claude Remote Control sources are missing from ${repoDir}.`);
		return false;
	}
	if (!claudeStateCanBeUpdated(home, fsImpl)) return false;
	if (!dependenciesAvailable(runner)) return false;

	const instances = sessionInstances(home);
	const enabledInstances = instances.filter(({ root }) =>
		fsImpl.existsSync(root),
	);
	const disabledInstances = instances.filter(
		({ root }) => !fsImpl.existsSync(root),
	);
	for (const { instance, root } of disabledInstances) {
		log.warning(
			`Skipping Claude Remote Control instance ${instance}: root does not exist: ${root}`,
		);
	}

	const trustReady = updateClaudeProjectTrust({
		home,
		fsImpl,
		roots: enabledInstances.map(({ root }) => root),
	});
	if (!trustReady) return false;

	const liveScriptDir = path.join(home, ".local", "bin");
	const liveSystemdDir = path.join(home, ".config", "systemd", "user");
	const liveEnvironmentDir = path.join(
		home,
		".config",
		"haoshoku",
		"claude-remote-control",
	);
	fsImpl.mkdirSync(liveScriptDir, { recursive: true });
	fsImpl.mkdirSync(liveSystemdDir, { recursive: true });
	fsImpl.mkdirSync(liveEnvironmentDir, { recursive: true });
	const scriptDestination = path.join(liveScriptDir, SCRIPT);
	fsImpl.copyFileSync(scriptSource, scriptDestination);
	fsImpl.chmodSync(scriptDestination, 0o755);
	fsImpl.copyFileSync(unitSource, path.join(liveSystemdDir, UNIT));
	for (const { instance, root } of enabledInstances) {
		const environmentPath = path.join(liveEnvironmentDir, `${instance}.env`);
		fsImpl.writeFileSync(
			environmentPath,
			`CLAUDE_REMOTE_CONTROL_ROOT=${JSON.stringify(root)}\n`,
			{ mode: 0o600 },
		);
		fsImpl.chmodSync(environmentPath, 0o600);
	}
	for (const { instance } of disabledInstances) {
		const environmentPath = path.join(liveEnvironmentDir, `${instance}.env`);
		if (fsImpl.existsSync(environmentPath)) fsImpl.unlinkSync(environmentPath);
	}

	const enabledUnits = enabledInstances.map(({ unit }) => unit);
	const disabledUnits = disabledInstances.map(({ unit }) => unit);
	if (enable && !enableServices(runner, user, enabledUnits, disabledUnits))
		return false;
	return true;
}

/** Snapshot the live supervisor and user-unit template into the repository. */
export async function backupClaudeRemoteControl(opts = {}) {
	const {
		home = HOME_DEFAULT,
		projectRoot = PROJECT_ROOT_DEFAULT,
		fsImpl = fs,
	} = opts;
	const liveScript = path.join(home, ".local", "bin", SCRIPT);
	const liveUnit = path.join(home, ".config", "systemd", "user", UNIT);
	const missing = [liveScript, liveUnit].filter(
		(candidate) => !fsImpl.existsSync(candidate),
	);
	if (missing.length) {
		log.warning(
			`Claude Remote Control backup requires both live artifacts; missing: ${missing.join(", ")}. Repository backup left unchanged.`,
		);
		return false;
	}

	const repoDir = path.join(projectRoot, "configs", "claude-remote-control");
	fsImpl.mkdirSync(repoDir, { recursive: true });
	fsImpl.copyFileSync(liveScript, path.join(repoDir, SCRIPT));
	fsImpl.copyFileSync(liveUnit, path.join(repoDir, UNIT));
	log.success(
		"Claude Remote Control backed up to configs/claude-remote-control/.",
	);
	return true;
}

export async function configureClaudeRemoteControl(opts = {}) {
	return syncClaudeRemoteControl(opts);
}
