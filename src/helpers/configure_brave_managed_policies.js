import fs from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { commandExists, log, runCommand } from "../common/utils.js";

const DEFAULT_POLICY_DIRECTORY = "/etc/brave/policies/managed";
const DEFAULT_CHROMIUM_POLICY_DIRECTORY = "/etc/chromium/policies/managed";
const DEFAULT_THEME_FILE = path.join(
	homedir(),
	".config",
	"omarchy",
	"current",
	"theme",
	"chromium.theme",
);
const FALLBACK_THEME_COLOR = "#1c2027";
const ANTI_HIJACK_POLICY_FILE = "no-default-hijack.json";
const COLOR_POLICY_FILE = "color.json";
const ROOT_DIRECTORY_REPAIR_SCRIPT =
	'set -e; if [ -L "$1" ]; then rm -f -- "$1"; elif [ -e "$1" ]; then if [ ! -d "$1" ]; then rm -f -- "$1"; fi; fi; install -d -o root -g root -m 0755 -- "$1"';
const ANTI_HIJACK_POLICY = `${JSON.stringify(
	{ DefaultBrowserSettingEnabled: false },
	null,
	"\t",
)}\n`;

function shellEscape(value) {
	return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function lstatOrNull(filename, fsImpl) {
	try {
		return fsImpl.lstatSync(filename);
	} catch {
		return null;
	}
}

function needsRootOwnedMode755(directory, fsImpl) {
	const stat = lstatOrNull(directory, fsImpl);
	return (
		!stat ||
		stat.isSymbolicLink() ||
		!stat.isDirectory() ||
		(stat.mode & 0o7777) !== 0o755 ||
		stat.uid !== 0 ||
		stat.gid !== 0
	);
}

function needsUserOwnedMode755(directory, uid, gid, fsImpl) {
	const stat = lstatOrNull(directory, fsImpl);
	return (
		!stat ||
		stat.isSymbolicLink() ||
		!stat.isDirectory() ||
		(stat.mode & 0o7777) !== 0o755 ||
		stat.uid !== uid ||
		(stat.gid !== 0 && stat.gid !== gid)
	);
}

function policyTreeDirectories(policyDirectory) {
	return [
		path.dirname(path.dirname(policyDirectory)),
		path.dirname(policyDirectory),
		policyDirectory,
	];
}

function policyTreeRepairOperations(policyDirectory, fsImpl) {
	const directories = policyTreeDirectories(policyDirectory);
	if (
		!directories.some((directory) => needsRootOwnedMode755(directory, fsImpl))
	) {
		return [];
	}

	// Each component is stabilized while its parent is already root-controlled,
	// then the next component is handled. The root-side type check prevents an
	// attacker-controlled symlink from redirecting install/chmod to its referent.
	return directories.map(
		(directory) =>
			`sudo bash -c ${shellEscape(ROOT_DIRECTORY_REPAIR_SCRIPT)} _ ${shellEscape(directory)}`,
	);
}

function bravePolicyTreeRepairOperations(policyDirectory, uid, gid, fsImpl) {
	const directories = policyTreeDirectories(policyDirectory);
	const parents = directories.slice(0, -1);
	const leaf = directories.at(-1);
	const parentsNeedRepair = parents.some((directory) =>
		needsRootOwnedMode755(directory, fsImpl),
	);
	const leafNeedsRepair =
		parentsNeedRepair || needsUserOwnedMode755(leaf, uid, gid, fsImpl);
	if (!parentsNeedRepair && !leafNeedsRepair) return [];

	const operations = parentsNeedRepair
		? parents.map(
				(directory) =>
					`sudo bash -c ${shellEscape(ROOT_DIRECTORY_REPAIR_SCRIPT)} _ ${shellEscape(directory)}`,
			)
		: [];

	if (leafNeedsRepair) {
		// This user-owned Brave leaf is deliberate: omarchy-theme-set-browser writes
		// color.json here as the invoking user via tee. Both Brave policy files are
		// user-owned too; the owner accepts that security trade-off on this single-user
		// desktop because the directory owner could unlink root-owned files anyway.
		// Chromium is different: nothing needs to write its managed leaf as the user,
		// so the repair branch below keeps the entire existing Chromium tree root-owned.
		//
		// Never replace this sequence with `install -d -o <user> .../managed`.
		// install applies that ownership to every directory it creates, so a fresh
		// machine would also user-own /etc/brave and /etc/brave/policies. Stabilize
		// the root-owned parents first, then change ownership of only the leaf.
		operations.push(
			`sudo bash -c ${shellEscape(ROOT_DIRECTORY_REPAIR_SCRIPT)} _ ${shellEscape(leaf)}`,
		);
		operations.push(
			`sudo chown ${shellEscape(uid)}:${shellEscape(gid)} -- ${shellEscape(leaf)}`,
		);
	}

	return operations;
}

function needsUserOwnedPolicyFile(filename, content, uid, gid, fsImpl) {
	const stat = lstatOrNull(filename, fsImpl);
	if (
		!stat ||
		stat.isSymbolicLink() ||
		!stat.isFile() ||
		stat.uid !== uid ||
		stat.gid !== gid ||
		(stat.mode & 0o7777) !== 0o644
	) {
		return true;
	}

	try {
		return fsImpl.readFileSync(filename, "utf8") !== content;
	} catch {
		return true;
	}
}

function readThemeColor(themeFile, fsImpl) {
	if (!fsImpl.existsSync(themeFile)) return FALLBACK_THEME_COLOR;

	try {
		const components = fsImpl.readFileSync(themeFile, "utf8").trim().split(",");
		if (
			components.length !== 3 ||
			components.some(
				(component) =>
					!/^\d+$/.test(component.trim()) ||
					Number(component) < 0 ||
					Number(component) > 255,
			)
		) {
			return FALLBACK_THEME_COLOR;
		}

		return `#${components
			.map((component) => Number(component).toString(16).padStart(2, "0"))
			.join("")}`;
	} catch {
		return FALLBACK_THEME_COLOR;
	}
}

function colorPolicy(themeFile, fsImpl) {
	return `{"BrowserThemeColor": "${readThemeColor(themeFile, fsImpl)}", "BrowserColorScheme": "device"}\n`;
}

export async function configureBraveManagedPolicies({
	policyDirectory = DEFAULT_POLICY_DIRECTORY,
	chromiumPolicyDirectory = DEFAULT_CHROMIUM_POLICY_DIRECTORY,
	themeFile = DEFAULT_THEME_FILE,
	uid = userInfo().uid,
	gid = userInfo().gid,
	fsImpl = fs,
	commandExistsImpl = commandExists,
	runCommandImpl = runCommand,
} = {}) {
	if (!(await commandExistsImpl("brave-origin"))) {
		log.info("Brave Origin not found. Skipping managed-policy configuration.");
		return true;
	}

	const policies = [
		{ filename: ANTI_HIJACK_POLICY_FILE, content: ANTI_HIJACK_POLICY },
		{ filename: COLOR_POLICY_FILE, content: colorPolicy(themeFile, fsImpl) },
	];
	const braveOperations = bravePolicyTreeRepairOperations(
		policyDirectory,
		uid,
		gid,
		fsImpl,
	);
	if (
		braveOperations.length > 0 &&
		!(await runCommandImpl(braveOperations.join(" && ")))
	) {
		log.warning("Could not install Brave's managed browser policies.");
		return false;
	}

	for (const policy of policies) {
		const destination = path.join(policyDirectory, policy.filename);
		if (
			!needsUserOwnedPolicyFile(destination, policy.content, uid, gid, fsImpl)
		) {
			continue;
		}

		// The leaf is user-owned, so replacing an incorrect entry needs no sudo.
		fsImpl.rmSync(destination, { recursive: true, force: true });
		fsImpl.writeFileSync(destination, policy.content, { mode: 0o644 });
	}

	log.success("Brave managed browser policies installed.");

	const chromiumOperations = lstatOrNull(chromiumPolicyDirectory, fsImpl)
		? policyTreeRepairOperations(chromiumPolicyDirectory, fsImpl)
		: [];
	if (
		chromiumOperations.length > 0 &&
		!(await runCommandImpl(chromiumOperations.join(" && ")))
	) {
		log.warning(
			"Could not repair Chromium's managed-policy directory; continuing.",
		);
	}

	return true;
}
