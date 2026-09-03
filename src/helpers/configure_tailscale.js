import { detectOS } from "../common/cli_utils.js";
import {
	commandExists,
	log,
	runCommand,
	runCommandCapture,
} from "../common/utils.js";

/**
 * Per-OS install commands. Arch uses the repo package; Debian uses the
 * official installer, which adds Tailscale's apt repo and installs from it.
 */
export const TAILSCALE_INSTALL_COMMANDS = Object.freeze({
	arch: "sudo pacman -S --needed --noconfirm tailscale",
	"debian-server": "curl -fsSL https://tailscale.com/install.sh | sh",
});

const ENABLE_COMMAND = "sudo systemctl enable --now tailscaled";
const STATUS_COMMAND = "tailscale status --json";
const UP_COMMAND = "sudo tailscale up";

/**
 * Parse `tailscale status --json`. Returns null on unparseable input.
 *
 * @returns {{ backendState: string, dnsName: string | null } | null}
 */
export function parseTailscaleStatus(output) {
	try {
		const value = JSON.parse(output);
		if (!value || typeof value !== "object" || Array.isArray(value))
			return null;
		if (typeof value.BackendState !== "string") return null;
		const dnsName =
			typeof value.Self?.DNSName === "string"
				? value.Self.DNSName.replace(/\.$/, "")
				: null;
		return { backendState: value.BackendState, dnsName };
	} catch {
		return null;
	}
}

/** A node needs `tailscale up` unless the backend is already Running. */
export function tailscaleNeedsLogin(status) {
	return status?.backendState !== "Running";
}

async function readStatus(capture) {
	const result = await capture(STATUS_COMMAND);
	if (result.failed) return null;
	return parseTailscaleStatus(result.stdout);
}

/**
 * Install Tailscale, enable tailscaled, and join the tailnet.
 *
 * Login is interactive: `tailscale up` prints an auth URL and blocks until
 * the node is approved in the browser. Re-runs on a joined node skip it.
 *
 * @returns {Promise<"joined" | "already-joined" | "unsupported" | "failed">}
 */
export async function configureTailscale({
	osId = detectOS(),
	run = runCommand,
	capture = runCommandCapture,
	commandExistsImpl = commandExists,
	logImpl = log,
} = {}) {
	if (!(await commandExistsImpl("tailscale"))) {
		const installCommand = TAILSCALE_INSTALL_COMMANDS[osId];
		if (!installCommand) {
			logImpl.warning(
				`Tailscale install is not supported for OS "${osId}" — skipping.`,
			);
			return "unsupported";
		}
		logImpl.info("Installing Tailscale...");
		if (!(await run(installCommand))) {
			logImpl.warning(
				"Tailscale install failed — retry with: haoshoku --tailscale",
			);
			return "failed";
		}
	}

	if (!(await run(ENABLE_COMMAND))) {
		logImpl.warning(
			"Could not enable tailscaled — retry with: haoshoku --tailscale",
		);
		return "failed";
	}

	let status = await readStatus(capture);
	if (!tailscaleNeedsLogin(status)) {
		logImpl.info(
			`Tailscale already joined${status.dnsName ? ` as ${status.dnsName}` : ""}.`,
		);
		return "already-joined";
	}

	logImpl.info(
		"Joining the tailnet. Open the login URL printed below and approve this machine.",
	);
	if (!(await run(UP_COMMAND))) {
		logImpl.warning("tailscale up failed — retry with: haoshoku --tailscale");
		return "failed";
	}

	status = await readStatus(capture);
	if (tailscaleNeedsLogin(status)) {
		logImpl.warning(
			"Tailscale is not Running after login — check `tailscale status` and retry with: haoshoku --tailscale",
		);
		return "failed";
	}
	logImpl.success(
		`Joined the tailnet${status.dnsName ? ` as ${status.dnsName}` : ""}.`,
	);
	return "joined";
}
