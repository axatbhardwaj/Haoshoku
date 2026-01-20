import { log, runCommand } from "../common/utils.js";

export async function installOpenAgents() {
	log.info("Installing OpenAgents Control (Advanced Profile)...");

	const installCmd =
		"curl -fsSL https://raw.githubusercontent.com/darrenhinde/OpenAgentsControl/main/install.sh | bash -s advanced";

	const success = await runCommand(installCmd);

	if (success) {
		log.success("OpenAgents Control installed successfully.");
	} else {
		log.error(
			"Failed to install OpenAgents Control. Please check your internet connection or try manually.",
		);
	}
}
