import fs from "node:fs";
import path from "node:path";

// A zero-block, connected monitor keeps older helper scenarios topology-neutral.
// Reordered blocks and missing targets are exercised in workspace_targets tests.
export function workspaceTargetFixture(home, monitor = "DP-1") {
	const config = path.join(home, ".config/haoshoku");
	const state = path.join(home, ".local/state/omarchy");
	fs.mkdirSync(config, { recursive: true });
	fs.mkdirSync(state, { recursive: true });
	fs.writeFileSync(
		path.join(config, "workspace-monitors"),
		Array.from(
			{ length: 10 },
			(_, index) => `${index + 1}\t${monitor}\t${index + 1}\n`,
		).join(""),
	);
	fs.writeFileSync(
		path.join(state, "monitor-workspaces"),
		`0\t${monitor}\t${monitor}\n`,
	);
}
