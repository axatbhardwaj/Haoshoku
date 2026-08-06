import fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import promptsLib from "prompts";
import {
	log,
	promptUser as promptUserDefault,
	safeCopyFile,
} from "../common/utils.js";

const HOME = homedir();
const GIT_PROFILES = Object.freeze({
	personal: {
		directory: "dev",
		filename: ".gitconfig.dev",
		legacyDirectory: "personal",
		legacyFilename: ".gitconfig.personal",
	},
	work: {
		directory: "Work",
		filename: ".gitconfig.work",
		legacyDirectory: "work",
		legacyFilename: ".gitconfig.work",
	},
});

function migrateLegacyProfiles(home) {
	const availableProfiles = new Set();
	for (const [profileType, profile] of Object.entries(GIT_PROFILES)) {
		const legacyDirectory = path.join(home, profile.legacyDirectory);
		const legacyProfile = path.join(legacyDirectory, profile.legacyFilename);
		const destination = path.join(home, profile.directory, profile.filename);
		if (
			profileType === "work" &&
			fs.existsSync(legacyProfile) &&
			!fs.existsSync(destination)
		) {
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.renameSync(legacyProfile, destination);
			log.info(`Moved legacy Git profile ${legacyProfile} to ${destination}.`);
		}
		if (fs.existsSync(legacyProfile)) {
			log.warning(
				`Legacy Git profile found at ${legacyProfile}; move it to ${destination}.`,
			);
		}
		if (fs.existsSync(destination)) availableProfiles.add(profileType);
	}
	return availableProfiles;
}

/**
 * Default runner: spawns an argv array via Bun.spawn and returns its exit code.
 *
 * Using an argv array (not a shell string) is the whole point — the free-form
 * email from the prompt is passed as a discrete argument to ssh-keygen, so a
 * quote or `;` in the email can never break out into shell interpretation.
 *
 * @param {string[]} argv
 * @returns {Promise<{ exitCode: number }>}
 */
