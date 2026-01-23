import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import prompts from "prompts";
import { log, promptUser, runCommand } from "../common/utils.js";

const HOME = homedir();
const SSH_DIR = path.join(HOME, ".ssh");

async function createProfile(profileType) {
	log.info(`--- Setting up ${profileType} Git profile ---`);
	const profileDir = path.join(HOME, profileType);
	fs.mkdirSync(profileDir, { recursive: true });

	const response = await prompts([
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

	const keyPath = path.join(SSH_DIR, `${profileType}_key`);
	const gitConfigPath = path.join(profileDir, `.gitconfig.${profileType}`);

	// Generate SSH Key
	log.info(`Generating SSH key for ${profileType}...`);
	await runCommand(
		`ssh-keygen -t ed25519 -C "${response.email}" -f ${keyPath} -N "" -q`,
	);

	// Add to Agent
	log.info(`Adding ${profileType} SSH key to agent...`);
	await runCommand(`ssh-add ${keyPath}`);

	// Create Git Config
	const gitConfigContent = `[user]
    email = ${response.email}
    name = ${response.username}
    signingkey = ${keyPath}

[github]
    user = "${response.githubUser}"

[commit]
    gpgsign = true

[gpg]
    format = ssh

[core]
    sshCommand = "ssh -i ${keyPath}"
`;

	fs.writeFileSync(gitConfigPath, gitConfigContent);
	log.info(`Created ${gitConfigPath}`);
}

export async function configureGit() {
	log.info("Configuring Git...");
	fs.mkdirSync(SSH_DIR, { mode: 0o700, recursive: true });

	// Start SSH Agent
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

	let workProfileCreated = false;
	if (await promptUser("Do you want to create a work Git profile?", true)) {
		await createProfile("work");
		workProfileCreated = true;
	}

	await createProfile("personal");

	// Global Config
	let globalConfigContent = `[includeIf "gitdir:~/personal/"]
    path = ~/personal/.gitconfig.personal
`;

	if (workProfileCreated) {
		globalConfigContent += `[includeIf "gitdir:~/work/"]
    path = ~/work/.gitconfig.work
`;
	}

	const globalGitConfigPath = path.join(HOME, ".gitconfig");
	fs.writeFileSync(globalGitConfigPath, globalConfigContent);

	log.info(`Created global git config at ${globalGitConfigPath}`);
	log.warning(
		"ACTION REQUIRED: Copy the contents of the .pub files in ~/.ssh and add them to your GitHub accounts.",
	);
}
