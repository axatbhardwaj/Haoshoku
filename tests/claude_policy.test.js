import { expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const POLICY_PATH = path.resolve(
	import.meta.dir,
	"../configs/claude/CLAUDE.md",
);

it("ships the public single-path Claude orchestration policy", () => {
	const policy = fs.readFileSync(POLICY_PATH, "utf8");

	expect(policy).toContain("## 1. One operating model");
	expect(policy).toContain("Every request starts with `discovering-work`.");
	expect(policy).toContain("Opus sends one bounded brief to `codex-wrapper`.");
	expect(policy).toContain("Codex implements and verifies the change.");
	expect(policy).toContain("Opus inspects the final state");

	expect(policy).toContain("Fable produces the architecture");
	expect(policy).toContain("Sol reviews the plan adversarially");
	expect(policy).toContain("Fable corrects ordinary findings automatically.");
	expect(policy).toContain("a new cold Codex dispatch gives the revised");
	expect(policy).toContain(
		"Opus renders the accepted DAG as a dynamic Workflow",
	);

	expect(policy).toContain(
		"Codex and Grok investigate the same external questions independently when\nresearch is triggered.",
	);
	expect(policy).toContain(
		"Claude-native MCP access may supplement, but never replace",
	);
	expect(policy).toContain("## 6. Complexity and convergence governor");
	expect(policy).toContain("do not retain unused process machinery");
	expect(policy).toContain("Proceed automatically with clear, reversible work");
	expect(policy).toContain(
		"Stop at a newly discovered boundary and ask before:",
	);

	expect(policy).not.toMatch(/\bT[0-3]\b/);
	expect(policy).not.toContain("FAST lane");
	expect(policy).not.toContain("STANDARD lane");
	expect(policy).not.toContain("one ledger line");
	expect(policy).not.toContain("--tier");
	expect(policy.split("\n").length).toBeLessThan(300);
});
