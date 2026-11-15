import path from "node:path";
import { parseArgs } from "node:util";
import { syncAgentsConfig } from "../src/helpers/configure_agents.js";

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
Deploy patches only the reviewed correction-rule line in Claude and Codex.
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
		const receipt = await syncAgentsConfig({
			home: values.home,
			rulePatch: { mode: positionals[0], evidenceDir: values.evidence },
		});
		console.log(JSON.stringify(receipt, null, 2));
		if (receipt.destinations.some((d) => d.status === "held"))
			process.exitCode = 2;
	}
} catch (error) {
	console.error(JSON.stringify({ status: "held", reason: error.message }));
	process.exitCode = 2;
}
