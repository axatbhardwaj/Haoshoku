import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "bun";
import chalk from "chalk";
import prompts from "prompts";

const log = {
	info: (msg) => console.log(chalk.blue(msg)),
	success: (msg) => console.log(chalk.green(msg)),
	warning: (msg) => console.log(chalk.yellow(msg)),
	error: (msg) => console.error(chalk.red(msg)),
	dim: (msg) => console.log(chalk.dim(msg)),
};

const USAGE = `Usage: bun run release [options]

Options:
  --bump=<type>     Version bump type: patch | minor | major | custom
  --version=<x.y.z> Explicit version (implies --bump=custom)
  --yes, -y         Skip the "Ready to release?" confirmation
  --help, -h        Show this help

Examples:
  bun run release                         # interactive (prompts for both)
  bun run release --bump=patch --yes      # non-interactive patch release
  bun run release --version=5.0.0 --yes   # non-interactive custom version

Non-interactive mode is intended for agent / CI use. The git-clean check
is enforced in all modes — there is no --force flag by design.`;

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * Compute the next version string from the current version and a bump type.
 * Pure function — throws on a malformed current/custom version instead of
 * silently producing NaN.NaN.1 tags.
 *
 * @param {string} currentVersion - current semver, e.g. "5.5.3"
 * @param {"patch"|"minor"|"major"|"custom"} bump - bump type
 * @param {string} [explicitVersion] - required when bump === "custom"
 * @returns {string} the next version
 */
export function computeNextVersion(currentVersion, bump, explicitVersion) {
	if (bump === "custom") {
		if (!SEMVER_RE.test(explicitVersion || "")) {
			throw new Error(
				`Invalid custom version: ${explicitVersion} (expected x.y.z)`,
			);
		}
		return explicitVersion;
	}

	if (!SEMVER_RE.test(currentVersion || "")) {
		throw new Error(
			`Invalid current version: ${currentVersion} (expected x.y.z)`,
		);
	}

	const [major, minor, patch] = currentVersion.split(".").map(Number);
	switch (bump) {
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "major":
			return `${major + 1}.0.0`;
		default:
			throw new Error(`Invalid bump type: ${bump}`);
	}
}

/**
 * Replace the single `.version("...")` site in haoshoku.js content with the
 * new version. Throws if no match is found so a silent no-op cannot ship a
 * release with a stale --version.
 *
 * @param {string} content - haoshoku.js source
 * @param {string} newVersion - version to write
 * @returns {string} updated content
 */
export function applyVersionBump(content, newVersion) {
	const updated = content.replace(/\.version\(".*"\)/, `.version("${newVersion}")`);
	if (updated === content) {
		throw new Error("version pattern not found in haoshoku.js");
	}
	return updated;
}

/**
 * Rename the Unreleased changelog section for a release. Throws if the heading
 * is absent so a silent no-op cannot strand released entries under Unreleased.
 *
 * @param {string} content - CHANGELOG.md content
 * @param {string} newVersion - release version
 * @param {string} releaseDate - release date in YYYY-MM-DD format
 * @returns {string} updated content
 */
export function applyChangelogRelease(content, newVersion, releaseDate) {
	const updated = content.replace(
		/^## Unreleased$/m,
		`## ${newVersion} - ${releaseDate}`,
	);
	if (updated === content) {
		throw new Error("Unreleased heading not found in CHANGELOG.md");
	}
	return updated;
}

/** Parse argv into { bump, version, yes, help } — no external dep. */
function parseArgs(argv) {
	const args = { bump: null, version: null, yes: false, help: false };
	for (const raw of argv) {
		if (raw === "--help" || raw === "-h") args.help = true;
		else if (raw === "--yes" || raw === "-y") args.yes = true;
		else if (raw.startsWith("--bump=")) args.bump = raw.slice("--bump=".length);
		else if (raw.startsWith("--version=")) args.version = raw.slice("--version=".length);
		else {
			log.error(`Unknown argument: ${raw}`);
			log.info(USAGE);
			process.exit(2);
		}
	}
	return args;
}

async function runCommand(command, args, options = {}) {
	log.dim(`Executing: ${command} ${args.join(" ")}`);

	const proc = spawn([command, ...args], {
		cwd: options.cwd || process.cwd(),
		stdout: "inherit",
		stderr: "inherit",
		...options,
	});

	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error(`Command failed with exit code ${exitCode}`);
	}
}