async function defaultRunner(argv) {
	const proc = Bun.spawn(argv, {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	return { exitCode };
}

/** Default ssh-agent bootstrap (no-op-able in tests via opts.startAgent). */
async function startSshAgent() {
	try {
		const agentProc = Bun.spawn(["ssh-agent", "-s"]);
		const output = await new Response(agentProc.stdout).text();
		const match = output.match(/SSH_AUTH_SOCK=([^;]+);/);
		if (match) {
			process.env.SSH_AUTH_SOCK = match[1];
		}
		const pidMatch = output.match(/SSH_AGENT_PID=([^;]+);/);
		if (pidMatch) {
			process.env.SSH_AGENT_PID = pidMatch[1];
		}
	} catch (_e) {
		log.warning("Could not start ssh-agent.");
	}
}

/**
 * Create a single Git profile (email/name/signing key) under ~/dev or ~/Work.
 *
 * Key generation is guarded two ways:
 *   - If the key already exists, generation is SKIPPED (ssh-keygen would
 *     otherwise hang on an interactive "Overwrite (y/n)?" prompt) but the
 *     signing config is still emitted — we keep using the existing key.
 *   - If generation runs and FAILS, the profile gitconfig is written WITHOUT
 *     any signing directives. Emitting `gpgsign = true` + a `signingkey` that
 *     doesn't exist would make every future commit in that gitdir fail to sign.
 *
 * @param {string} profileType e.g. "personal" | "work"
 * @param {{ home: string, sshDir: string, promptFn: Function, runner: Function }} ctx
 */
async function createProfile(profileType, { home, sshDir, promptFn, runner }) {
	log.info(`--- Setting up ${profileType} Git profile ---`);
	const profile = GIT_PROFILES[profileType];
	const profileDir = path.join(home, profile.directory);
	fs.mkdirSync(profileDir, { recursive: true });

	const response = await promptFn([
		{
			type: "text",
			name: "email",
			message: `Enter ${profileType} email`,
		},
		{
			type: "text",
			name: "username",
			message: `Enter ${profileType} username`,
		},
		{
			type: "text",
			name: "githubUser",
			message: `Enter GitHub username for ${profileType}`,
		},
	]);

	if (!response.email || !response.username || !response.githubUser) {
		log.error("Missing information. Skipping profile creation.");
		return;
	}

	const keyPath = path.join(sshDir, `${profileType}_key`);
	const gitConfigPath = path.join(profileDir, profile.filename);

	// `signingOk` decides whether we emit the SSH-signing directives. It stays
	// true when we reuse an existing key or generate one successfully, and flips
	// to false only when a fresh generation fails.
	let signingOk = true;

	if (fs.existsSync(keyPath)) {
		// Skip generation: ssh-keygen would otherwise stop on an interactive
		// overwrite prompt and hang the whole setup. The existing key is reused.
		log.info(
			`SSH key ${keyPath} already exists — skipping generation, reusing it.`,
		);
	} else {
		log.info(`Generating SSH key for ${profileType}...`);
		// argv array, NOT a shell string — the email is a discrete argument so
		// quotes/semicolons in it can never be interpreted by a shell.
		const { exitCode } = await runner([
			"ssh-keygen",
			"-t",
			"ed25519",
			"-C",
			response.email,
			"-f",
			keyPath,
			"-N",
			"",
			"-q",
		]);
		if (exitCode !== 0) {
			signingOk = false;
			log.warning(
				`ssh-keygen failed (exit ${exitCode}) for ${profileType} — writing gitconfig WITHOUT SSH signing so future commits aren't blocked by a missing key.`,
			);
		} else {
			// Add to agent (best-effort; argv array, no shell).
			log.info(`Adding ${profileType} SSH key to agent...`);
			await runner(["ssh-add", keyPath]);
		}
	}

	// Build the profile gitconfig. Signing directives are appended only when a
	// usable key is present.
	let gitConfigContent = `[user]
    email = ${response.email}
    name = ${response.username}`;
	if (signingOk) {
		gitConfigContent += `
    signingkey = ${keyPath}`;
	}
	gitConfigContent += `

[github]
    user = "${response.githubUser}"
`;
	if (signingOk) {
		gitConfigContent += `
[commit]
    gpgsign = true

[gpg]
    format = ssh

[core]
    sshCommand = "ssh -i ${keyPath}"
`;
	}

	fs.writeFileSync(gitConfigPath, gitConfigContent);
	log.info(`Created ${gitConfigPath}`);
}

/**
 * Configure Git profiles + the global ~/.gitconfig includeIf routing.
 *
 * Global-config overwrite semantics come from utils.safeCopyFile.
 *
 * Every collaborator is injectable for tests (defaults preserve production
 * behavior): `home`, `sshDir`, `promptFn` (the prompts() multi-question lib),
 * `promptUser` (the yes/no confirm from utils — Ctrl+C aborts, handled there),
 * `runner` (Bun.spawn argv wrapper), and `startAgent`.
 *
 * @param {{
 *   home?: string,
 *   sshDir?: string,
 *   promptFn?: Function,
 *   promptUser?: Function,
 *   runner?: (argv: string[]) => Promise<{ exitCode: number }>,
 *   startAgent?: () => Promise<void>,
 * }} [opts]
 */
export async function configureGit(opts = {}) {
	const {
		home = HOME,
		sshDir = path.join(home, ".ssh"),
		promptFn = promptsLib,
		promptUser = promptUserDefault,
		runner = defaultRunner,
		startAgent = startSshAgent,
	} = opts;

	log.info("Configuring Git...");
	const availableProfiles = migrateLegacyProfiles(home);
	fs.mkdirSync(sshDir, { mode: 0o700, recursive: true });

	await startAgent();

	const ctx = { home, sshDir, promptFn, runner };

	let workProfileCreated = availableProfiles.has("work");
	if (await promptUser("Do you want to create a work Git profile?", true)) {
		await createProfile("work", ctx);
		workProfileCreated = true;
	}

	await createProfile("personal", ctx);

	// Global Config
	const personalProfile = GIT_PROFILES.personal;
	let globalConfigContent = `[includeIf "gitdir:~/${personalProfile.directory}/"]
    path = ~/${personalProfile.directory}/${personalProfile.filename}
`;

	if (workProfileCreated) {
		const workProfile = GIT_PROFILES.work;
		globalConfigContent += `[includeIf "gitdir:~/${workProfile.directory}/"]
    path = ~/${workProfile.directory}/${workProfile.filename}
`;
	}

	const globalGitConfigPath = path.join(home, ".gitconfig");

	// safeCopyFile takes a source path, so stage the generated content outside
	// the home tree where it cannot pollute ~/.ssh.
	const stagePath = path.join(
		fs.mkdtempSync(path.join(tmpdir(), "haoshoku-gitcfg-")),
		"gitconfig",
	);
	fs.writeFileSync(stagePath, globalConfigContent);
	try {
		const wrote = safeCopyFile(stagePath, globalGitConfigPath);
		if (wrote) {
			log.info(`Created global git config at ${globalGitConfigPath}`);
		} else {
			log.info(
				`Global git config at ${globalGitConfigPath} already up to date — left untouched.`,
			);
		}
	} finally {
		fs.rmSync(path.dirname(stagePath), { recursive: true, force: true });
	}

	log.warning(
		"ACTION REQUIRED: Copy the contents of the .pub files in ~/.ssh and add them to your GitHub accounts.",
	);
}
