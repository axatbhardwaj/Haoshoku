import fs from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectOS } from "../common/cli_utils.js";
import {
	commandExists,
	log,
	promptUser,
	runCommand,
	runCommandCapture,
} from "../common/utils.js";
import {
	parseTailscaleStatus,
	tailscaleNeedsLogin,
} from "./configure_tailscale.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

export const MESH_HOSTS = Object.freeze(["pc", "laptop", "vps"]);
/** Login user per mesh host; the VPS runs as root, desktops as xzat. */
export const MESH_USERS = Object.freeze({
	pc: "xzat",
	laptop: "xzat",
	vps: "root",
});
export const SSHD_SERVICE = Object.freeze({
	arch: "sshd",
	"debian-server": "ssh",
});
const DROP_IN_PATH = "/etc/ssh/sshd_config.d/50-haoshoku.conf";
const TAILNET_ALLOW_RULE =
	"sudo ufw allow in on tailscale0 to any port 22 proto tcp";
const PUBLIC_SSH_DELETE_RULE = "sudo ufw delete allow ssh";
const BLOCK_START = "# >>> haoshoku mesh >>>";
const BLOCK_END = "# <<< haoshoku mesh <<<";

/** sshd drop-in: key-only auth. */
export function buildSshdDropIn() {
	return `# Managed by Haoshoku — key-only SSH over the tailnet.
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
`;
}

/** Key material (type + base64) identifies a key; comments do not. */
function keyIdentity(line) {
	const [type, material] = line.trim().split(/\s+/);
	return type && material ? `${type} ${material}` : null;
}

/**
 * Union of existing and repo authorized_keys. Existing lines are kept
 * verbatim and in order; repo keys not already present are appended.
 */
export function mergeAuthorizedKeys(existing, repo) {
	const existingLines = existing.split("\n").filter((l) => l.length > 0);
	const seen = new Set(existingLines.map(keyIdentity).filter(Boolean));
	const merged = [...existingLines];
	for (const line of repo.split("\n")) {
		const id = keyIdentity(line);
		if (!id || line.trim().startsWith("#") || seen.has(id)) continue;
		seen.add(id);
		merged.push(line.trim());
	}
	return merged.length ? `${merged.join("\n")}\n` : "";
}

/** Count real key lines (non-empty, non-comment). */
export function countAuthorizedKeys(content) {
	return content
		.split("\n")
		.filter((l) => l.trim() && !l.trim().startsWith("#")).length;
}

/**
 * `~/.ssh/config` block for the mesh hosts: shared identity, per-host login
 * user, agent forwarding to vps only.
 */
export function buildSshConfigBlock({ users = MESH_USERS } = {}) {
	const perHost = MESH_HOSTS.map(
		(host) =>
			`Host ${host}\n    User ${users[host]}${host === "vps" ? "\n    ForwardAgent yes" : ""}`,
	).join("\n");
	return `${BLOCK_START}
Host ${MESH_HOSTS.join(" ")}
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
${perHost}
${BLOCK_END}
`;
}

/** Replace the managed block in place, or append it; other content is kept. */
export function replaceManagedBlock(existing, block) {
	const start = existing.indexOf(BLOCK_START);
	const end = existing.indexOf(BLOCK_END);
	if (start !== -1 && end !== -1 && end > start) {
		const after = existing.slice(end + BLOCK_END.length).replace(/^\n/, "");
		return `${existing.slice(0, start)}${block}${after}`;
	}
	const base =
		existing.length && !existing.endsWith("\n") ? `${existing}\n` : existing;
	return `${base}${base.length ? "\n" : ""}${block}`;
}

/**
 * Lockout gate for removing the public SSH rule: the node must be Running on
 * the tailnet and at least one authorized key must exist.
 */
export function publicSshRuleRemovable({
	tailscaleRunning,
	authorizedKeyCount,
}) {
	return Boolean(tailscaleRunning) && authorizedKeyCount > 0;
}

async function tailscaleRunning(capture) {
	const result = await capture("tailscale status --json");
	if (result.failed) return false;
	return !tailscaleNeedsLogin(parseTailscaleStatus(result.stdout));
}

/**
 * Enable sshd, provision the machine key + authorized keys + mesh SSH config,
 * lock sshd to key-only auth, and restrict UFW's SSH to the tailnet.
 *
 * @returns {Promise<boolean>} false when a lockout-sensitive step failed.
 */
