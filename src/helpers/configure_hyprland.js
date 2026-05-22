import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import promptsLib from "prompts";

import { commandExists, log, runCommand } from "../common/utils.js";
import { configureLockfix } from "./configure_lockfix.js";

const HOME = homedir();

export const CAELESTIA_REPO = "https://github.com/caelestia-dots/caelestia.git";

/** Where Caelestia clones itself; its installer symlinks this into ~/.config/hypr/. */
export const CAELESTIA_CLONE_DIR = path.join(
	HOME,
	".local",
	"share",
	"caelestia",
);

export const CAELESTIA_INSTALLER = path.join(
	CAELESTIA_CLONE_DIR,
	"install.fish",
);

/**
 * Upstream Caelestia commit SHA tested against. Update when bumping.
 * Pin keeps reproducibility: changes in Caelestia's user-include path or
 * installer behavior won't silently break us. "main" is the soft pin —
 * checkoutPinnedCaelestia returns false without running any checkout.
 */
export const CAELESTIA_PINNED_SHA = "main";

/**
 * Packages needed to run Hyprland alongside Caelestia. mako is intentionally
 * absent — Caelestia's Quickshell ships its own notification daemon (it owns
 * org.freedesktop.Notifications on the user bus), so installing mako would
 * conflict.
 *
 * Skipped entirely when callers pass `skipHyprlandPackages: true` (e.g. the
 * user is already on Hyprland and only wants the Caelestia clone + installer).
 */
export const HYPRLAND_PACKAGES = [
	"hyprland",
	"hyprlock",
	"hypridle",
	"hyprpaper",
	"hyprshot",
	"cliphist",
	"wl-clipboard",
	"polkit-gnome",
	"xdg-desktop-portal-hyprland",
	"uwsm",
	"qt5-wayland",
	"qt6-wayland",
	"fish",
];

/**
 * Checkout the pinned Caelestia commit so installer behavior doesn't drift
 * silently between haoshoku releases. Returns true on successful checkout,
 * false when the pin is the literal "main" (soft pin — caller stays on
 * whatever tip was fetched), throws on hard failure.
 *
 * `pinnedSha` is interpolated into a shell-routed command via `runCommand`;
 * non-hex input is rejected before we ever build the command to block
 * "abc; rm -rf $HOME"-style injection.
 */
export async function checkoutPinnedCaelestia({
	cloneDir,
	pinnedSha = CAELESTIA_PINNED_SHA,
	run = runCommand,
} = {}) {
	if (pinnedSha === "main") return false;

	if (!/^[a-f0-9]{7,40}$/i.test(pinnedSha)) {
		throw new Error(
			`checkoutPinnedCaelestia: pinnedSha "${pinnedSha}" is not a valid hex SHA (7-40 chars)`,
		);
	}

	log.info(`Checking out pinned Caelestia commit ${pinnedSha}`);
	const checkedOut = await run(`git checkout ${pinnedSha}`, { cwd: cloneDir });
	if (!checkedOut) {
		throw new Error(`Failed to checkout pinned Caelestia commit ${pinnedSha}`);
	}
	return true;
}

const CAELESTIA_LEAF_INSTALL_COMMAND =
	"paru -S --needed --noconfirm caelestia-cli caelestia-shell";

/**
 * Recover from Caelestia's install.fish silently leaving caelestia-cli /
 * caelestia-shell uninstalled (typically an AUR mirror failure during the
 * `paru -Ui` step). Retries the explicit leaf install; if that still fails,
 * refreshes CachyOS mirrors + pacman databases and tries one more time.
 * Returns true iff `caelestia` is available afterward.
 */
export async function recoverCaelestiaPackages({
	run = runCommand,
	exists = commandExists,
} = {}) {
	await run(CAELESTIA_LEAF_INSTALL_COMMAND);
	if (await exists("caelestia")) return true;

	log.warning(
		"Explicit Caelestia package install failed. Refreshing CachyOS mirrors/package databases once before retrying...",
	);

	if (await exists("cachyos-rate-mirrors")) {
		const mirrorsRefreshed = await run("sudo cachyos-rate-mirrors");
		if (!mirrorsRefreshed) {
			log.warning(
				"cachyos-rate-mirrors failed; continuing with pacman database refresh.",
			);
		}
	}

	const databasesRefreshed = await run("sudo pacman -Syy --noconfirm");
	if (!databasesRefreshed) {
		log.warning(
			"pacman database refresh failed; retrying Caelestia packages once anyway.",
		);
	}

	const secondAttempt = await run(CAELESTIA_LEAF_INSTALL_COMMAND);
	return secondAttempt && (await exists("caelestia"));
}

