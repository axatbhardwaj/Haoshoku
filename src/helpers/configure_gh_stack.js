import { commandExists, log } from "../common/utils.js";

const GH_STACK_REPOSITORY = "github/gh-stack";

async function runGhCommand(argv) {
	const process = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	return { exitCode, stdout, stderr };
}

export function ghStackIsInstalled(output) {
	return /(?:^|\s)github\/gh-stack(?:\s|$)/m.test(output);
}

export async function installGhStack({
	commandExistsImpl = commandExists,
	runner = runGhCommand,
	logImpl = log,
} = {}) {
	if (!(await commandExistsImpl("gh"))) {
		logImpl.info(
			"GitHub CLI (gh) is not on PATH. Skipping gh-stack extension.",
		);
		return "missing-gh";
	}

	let listed;
	try {
		listed = await runner(["gh", "extension", "list"]);
	} catch (err) {
		logImpl.warning(
			`Could not list GitHub CLI extensions (${err?.message ?? err}) — skipping gh-stack installation and continuing.`,
		);
		return "failed";
	}

	if (listed.exitCode !== 0) {
		logImpl.warning(
			`Could not list GitHub CLI extensions (exit code ${listed.exitCode}) — skipping gh-stack installation and continuing.`,
		);
		return "failed";
	}

	if (ghStackIsInstalled(listed.stdout)) return "already-installed";

	try {
		const installed = await runner([
			"gh",
			"extension",
			"install",
			GH_STACK_REPOSITORY,
		]);
		if (installed.exitCode === 0) {
			logImpl.success("Installed GitHub gh-stack extension.");
			return "installed";
		}
		logImpl.warning(
			`GitHub gh-stack extension installation failed (exit code ${installed.exitCode}) — continuing. Authenticate with gh auth login and retry with: haoshoku --gh-stack`,
		);
	} catch (err) {
		logImpl.warning(
			`GitHub gh-stack extension installation failed (${err?.message ?? err}) — continuing. Authenticate with gh auth login and retry with: haoshoku --gh-stack`,
		);
	}

	return "failed";
}