export async function configureSshd({
	osId = detectOS(),
	home = homedir(),
	projectRoot = PROJECT_ROOT_DEFAULT,
	userName = userInfo().username,
	hostName = hostname(),
	stagingDir = tmpdir(),
	run = runCommand,
	capture = runCommandCapture,
	prompt = promptUser,
	commandExistsImpl = commandExists,
	logImpl = log,
} = {}) {
	const service = SSHD_SERVICE[osId];
	if (!service) {
		logImpl.warning(`sshd setup is not supported for OS "${osId}" — skipping.`);
		return false;
	}
	if (!(await run(`sudo systemctl enable --now ${service}`))) {
		logImpl.warning(
			`Could not enable ${service} — retry with: haoshoku --sshd`,
		);
		return false;
	}

	const sshDir = path.join(home, ".ssh");
	fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });

	const keyPath = path.join(sshDir, "id_ed25519");
	if (!fs.existsSync(keyPath)) {
		logImpl.info("Generating this machine's SSH key...");
		if (
			!(await run(
				`ssh-keygen -t ed25519 -N "" -f ${keyPath} -C "${userName}@${hostName}"`,
			))
		) {
			logImpl.warning("ssh-keygen failed — retry with: haoshoku --sshd");
			return false;
		}
		const pub = fs.existsSync(`${keyPath}.pub`)
			? fs.readFileSync(`${keyPath}.pub`, "utf8").trim()
			: "";
		logImpl.info(
			`New public key:\n${pub}\nAdd it to configs/ssh/authorized_keys and back up ${keyPath} in 1Password.`,
		);
	}

	const repoKeysPath = path.join(
		projectRoot,
		"configs",
		"ssh",
		"authorized_keys",
	);
	const repoKeys = fs.existsSync(repoKeysPath)
		? fs.readFileSync(repoKeysPath, "utf8")
		: "";
	const authorizedPath = path.join(sshDir, "authorized_keys");
	const existingKeys = fs.existsSync(authorizedPath)
		? fs.readFileSync(authorizedPath, "utf8")
		: "";
	const mergedKeys = mergeAuthorizedKeys(existingKeys, repoKeys);
	fs.writeFileSync(authorizedPath, mergedKeys, { mode: 0o600 });
	const keyCount = countAuthorizedKeys(mergedKeys);

	const configPath = path.join(sshDir, "config");
	const existingConfig = fs.existsSync(configPath)
		? fs.readFileSync(configPath, "utf8")
		: "";
	fs.writeFileSync(
		configPath,
		replaceManagedBlock(existingConfig, buildSshConfigBlock()),
		{ mode: 0o600 },
	);

	if (keyCount === 0) {
		logImpl.warning(
			"No authorized keys present — leaving password login enabled and the public SSH rule in place. Add keys to configs/ssh/authorized_keys and re-run.",
		);
		return true;
	}

	const staging = path.join(stagingDir, "50-haoshoku.conf");
	fs.writeFileSync(staging, buildSshdDropIn());
	if (
		!(await run(`sudo mv ${staging} ${DROP_IN_PATH}`)) ||
		!(await run(`sudo systemctl restart ${service}`))
	) {
		logImpl.warning(
			"Could not apply the key-only sshd drop-in — retry with: haoshoku --sshd",
		);
		return false;
	}
	logImpl.success("sshd is key-only.");

	if (!(await commandExistsImpl("ufw"))) {
		logImpl.info("UFW not installed — skipping firewall rules.");
		return true;
	}
	if (!(await run(TAILNET_ALLOW_RULE))) {
		logImpl.warning(
			"Could not add the tailnet SSH allow rule — public SSH rule left untouched.",
		);
		return false;
	}
	if (osId !== "debian-server") return true;

	const running = await tailscaleRunning(capture);
	if (
		!publicSshRuleRemovable({
			tailscaleRunning: running,
			authorizedKeyCount: keyCount,
		})
	) {
		logImpl.warning(
			"Tailscale is not Running — keeping the public SSH rule. Re-run after `tailscale status` shows Running.",
		);
		return true;
	}
	if (
		await prompt(
			"Remove the public SSH rule so port 22 is reachable only over Tailscale? (break-glass: provider console)",
			true,
		)
	) {
		if (!(await run(PUBLIC_SSH_DELETE_RULE))) {
			logImpl.warning("Could not remove the public SSH rule.");
			return false;
		}
		logImpl.success("SSH is now tailnet-only.");
	}
	return true;
}