async function isGitClean() {
	const proc = spawn(["git", "status", "--porcelain"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(
			`git status failed (exit ${exitCode}) — cannot verify clean tree`,
		);
	}
	return output.trim() === "";
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		log.info(USAGE);
		process.exit(0);
	}

	// --version=X.Y.Z implies --bump=custom; let users pass either.
	if (args.version && !args.bump) args.bump = "custom";

	const validBumps = new Set(["patch", "minor", "major", "custom"]);
	if (args.bump && !validBumps.has(args.bump)) {
		log.error(`Invalid --bump value: ${args.bump} (expected patch|minor|major|custom)`);
		process.exit(2);
	}
	if (args.bump === "custom" && !args.version) {
		// We'll fall back to prompting for the version below, but only if a TTY
		// is available. Headless agents/CI lacking a TTY must supply --version.
		if (!process.stdin.isTTY) {
			log.error("--bump=custom requires --version=X.Y.Z when no TTY is attached");
			process.exit(2);
		}
	}

	log.info("🚀 Starting release process...");

	// 1. Check git status
	if (!(await isGitClean())) {
		log.error(
			"Git working directory is not clean. Please commit or stash changes.",
		);
		process.exit(1);
	}

	// 2. Read package.json
	const packagePath = resolve(process.cwd(), "package.json");
	const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
	const currentVersion = pkg.version;

	log.info(`Current version: ${chalk.bold(currentVersion)}`);

	// Ctrl+C / Esc at any prompt cancels the release cleanly (exit 0).
	const onCancel = () => {
		log.info("Release cancelled.");
		process.exit(0);
	};

	// 3. Determine bump (flag or prompt)
	let bump = args.bump;
	if (!bump) {
		const response = await prompts(
			{
				type: "select",
				name: "bump",
				message: "Select version bump",
				choices: [
					{ title: "Patch", value: "patch" },
					{ title: "Minor", value: "minor" },
					{ title: "Major", value: "major" },
					{ title: "Custom", value: "custom" },
				],
			},
			{ onCancel },
		);
		if (!response.bump) process.exit(0);
		bump = response.bump;
	} else {
		log.info(`Bump: ${chalk.bold(bump)}${args.version ? ` (${args.version})` : ""}`);
	}

	let customVersion = args.version;
	if (bump === "custom" && !customVersion) {
		const custom = await prompts(
			{
				type: "text",
				name: "version",
				message: "Enter version number",
				validate: (value) =>
					/^\d+\.\d+\.\d+$/.test(value) ? true : "Invalid version format (x.y.z)",
			},
			{ onCancel },
		);
		customVersion = custom.version;
	}

	let newVersion;
	try {
		newVersion = computeNextVersion(currentVersion, bump, customVersion);
	} catch (error) {
		log.error(error.message);
		process.exit(2);
	}

	if (!newVersion) process.exit(0);

	// 4. Confirm (skip with --yes)
	if (!args.yes) {
		const confirm = await prompts(
			{
				type: "confirm",
				name: "value",
				message: `Ready to release v${newVersion}?`,
				initial: true,
			},
			{ onCancel },
		);
		if (!confirm.value) process.exit(0);
	} else {
		log.info(`Releasing v${newVersion} (--yes)`);
	}

	try {
		// 4. Update package.json
		pkg.version = newVersion;
		writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
		log.success(`Updated package.json to v${newVersion}`);

		// Update haoshoku.js — applyVersionBump throws if no .version() site
		// matches, so a silent no-op cannot ship a stale --version.
		const cliPath = resolve(process.cwd(), "haoshoku.js");
		const cliContent = readFileSync(cliPath, "utf-8");
		writeFileSync(cliPath, applyVersionBump(cliContent, newVersion));
		log.success(`Updated haoshoku.js to v${newVersion}`);

		// Update CHANGELOG.md — applyChangelogRelease throws if no Unreleased
		// heading matches, so a silent no-op cannot strand released entries.
		const changelogPath = resolve(process.cwd(), "CHANGELOG.md");
		const changelogContent = readFileSync(changelogPath, "utf-8");
		const now = new Date();
		const releaseDate = [
			now.getFullYear(),
			String(now.getMonth() + 1).padStart(2, "0"),
			String(now.getDate()).padStart(2, "0"),
		].join("-");
		writeFileSync(
			changelogPath,
			applyChangelogRelease(changelogContent, newVersion, releaseDate),
		);
		log.success(`Updated CHANGELOG.md for v${newVersion}`);

		// 5. Git operations
		await runCommand("git", [
			"add",
			"package.json",
			"haoshoku.js",
			"CHANGELOG.md",
		]);
		await runCommand("git", ["commit", "-m", `chore: release v${newVersion}`]);
		await runCommand("git", [
			"tag",
			"-a",
			`v${newVersion}`,
			"-m",
			`Release v${newVersion}`,
		]);

		log.info("Pushing to GitHub...");
		await runCommand("git", ["push", "--follow-tags"]);

		// 6. GitHub Release
		log.info("Creating GitHub Release...");
		await runCommand("gh", [
			"release",
			"create",
			`v${newVersion}`,
			"--generate-notes",
		]);

		log.success(`✨ Release v${newVersion} completed successfully!`);
	} catch (error) {
		log.error(error.message);
		log.warning("Release failed. You may need to manually revert changes.");
		process.exit(1);
	}
}

// Guard so importing this module (e.g. for unit tests) doesn't run a release.
if (import.meta.main) {
	main().catch((err) => {
		log.error(err?.message ?? String(err));
		process.exit(1);
	});
}