/** Merge Haoshoku's Caelestia shell defaults without overwriting user settings. */
export function configureCaelestiaShell({ home = HOME } = {}) {
	const caelestiaConfigDir = path.join(home, ".config", "caelestia");
	const shellConfigPath = path.join(caelestiaConfigDir, "shell.json");
	let shellConfig = {};

	if (fs.existsSync(shellConfigPath)) {
		shellConfig = JSON.parse(fs.readFileSync(shellConfigPath, "utf8"));
	}

	shellConfig.services = {
		...(shellConfig.services ?? {}),
		useTwelveHourClock: false,
	};

	fs.mkdirSync(caelestiaConfigDir, { recursive: true });
	fs.writeFileSync(
		shellConfigPath,
		`${JSON.stringify(shellConfig, null, "\t")}\n`,
	);
	log.info("Configured Caelestia shell clock for 24-hour time.");
}

/**
 * Caelestia's install.fish symlinks `~/.config/hypr` into its own clone tree
 * (so `hyprland.conf` and all `conf.d/*.conf` files live in the symlinked
 * repo). But the installer refuses to clobber an existing `~/.config/hypr`
 * directory — and CachyOS Hyprland-edition images ship stock Hyprland
 * configs at `/etc/skel/.config/hypr/` that land in every new user's home.
 * Result: install.fish silently skips its symlink step, leaving the user
 * with CachyOS's default `hyprland.conf` (which does NOT source
 * `hypr-user.conf`) and a deployed-but-orphaned `~/.config/caelestia/
 * hypr-user.conf` that's never read.
 *
 * Detect that case and rename the stock dir to `~/.config/hypr.bak.<ts>`
 * so install.fish lays down its symlink cleanly. Safe to call repeatedly:
 * if `~/.config/hypr` is already a symlink to Caelestia's tree, no-op.
 *
 * Returns the backup path on rename, or null when nothing was moved.
 */
export function moveStockHyprConfigAside({
	home = HOME,
	caelestiaCloneDir,
	fsImpl = fs,
	now = Date.now,
} = {}) {
	const hyprConfigDir = path.join(home, ".config", "hypr");
	const caelestiaHyprDir = path.join(caelestiaCloneDir, "hypr");

	if (!fsImpl.existsSync(hyprConfigDir)) return null;

	const stats = fsImpl.lstatSync(hyprConfigDir);
	if (stats.isSymbolicLink()) {
		const linkTarget = fsImpl.readlinkSync(hyprConfigDir);
		const resolvedTarget = path.resolve(
			path.dirname(hyprConfigDir),
			linkTarget,
		);
		if (resolvedTarget === path.resolve(caelestiaHyprDir)) {
			// Already correctly symlinked into Caelestia — Caelestia's installer
			// will leave it alone, which is what we want.
			return null;
		}
	}

	const backup = `${hyprConfigDir}.bak.${now()}`;
	fsImpl.renameSync(hyprConfigDir, backup);
	log.info(
		`Moved existing ${hyprConfigDir} → ${backup} so Caelestia's installer can symlink fresh (stock CachyOS hypr/ blocks the symlink otherwise).`,
	);
	return backup;
}

/**
 * Install Hyprland packages + clone/install upstream Caelestia. Idempotent:
 * a second run pulls the existing clone rather than re-cloning, and skips
 * the Hyprland pacman install when `skipHyprlandPackages` is true (caller
 * is on Hyprland already).
 *
 * 5.0.0 explicitly does NOT deploy any Ocean overlay — no `~/.config/hypr-ocean/`,
 * no `source = ...` line written into `~/.config/caelestia/hypr-user.conf`.
 * That file is now purely user-owned space for monitor configuration and
 * other per-host overrides; haoshoku doesn't touch it.
 */
