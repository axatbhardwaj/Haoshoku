import fs from "node:fs";
import { commandExists, log, runCommand, runCommandCapture } from "../../common/utils.js";
import { meetsT3Floor } from "../../helpers/t3_tailscale.js";

const ARCH_PACKAGE_NAME_PATTERN = /^(?![-.])[A-Za-z0-9@._+-]+$/;

export function normalizeArchPackageNames(packages) {
	const valid = [];
	const invalid = [];
	const seen = new Set();

	for (const raw of packages) {
		const pkg = raw.trim();
		if (seen.has(pkg)) continue;
		seen.add(pkg);
		if (pkg && ARCH_PACKAGE_NAME_PATTERN.test(pkg)) valid.push(pkg);
		else invalid.push(pkg);
	}
	return { valid, invalid };
}

export async function resolveAurHelper(commandExistsImpl = commandExists) {
	for (const helper of ["yay", "paru"]) {
		if (await commandExistsImpl(helper)) return helper;
	}
	return null;
}

export function selectArchInstallCommand(pkg, inRepository, aurHelper) {
	if (inRepository) {
		return `sudo -n pacman -S --needed --noconfirm ${pkg}`;
	}
	return aurHelper ? `${aurHelper} -S --needed --noconfirm ${pkg}` : null;
}

async function packageInRepository(pkg) {
	const proc = Bun.spawn(["pacman", "-Si", pkg], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await proc.exited) === 0;
}

async function packageInAur(pkg, aurHelper) {
	if (!aurHelper) return false;
	const proc = Bun.spawn([aurHelper, "-Si", "--aur", pkg], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await proc.exited) === 0;
}

export async function installGamingPackages({
	aurHelper,
	isOmarchy,
	commandExistsImpl = commandExists,
	runCommandImpl = runCommand,
} = {}) {
	const repositoryOk = await runCommandImpl(
		"sudo -n pacman -S --needed --noconfirm steam gamemode lib32-gamemode gamescope mangohud lib32-mangohud",
	);
	const protonOk = aurHelper
		? await runCommandImpl(
				`${aurHelper} -S --needed --noconfirm protonup-rs-bin`,
			)
		: false;

	let gpuOk = true;
	if (
		isOmarchy &&
		(await commandExistsImpl("omarchy-install-gaming-gpu-lib32"))
	) {
		gpuOk = await runCommandImpl("omarchy-install-gaming-gpu-lib32");
	} else if (!isOmarchy) {
		log.info("Skipping GPU-specific 32-bit packages outside Omarchy.");
	}
	return Boolean(repositoryOk && protonOk && gpuOk);
}

/**
 * Snapshot pacman's local DB once so callers can pre-filter "already installed"
 * packages without paying paru's per-package AUR HTTP roundtrip. AUR packages
 * installed via paru land in the pacman DB the same way repo packages do.
 * Returns an empty Set on failure so callers fall back to "try to install
 * everything", matching pre-optimization behavior.
 */
