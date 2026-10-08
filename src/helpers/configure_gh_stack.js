import { commandExists, log } from "../common/utils.js";
import { recordNextStep } from "../common/run_log.js";

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
	const failed = (reason, exitCode) => {
		const message = exitCode === 4 ? "GitHub CLI is not authenticated" : reason;
		const guidance =
			exitCode === 4
				? "Run gh auth login, then haoshoku --gh-stack."
				: "Resolve the GitHub CLI error, then run haoshoku --gh-stack.";
		logImpl.warning(
			`${message} — skipping gh-stack installation and continuing.`,
		);
		recordNextStep("gh-stack", `${message}. ${guidance}`);
		return "failed";
	};
	if (!(await commandExistsImpl("gh"))) {
		logImpl.info(
			"GitHub CLI (gh) is not on PATH. Skipping gh-stack extension.",
		);
		recordNextStep(
			"gh-stack",
			"GitHub CLI is missing. Install GitHub CLI, then run gh auth login and haoshoku --gh-stack.",
		);
		return "missing-gh";
	}

	let listed;
	try {
		listed = await runner(["gh", "extension", "list"]);
	} catch (err) {
		return failed(
			`Could not list GitHub CLI extensions (${err?.message ?? err})`,
		);
	}

	if (listed.exitCode !== 0) {
		return failed(
			`Could not list GitHub CLI extensions (exit code ${listed.exitCode})`,
			listed.exitCode,
		);
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
		return failed(
			`GitHub gh-stack extension installation failed (exit code ${installed.exitCode})`,
			installed.exitCode,
		);
	} catch (err) {
		return failed(
			`GitHub gh-stack extension installation failed (${err?.message ?? err})`,
		);
	}
}