export async function installCaelestia({
	home = HOME,
	skipHyprlandPackages = false,
	run = runCommand,
	exists = commandExists,
} = {}) {
	const caelestiaCloneDir = path.join(home, ".local", "share", "caelestia");
	const caelestiaInstaller = path.join(caelestiaCloneDir, "install.fish");
	const userIncludeDir = path.join(home, ".config", "caelestia");

	if (!(await exists("fish"))) {
		log.error(
			"fish is required by Caelestia's install.fish — installing fish first.",
		);
		const ok = await run("sudo pacman -S --needed --noconfirm fish");
		if (!ok) throw new Error("Failed to install fish");
	}

	if (skipHyprlandPackages) {
		log.info(
			"Skipping Hyprland package install (caller indicated user is already on Hyprland).",
		);
	} else {
		log.info("Installing Hyprland package set via pacman...");
		const pkgInstall = await run(
			`sudo pacman -S --needed --noconfirm ${HYPRLAND_PACKAGES.join(" ")}`,
		);
		if (!pkgInstall) {
			log.warning(
				"Hyprland package install had issues; Caelestia installer may catch the rest.",
			);
		}
	}

	if (fs.existsSync(path.join(caelestiaCloneDir, ".git"))) {
		log.info(
			`Caelestia already cloned at ${caelestiaCloneDir}; pulling updates.`,
		);
		const pulled = await run("git pull --ff-only", { cwd: caelestiaCloneDir });
		if (!pulled) {
			log.warning("git pull failed; continuing with existing clone.");
		}
	} else {
		log.info(`Cloning Caelestia into ${caelestiaCloneDir}...`);
		fs.mkdirSync(path.dirname(caelestiaCloneDir), { recursive: true });
		const cloned = await run(
			`git clone ${CAELESTIA_REPO} ${caelestiaCloneDir}`,
		);
		if (!cloned) throw new Error("Caelestia clone failed");
	}

	await checkoutPinnedCaelestia({ cloneDir: caelestiaCloneDir, run });

	// CachyOS Hyprland edition ships /etc/skel/.config/hypr/ which lands as a
	// real directory in every new user's home and blocks Caelestia's symlink
	// step. Move the stock dir aside so install.fish can lay down its tree.
	moveStockHyprConfigAside({ home, caelestiaCloneDir });

	log.info(
		"Running Caelestia install.fish (may prompt for sudo + package confirmations)...",
	);
	const installed = await run(`fish ${caelestiaInstaller}`);
	if (!installed) throw new Error("Caelestia install.fish exited non-zero");

	// install.fish invokes `paru -Ui` on the local PKGBUILD to install
	// caelestia-meta (which pulls in caelestia-cli + caelestia-shell). If a
	// transitive dep (e.g. python-uv) fails to fetch from an AUR mirror,
	// install.fish silently continues to the config-copy phase but the
	// `caelestia` CLI never lands. Without it, `exec-once = caelestia shell -d`
	// in execs.conf is a no-op and the user boots into a bare Hyprland session.
	if (!(await exists("caelestia"))) {
		log.warning(
			"caelestia CLI missing after install.fish (likely an AUR mirror failure during paru -Ui). " +
				"Retrying with explicit `paru -S caelestia-cli caelestia-shell`...",
		);
		const recovered = await recoverCaelestiaPackages({ run, exists });
		if (!recovered || !(await exists("caelestia"))) {
			throw new Error(
				"caelestia CLI still missing after mirror/database refresh and retry. " +
					"Try `sudo cachyos-rate-mirrors && sudo pacman -Syyu` to refresh mirrors and upgrade, then re-run `bun haoshoku.js --hyprland`. " +
					"If that fails, install caelestia-cli + caelestia-shell manually and re-run.",
			);
		}
	}

	// Caelestia creates ~/.config/caelestia/hypr-user.conf and hypr-vars.conf
	// LAZILY on first Hyprland boot via the configs.fish exec hook in
	// hyprland.conf. Since `--hyprland` runs from your current session, that
	// boot hasn't happened yet. Pre-create both as empty so Hyprland's first
	// `source = $cConf/hypr-user.conf` doesn't error before configs.fish runs.
	fs.mkdirSync(userIncludeDir, { recursive: true });
	configureCaelestiaShell({ home });
	for (const f of ["hypr-vars.conf", "hypr-user.conf"]) {
		const target = path.join(userIncludeDir, f);
		if (!fs.existsSync(target)) {
			fs.writeFileSync(target, "");
			log.info(
				`Pre-created empty ${target} (Caelestia would create lazily on first boot)`,
			);
		}
	}

	// Deploy the portrait lock-screen fix kit and apply it so the fix is live
	// immediately on a fresh install. Non-critical: failure logs a warning and
	// does NOT abort the overall setup.
	log.info("Deploying caelestia-lockfix portrait fix...");
	try {
		await configureLockfix({ home });
		const applyScript = path.join(
			home,
			".local",
			"share",
			"caelestia-lockfix",
			"apply.sh",
		);
		const applied = await run(`bash ${applyScript}`, {
			check: false,
			returnExitCode: true,
		});
		if (applied === 0 || applied === true) {
			log.success("caelestia-lockfix portrait fix applied.");
		} else if (applied === 2) {
			log.warning(
				"caelestia-lockfix apply.sh auto-reverted because Caelestia shell did not restart. " +
					"Check whether the shell is running, then run `~/.local/share/caelestia-lockfix/apply.sh` manually after setup.",
			);
		} else {
			log.warning(
				"caelestia-lockfix apply.sh could not apply the patch — portrait fix not applied. " +
					"Run `~/.local/share/caelestia-lockfix/apply.sh` manually after setup.",
			);
		}
	} catch (err) {
		log.warning(
			`caelestia-lockfix deploy failed (${err?.message ?? err}) — portrait fix not applied. ` +
				"Run `~/.local/share/caelestia-lockfix/apply.sh` manually after setup.",
		);
	}
}