export async function getInstalledPackages(spawnImpl = Bun.spawn) {
	try {
		const proc = spawnImpl(["pacman", "-Qq"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			log.warning("pacman -Qq failed; skipping pre-install filter.");
			return new Set();
		}
		return new Set(
			output
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
		);
	} catch (_e) {
		log.warning("pacman -Qq failed; skipping pre-install filter.");
		return new Set();
	}
}

async function installBatchWithFallback({
	packages,
	batchCommand,
	individualCommand,
	status,
	getInstalledPackagesImpl,
	runCommandImpl,
}) {
	if (packages.length === 0) return;
	if (await runCommandImpl(batchCommand)) {
		for (const pkg of packages) status.set(pkg, "installed");
		return;
	}

	const installedAfterBatch = await getInstalledPackagesImpl();
	for (const pkg of packages) {
		if (installedAfterBatch.has(pkg)) {
			status.set(pkg, "installed");
		} else if (await runCommandImpl(individualCommand(pkg))) {
			status.set(pkg, "installed");
		} else {
			status.set(pkg, "failed");
		}
	}
}

export async function installArchPackageBatch(packages, options = {}) {
	const {
		aurHelper,
		packageInRepositoryImpl = packageInRepository,
		packageInAurImpl = packageInAur,
		getInstalledPackagesImpl = getInstalledPackages,
		runCommandImpl = runCommand,
	} = options;
	const captureCommandImpl = options.captureCommandImpl ?? runCommandCapture;
	const stableDesktopInstalled = async () => {
		try {
			const result = await captureCommandImpl("pacman -Q t3code-bin", {
				expectFailure: true,
			});
			const version = result.stdout.trim().match(/^t3code-bin (?:\d+:)?(.+)-\d+(?:\.\d+)*$/)?.[1];
			if (result.exitCode === 0 && meetsT3Floor(version)) return true;
		} catch { /* An unreadable package version cannot prove the stable floor. */ }
		log.warning(
			`T3 desktop version is unknown, prerelease or below 0.1.0; keeping it unchanged. After backing up and closing T3, inspect and run: ${aurHelper ?? "yay"} -S aur/t3code-bin. Continuing with unrelated packages.`,
		);
		return false;
	};
	const whichImpl = options.whichImpl ?? Bun.which;
	const { valid, invalid } = normalizeArchPackageNames(packages);
	const status = new Map();
	const initiallyInstalled = await getInstalledPackagesImpl();
	if (
		valid.includes("t3code-bin") &&
		!initiallyInstalled.has("t3code-bin") &&
		(initiallyInstalled.has("t3code-nightly-bin") ||
			whichImpl("t3") ||
			whichImpl("t3code") ||
			whichImpl("t3code-nightly"))
	) {
		status.set("t3code-bin", "held");
		log.warning(
			"T3 stable migration held: existing nightly or unmanaged T3 installation. Inspect its version and origin against stable >=0.1.0 before replacing packages; automatic downgrade is disabled. Continuing with unrelated packages.",
		);
	}
	const repositoryPackages = [];
	const aurPackages = [];

	for (const pkg of valid) {
		if (status.get(pkg) === "held") continue;
		if (initiallyInstalled.has(pkg)) {
			status.set(pkg, pkg === "t3code-bin" && !(await stableDesktopInstalled()) ? "held" : "skipped");
		} else if (pkg !== "t3code-bin" && await packageInRepositoryImpl(pkg)) {
			repositoryPackages.push(pkg);
		} else if (!aurHelper) {
			status.set(pkg, "missing");
		} else if (await packageInAurImpl(pkg, aurHelper)) {
			aurPackages.push(pkg);
		} else {
			status.set(pkg, "missing");
		}
	}

	await installBatchWithFallback({
		packages: repositoryPackages,
		batchCommand: `sudo -n pacman -S --needed --noconfirm ${repositoryPackages.join(" ")}`,
		individualCommand: (pkg) => `sudo -n pacman -S --needed --noconfirm ${pkg}`,
		status,
		getInstalledPackagesImpl,
		runCommandImpl,
	});
	await installBatchWithFallback({
		packages: aurPackages,
		batchCommand: `${aurHelper} -S --needed --noconfirm --batchinstall ${aurPackages.map((pkg) => pkg === "t3code-bin" ? "aur/t3code-bin" : pkg).join(" ")}`,
		individualCommand: (pkg) => `${aurHelper} -S --needed --noconfirm ${pkg === "t3code-bin" ? "aur/t3code-bin" : pkg}`,
		status,
		getInstalledPackagesImpl,
		runCommandImpl,
	});
	if (status.get("t3code-bin") === "installed" && !(await stableDesktopInstalled()))
		status.set("t3code-bin", "held");

	return {
		installed: valid.filter((pkg) => status.get(pkg) === "installed"),
		failed: valid.filter((pkg) => status.get(pkg) === "failed"),
		missing: valid.filter((pkg) => status.get(pkg) === "missing"),
		invalid,
		skipped: valid.filter((pkg) => status.get(pkg) === "skipped"),
		held: valid.filter((pkg) => status.get(pkg) === "held"),
	};
}

export async function installPackagesFromFile(filePath, installerCmd) {
	if (!fs.existsSync(filePath)) {
		log.warning(`Package file not found at ${filePath}`);
		return;
	}

	const content = fs.readFileSync(filePath, "utf-8");
	const requested = content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));

	if (requested.length === 0) return;

	// Pre-filter against pacman's local DB so paru isn't invoked for packages
	// that are already installed — the big saving is skipping AUR HTTP lookups
	// on re-runs. `--needed` on the install command catches the edge cases this
	// exact-name match misses (e.g. a package satisfying a `provides` we want).
	// Only applied when installerCmd routes through pacman/paru.
	let toInstall = requested;
	let skipped = 0;
	if (installerCmd.includes("paru") || installerCmd.includes("pacman")) {
		const installed = await getInstalledPackages();
		toInstall = requested.filter((pkg) => !installed.has(pkg));
		skipped = requested.length - toInstall.length;
	}

	if (skipped > 0) {
		log.info(
			`${skipped} of ${requested.length} packages already installed — skipping.`,
		);
	}

	if (toInstall.length === 0) {
		log.success("All requested packages already installed.");
		return;
	}

	log.info(`Installing ${toInstall.length} packages individually...`);
	const failed = [];

	for (const pkg of toInstall) {
		const ok = await runCommand(`${installerCmd} ${pkg}`);
		if (ok) {
			log.success(`Installed ${pkg}`);
		} else {
			log.warning(`Failed to install ${pkg}, continuing...`);
			failed.push(pkg);
		}
	}

	if (failed.length > 0) {
		log.warning(
			`${failed.length} package(s) failed to install:\n  ${failed.join("\n  ")}`,
		);
	}
}
