import { expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const POLICY_PATH = path.resolve(
	import.meta.dir,
	"../configs/claude/CLAUDE.md",
);
const SKILLS_PATH = path.resolve(import.meta.dir, "../configs/claude/skills");

function section(policy, title, level = 2) {
	const hashes = "#".repeat(level);
	const headingText = level === 2 ? `\\d+\\. ${title}` : title;
	const heading = new RegExp(`^${hashes} ${headingText}\\s*$`, "m");
	const start = policy.search(heading);
	expect(start).toBeGreaterThanOrEqual(0);

	const body = policy.slice(policy.indexOf("\n", start) + 1);
	const nextHeading = body.search(new RegExp(`^${hashes}\\s`, "m"));
	return nextHeading < 0 ? body : body.slice(0, nextHeading);
}

function normalized(text) {
	return text.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
}

function expectRule(text, pattern, message) {
	if (!pattern.test(normalized(text))) {
		throw new Error(message);
	}
}

function tableRows(text) {
	return text
		.split("\n")
		.filter((line) => /^\|.+\|\s*$/.test(line))
		.filter((line) => !/^\|\s*(?:Role|Request)\s*\|/i.test(line))
		.filter((line) => !/^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(line));
}

const policy = fs.readFileSync(POLICY_PATH, "utf8");

it("keeps the introduction limited to the named personal preferences", () => {
	const globalPolicyStart = policy.indexOf("# Global Claude Code Policy");
	expect(globalPolicyStart).toBeGreaterThanOrEqual(0);
	const introduction = policy.slice(0, globalPolicyStart);

	expectRule(
		introduction,
		/\bKISS\b[\s\S]*\bYAGNI\b[\s\S]*\bSOLID\b/i,
		"Introduction must retain the KISS, YAGNI, and SOLID preferences",
	);
	expectRule(
		introduction,
		/autonom\w*[\s\S]*section\s+6[\s\S]*only\s+stop-and-ask\s+cases[\s\S]*outside\s+that\s+list[\s\S]*proceed\s+without\s+asking/i,
		"Introduction must forward autonomy to Section 6's exhaustive stop-and-ask list",
	);
	expectRule(
		introduction,
		/tools?[\s\S]*fits?\s+the\s+task[\s\S]*use\s+it\s+freely[\s\S]*don'?t\s+ask/i,
		"Introduction must permit free use of tools that fit the task",
	);
});

it("keeps all eight numbered policy sections in order", () => {
	const globalPolicyStart = policy.indexOf("# Global Claude Code Policy");
	expect(globalPolicyStart).toBeGreaterThanOrEqual(0);
	const numberedSections = [
		...policy.slice(globalPolicyStart).matchAll(/^## (\d+)\. (.+)$/gm),
	].map((match) => `${match[1]}. ${match[2]}`);

	expect(numberedSections).toEqual([
		"1. Roles and models",
		"2. Routing",
		"3. The orchestrator does not implement",
		"4. Evidence",
		"5. Plans",
		"6. Authority",
		"7. Standing safeguards",
		"8. Completion",
	]);
});

it("keeps the seat hierarchy and a model-independent orchestrator", () => {
	const roles = section(policy, "Roles and models");
	const rows = tableRows(roles);

	for (const seat of [
		"fable-planner",
		"opus-reviewer",
		"sol-high-wrapper",
		"sol-medium-wrapper",
		"luna-max-wrapper",
		"grok-wrapper",
		"opencode-wrapper",
	]) {
		expect(
			rows.some((row) => row.includes(`\`${seat}\``)),
			`Roles table is missing the ${seat} seat`,
		).toBe(true);
	}
	const orchestratorRow = rows.find((row) =>
		/\|\s*Orchestrator\s*\|/i.test(row),
	);
	expect(
		orchestratorRow,
		"Roles table is missing the orchestrator row",
	).toBeDefined();
	expectRule(
		orchestratorRow,
		/this\s+session[\s\S]*any\s+model/i,
		"Orchestrator table row must remain model-independent, not pinned to a named model",
	);
	expectRule(
		roles,
		/main\s+session[\s\S]*whatever\s+model\s+it\s+runs[\s\S]*orchestrator/i,
		"Orchestrator prose must apply to the main session whatever model it runs",
	);
	expectRule(
		roles,
		/Fable\s+outranks\s+Sol\s+and\s+Opus[\s\S]*planning\s+and\s+review\s+judgment/i,
		"Fable must outrank Sol and Opus on planning and review judgment",
	);
	expectRule(
		roles,
		/user\s+outranks\s+everyone/i,
		"The user must outrank every agent seat",
	);
});

it("keeps opencode-wrapper safe before deployment and future-compatible after shipping", () => {
	const roles = section(policy, "Roles and models");
	if (!roles.includes("opencode-wrapper")) return;

	const fullSeatRow = tableRows(roles).some((row) => {
		const cells = row
			.split("|")
			.map((cell) => cell.trim())
			.filter(Boolean);
		return cells.length >= 3 && row.includes("`opencode-wrapper`");
	});
	const text = normalized(roles);
	const undeployedCaveat =
		/planned[\s\S]*not\s+yet\s+deployed/i.test(text) &&
		/until[\s\S]*appears[\s\S]*agent\s+list[\s\S]*do\s+not[\s\S]*reference[\s\S]*dispatch/i.test(
			text,
		);

	// Once the seat ships, its full table row replaces the temporary do-not-dispatch caveat.
	expect(
		undeployedCaveat || fullSeatRow,
		"Mentioned opencode-wrapper must be either gated until deployment or present as a full seat row",
	).toBe(true);
});

it("routes every deployed destination skill and limits direct main-thread action", () => {
	const routing = section(policy, "Routing");
	const rows = tableRows(routing);
	const expectedSkills = fs
		.readdirSync(SKILLS_PATH, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => name !== "discovering-work")
		.sort();

	for (const skill of expectedSkills) {
		expect(
			rows.some((row) => row.includes(`\`${skill}\``)),
			`Routing table is missing the deployed ${skill} skill`,
		).toBe(true);
	}
	for (const [rule, pattern] of [
		["reading and searching", /reading\s+and\s+searching/i],
		["running verification commands", /running\s+verification\s+commands/i],
		["conversation", /conversation/i],
		["decisions between phases", /decisions\s+between\s+phases/i],
		["the trivial bypass", /trivial\s+bypass/i],
	]) {
		expectRule(
			routing,
			pattern,
			`Main-thread direct-action list must include ${rule}`,
		);
	}
	expectRule(
		routing,
		/main\s+thread\s+may\s+act\s+directly\s+only\s+for[\s\S]*everything\s+else\s+is\s+delegated/i,
		"Main-thread action must be limited to the enumerated direct-action list",
	);
});

it("prevents the orchestrator from accumulating implementation work", () => {
	const nonImplementation = section(
		policy,
		"The orchestrator does not implement",
	);

	expectRule(
		nonImplementation,
		/trivial\s+bypass[\s\S]*per\s+request,?\s+not\s+per\s+edit/i,
		"Trivial bypass must be budgeted per request, not per edit",
	);
	expectRule(
		nonImplementation,
		/sequence\s+of\s+small\s+edits[\s\S]*one\s+goal[\s\S]*one\s+non-trivial\s+change/i,
		"Small edits serving one goal must count as one non-trivial change",
	);
	expectRule(
		nonImplementation,
		/speed\s+is\s+not\s+a\s+routing\s+reason/i,
		"Speed must not be accepted as a routing reason",
	);
	expectRule(
		nonImplementation,
		/edited\s+three\s+files[\s\S]*without\s+entering\s+a\s+skill[\s\S]*stop\s+and\s+route/i,
		"Editing three files without a skill must trigger stop-and-route",
	);
});

it("requires inspectable evidence rather than self-attestation", () => {
	const evidence = section(policy, "Evidence");

	expectRule(
		evidence,
		/(?:own|self-run)[\s\S]*green\s+test\s+run[\s\S]*not\s+a\s+review[\s\S]*input\s+to\s+the\s+review\s+gate[\s\S]*(?:never|not)\s+a\s+substitute/i,
		"A self-run green test must be only review-gate input, never a review substitute",
	);
	expectRule(
		evidence,
		/bare\s+approval\s+is\s+not\s+evidence[\s\S]*real\s+path[\s\S]*concrete\s+failure\s+scenario/i,
		"Review evidence must cite a real path and concrete failure scenario",
	);
	expectRule(
		evidence,
		/report\.json\s+is\s+ground\s+truth[\s\S]*worker\s+prose\s+is\s+an\s+unverified\s+claim[\s\S]*until\s+inspected/i,
		"report.json must be ground truth and worker prose unverified until inspection",
	);
	expectRule(
		evidence,
		/failed\s+or\s+unverifiable\s+dispatch[\s\S]*review\s+debt[\s\S]*never[\s\S]*clean\s+result/i,
		"Failed or unverifiable dispatches must create review debt, never clean results",
	);
});

it("keeps plans agent-assigned, parallel by default, and uncommitted", () => {
	const plans = section(policy, "Plans");

	expectRule(
		plans,
		/plan\s+names\s+the\s+executing\s+agent\s+for\s+each\s+task[\s\S]*bare\s+file\s+edits[\s\S]*silently\s+assigned[\s\S]*main\s+thread[\s\S]*rewrite/i,
		"Plans must name each executing agent and rewrite bare main-thread file edits",
	);
	expectRule(
		plans,
		/parallelize\s+by\s+default[\s\S]*explicit\s+write\s+scope[\s\S]*scopes\s+are\s+disjoint/i,
		"Plans must parallelize by default with disjoint explicit write scopes",
	);
	expectRule(
		plans,
		/fully\s+sequential\s+plan[\s\S]*states?\s+why\s+parallelization\s+is\s+infeasible/i,
		"Fully sequential plans must explain why parallelization is infeasible",
	);
	expectRule(
		plans,
		/gitignored\s+locations?[\s\S]*never\s+committed/i,
		"Plans must stay in gitignored locations and never be committed",
	);
});

it("keeps the authority stop-and-ask list explicitly exhaustive", () => {
	const authority = section(policy, "Authority");

	expectRule(
		authority,
		/this\s+list\s+is\s+exhaustive/i,
		"Authority must explicitly state: This list is exhaustive",
	);
});

it("requires autonomous action outside the exhaustive authority list", () => {
	const authority = section(policy, "Authority");

	expectRule(
		authority,
		/anything\s+outside\s+it[\s\S]*clear\s+and\s+reversible[\s\S]*proceed\s+without\s+asking/i,
		"Clear, reversible work outside the exhaustive list must proceed without asking",
	);
});

it("preserves dirty work, ephemeral artifacts, consumer formats, and posting gates", () => {
	const safeguards = section(policy, "Standing safeguards");

	expectRule(
		safeguards,
		/never\s+git\s+add\s+-A[\s\S]*repository\s+with\s+unrelated\s+work\s+in\s+progress/i,
		"git add -A must be forbidden when unrelated work is in progress",
	);
	expectRule(
		safeguards,
		/plans,?\s+specs,?\s+reports,?\s+and\s+temporary\s+state[\s\S]*gitignored\s+locations[\s\S]*never\s+committed/i,
		"Plans, specs, reports, and temporary state must stay gitignored and uncommitted",
	);
	expectRule(
		safeguards,
		/agents\s+execute\s+it[\s\S]*task\s+lists\s+derived\s+from\s+an\s+already-approved\s+plan[\s\S]*plain\s+markdown/i,
		"Task lists derived from an already-approved plan must be plain markdown",
	);
	expectRule(
		safeguards,
		/planning\s+artifacts\s+are\s+HTML,?\s+always[\s\S]*plans,?\s+implementation\s+plans,?\s+and\s+specs[\s\S]*self-contained\s+dark\s+HTML[\s\S]*html-explainer[\s\S]*never\s+as\s+markdown/i,
		"Plans, implementation plans, and specs must be self-contained dark HTML via html-explainer, never markdown",
	);
	expectRule(
		safeguards,
		/human\s+reads\s+and\s+decides\s+on\s+it[\s\S]*research\s+write-ups,?\s+audits,?\s+review\s+reports,?\s+explainers,?\s+status\s+pages[\s\S]*self-contained\s+dark\s+HTML[\s\S]*html-explainer/i,
		"Human-read artifacts must be self-contained dark HTML via html-explainer",
	);
	expectRule(
		safeguards,
		/machine-read\s+policy,?\s+memory,?\s+and\s+status\s+files[\s\S]*plain\s+text/i,
		"Machine-read policy, memory, and status files must stay plain text",
	);
	expectRule(
		safeguards,
		/never\s+auto-post\s+to\s+GitHub[\s\S]*skill\s+explicitly\s+authorizes[\s\S]*review-pr\s+submits\s+reviews[\s\S]*babysit-pr\s+pushes[\s\S]*Opus\s+gate/i,
		"GitHub auto-posting must remain limited to review-pr and gated babysit-pr actions",
	);
});

it("requires real-state inspection, exact checks, review status, and debt at completion", () => {
	const completion = section(policy, "Completion");

	expectRule(
		completion,
		/inspect\s+real\s+state/i,
		"Completion must inspect real state",
	);
	expectRule(
		completion,
		/run\s+the\s+checks\s+that\s+exercise\s+the\s+requested\s+behavior[\s\S]*proportionate\s+regression\s+gate[\s\S]*exact\s+commands\s+and\s+outcomes/i,
		"Completion must run behavior checks plus a proportionate regression gate and report exact outcomes",
	);
	expectRule(
		completion,
		/review\s+findings\s+or\s+explicit\s+none/i,
		"Completion must state review findings or explicit none",
	);
	expectRule(
		completion,
		/remaining\s+blockers\s+or\s+review\s+debt[\s\S]*anything\s+deliberately\s+not\s+done/i,
		"Completion must call out blockers, review debt, and deliberate omissions",
	);
});
