import path from "node:path";
import { parseArgs } from "node:util";
import { PROJECT_ROOT } from "../src/common/paths.js";
import { runAgentRulePatch } from "../src/helpers/agent_rule_patch.js";
import { AGENT_TARGETS } from "../src/helpers/agent_targets.js";

try {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			home: { type: "string" },
			evidence: { type: "string" },
			help: { type: "boolean" },
		},
	});
	if (values.help) {
		console.log(`Usage: bun scripts/agent-rule-patch.js <plan|deploy|rollback> --home <absolute-home> --evidence <absolute-directory>

Plan creates a NEW private evidence directory and snapshots; it never writes profiles.
Review receipt.json and *.before before deploy. Keep the same checkout, HEAD and source.
Deploy patches only the reviewed correction-rule line in Claude, Codex, Opencode and Gemini.
Rollback reads current files and reverses only this run's applied rule.
Exit 0: all destinations succeeded. Exit 2: held; inspect each reason.
This command operates locally. It never contacts or deploys to other hosts.`);
	} else {
		if (
			positionals.length !== 1 ||
			!values.home ||
			!path.isAbsolute(values.home)
		)
			throw new Error(
				"Specify one mode and an explicit absolute --home; see --help",
			);
		const receipt = runAgentRulePatch({
			mode: positionals[0],
			evidenceDir: values.evidence,
			source: path.join(PROJECT_ROOT, "configs/agent-profile/PROFILE.md"),
			destinations: AGENT_TARGETS.map((t) =>
				path.join(values.home, t.destDir, t.dest),
			),
		});
		console.log(JSON.stringify(receipt, null, 2));
		if (receipt.destinations.some((d) => d.status === "held"))
			process.exitCode = 2;
	}
} catch (error) {
	console.error(JSON.stringify({ status: "held", reason: error.message }));
	process.exitCode = 2;
}
