import { expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const POLICY_PATH = path.resolve(
	import.meta.dir,
	"../configs/claude/CLAUDE.md",
);
const APPROVED_LEDGER_SENTENCE =
	"Capability/reasoning routing is not a task tier, score, lane ledger, or caller model/effort choice.";
const ROUTING_LEDGER = /\b(?:routing|lane)\s+ledger\b/gi;

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

function expectDesignedWorkContract(designedWork) {
	expect(designedWork).toMatch(
		/1\.\s*Fable[\s\S]*?(?:architecture|acceptance criteria)[\s\S]*?2\.\s*Sol[\s\S]*?adversarial[\s\S]*?read-only\s+`?sol-wrapper`?[\s\S]*?3\.\s*Fable[\s\S]*?corrects[\s\S]*?automatically/i,
	);
	expect(designedWork).toMatch(
		/if\s+Sol\s+caused\s+(?:any\s+)?plan\s+change[\s\S]*?cold\s+`?sol-wrapper`?\s+dispatch[\s\S]*?revised\s+plan[\s\S]*?final\s+pass/i,
	);
	expect(designedWork).toMatch(
		/6\.\s*Opus[\s\S]*?accepted\s+DAG[\s\S]*?dynamic\s+Workflow[\s\S]*?executes/i,
	);
}

function expectNoPositiveRoutingLedger(policy, completion) {
	expect(policy.match(ROUTING_LEDGER)).toEqual(["lane ledger"]);
	expect(completion).toContain(APPROVED_LEDGER_SENTENCE);
	expect(policy.replace(APPROVED_LEDGER_SENTENCE, "")).not.toMatch(
		ROUTING_LEDGER,
	);
}

it("ships the public single-path Claude orchestration policy", () => {
	const policy = fs.readFileSync(POLICY_PATH, "utf8");
	const discovery = section(policy, "Discovery");
	const straightforward = section(discovery, "Straightforward work", 3);
	const designedWork = section(discovery, "Designed work", 3);
	const roles = section(policy, "Roles");
	const research = section(policy, "Conditional research");
	const governor = section(policy, "Complexity and convergence governor");
	const approval = section(policy, "Approval and authority");
	const completion = section(policy, "Completion");

	expect(policy).toMatch(/^## 1\. One operating model$/m);
	expect(policy).toMatch(
		/every\s+request\s+that\s+produces\s+a\s+change\s+starts\s+with\s+`discovering-work`/i,
	);

	expect(straightforward).toMatch(
		/1\.\s*Opus\s+sends\s+one\b[\s\S]*?sol-wrapper[\s\S]*?2\.\s*Codex\s+implements\s+and\s+verifies[\s\S]*?3\.\s*Opus[\s\S]*?(?:accepts|returns\s+precise\s+corrections)/i,
	);

	expectDesignedWorkContract(designedWork);
	const unconditionalDesignedWork = designedWork.replace(
		/If\s+Sol\s+caused\s+(?:any\s+)?plan\s+change,\s*/i,
		"",
	);
	expect(unconditionalDesignedWork).not.toBe(designedWork);
	expect(() => expectDesignedWorkContract(unconditionalDesignedWork)).toThrow();

	expect(roles).toMatch(
		/Codex\s+and\s+Grok\s+investigate\s+the\s+same\s+external\s+questions\s+independently[\s\S]*?research\s+is\s+triggered/i,
	);
	expect(research).toMatch(
		/paired\s+Codex\s+and\s+Grok\s+research\s+runs\s+only\s+when[\s\S]*?(?:external|current|uncertain|disputed)/i,
	);
	expect(research).toMatch(
		/Claude-native\s+MCP\s+access[\s\S]*?supplement[\s\S]*?never\s+replace[\s\S]*?paired\s+Codex\s+and\s+Grok/i,
	);

	expect(governor).toMatch(
		/acceptance\s+criteria[\s\S]*?durable[\s\S]*?process\s+machinery[\s\S]*?disposable/i,
	);
	expect(governor).toMatch(
		/do\s+not\s+retain\s+unused\s+process\s+machinery[\s\S]*?target-backed\s+delta/i,
	);
	expect(approval).toMatch(
		/proceed\s+automatically[\s\S]*?clear,?\s+reversible\s+work/i,
	);
	expect(approval).toMatch(
		/stop\s+at\s+a\s+newly\s+discovered\s+boundary[\s\S]*?ask\s+before/i,
	);

	expect(policy).not.toMatch(/\bT[0-3]\b/);
	expect(policy).not.toMatch(/\bFAST\b/i);
	expect(policy).not.toMatch(/\bSTANDARD\b/i);
	expect(policy).not.toMatch(/\bone\s+ledger\s+line\b/i);
	expect(policy).not.toContain("--tier");
	expectNoPositiveRoutingLedger(policy, completion);
	const positiveLedgerPolicy = `${policy}\nRecord a routing ledger.`;
	expect(() =>
		expectNoPositiveRoutingLedger(positiveLedgerPolicy, completion),
	).toThrow();
	const positiveCompletion = `${completion}\nRecord a routing ledger.`;
	const policyWithPositiveCompletion = policy.replace(
		completion,
		positiveCompletion,
	);
	expect(() =>
		expectNoPositiveRoutingLedger(
			policyWithPositiveCompletion,
			positiveCompletion,
		),
	).toThrow();
	expect(policy.split("\n").length).toBeLessThan(300);
});