/**
 * Auto-detect the current desktop environment via $XDG_CURRENT_DESKTOP and
 * prompt the user to confirm or override. Returns one of "kde", "hyprland",
 * "gnome", "other", or null if the user cancelled (prompts returned empty).
 *
 * The detected value is offered as the `initial` choice so a user on the
 * common path can just press Enter.
 */
export async function promptDesktopEnvironment({
	env = process.env,
	promptFn = promptsLib,
} = {}) {
	const raw = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase();
	let detected;
	if (raw.includes("hyprland")) detected = "hyprland";
	else if (raw.includes("kde") || raw.includes("plasma")) detected = "kde";
	else if (raw.includes("gnome")) detected = "gnome";
	else detected = "other";

	const choices = [
		{ title: "KDE Plasma", value: "kde" },
		{ title: "Hyprland", value: "hyprland" },
		{ title: "GNOME", value: "gnome" },
		{ title: "Other / fresh install", value: "other" },
	];
	const initial = choices.findIndex((c) => c.value === detected);

	const response = await promptFn({
		type: "select",
		name: "de",
		message: `Current desktop environment? (detected: ${detected})`,
		choices,
		initial: initial >= 0 ? initial : 3,
	});

	if (!response || response.de === undefined) return null;
	return response.de;
}

/**
 * Prompt the user for which device type this machine is (PC / laptop / other /
 * skip). On PC/laptop/other, persists `{ deviceType: <value> }` into
 * ~/.haoshoku.json (merged with any existing keys — e.g. skillSources).
 * On skip or cancel, returns null and does NOT touch the file.
 *
 * The answer routes Caelestia monitor/workspace prefs and device-specific
 * audio tuning; skip/cancel leaves those device-routed paths unset.
 */
export async function promptDeviceType({
	configPath = path.join(HOME, ".haoshoku.json"),
	promptFn = promptsLib,
} = {}) {
	const response = await promptFn({
		type: "select",
		name: "device",
		message: "Which device is this? (used to scope future monitor configs)",
		choices: [
			{ title: "Main PC", value: "pc" },
			{ title: "Laptop", value: "laptop" },
			{ title: "Other", value: "other" },
			{ title: "Skip — don't persist", value: null },
		],
	});

	if (!response || response.device === undefined || response.device === null) {
		return null;
	}

	let config = {};
	if (fs.existsSync(configPath)) {
		try {
			config = JSON.parse(fs.readFileSync(configPath, "utf8"));
		} catch (err) {
			log.warning(
				`Malformed ~/.haoshoku.json at ${configPath}; replacing it while saving deviceType (${err?.message ?? err})`,
			);
			config = {};
		}
	}
	config.deviceType = response.device;
	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

	return response.device;
}
