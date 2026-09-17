import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const read = (relativePath) =>
	fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const compact = (value) => value.replace(/\s+/g, " ");

const policyPath = "configs/agent-skills/model-routing/SKILL.md";
const briefingsPath =
	"configs/agent-skills/model-routing/references/briefings.md";
const mattPath =
	"configs/agent-skills/model-routing/references/matt-workflows.md";
const babysitPath = "configs/agent-skills/paseo-pr-babysit/SKILL.md";

describe("accepted workflow routing policy", () => {
	it("keeps 21 stable profiles while selecting the two explicit Sonnet xhigh exceptions", () => {
		const bundled = JSON.parse(read("configs/paseo/agent-profiles.json"));
		const profiles = new Map(
			bundled.agentProfiles.map((profile) => [profile.id, profile]),
		);

		expect(bundled.agentProfiles).toHaveLength(21);
		expect(new Set(profiles.keys()).size).toBe(21);
		expect(profiles.get("explore-codebase")).toMatchObject({
			model: "claude-sonnet-5",
			thinkingOptionId: "xhigh",
		});
		expect(profiles.get("explainer")).toMatchObject({
			model: "claude-sonnet-5",
			thinkingOptionId: "xhigh",
		});
		expect(profiles.get("explainer-review")).toMatchObject({
			model: "gpt-5.6-luna",
			thinkingOptionId: "max",
		});
		expect(bundled.providers.grok.enabled).toBe(false);
	});

	it("defines ordinary and high-stakes pairs without making xhigh a blanket route", () => {
		const policy = compact(read(policyPath));
		const briefings = compact(read(briefingsPath));

		expect(policy).toContain("Sol medium author");
		expect(policy).toContain("Opus medium reviewer");
		expect(policy).toContain("Opus high author");
		expect(policy).toContain("fresh Sol high reviewer");
		expect(policy).toContain("Difficulty without high stakes");
		expect(policy).toContain("Sonnet xhigh");
		expect(policy).toContain("Luna max");
		expect(policy).toContain(
			"no routine mandatory Astra advisor gate; the high-stakes Fable requirement below remains",
		);
		expect(policy).toContain("ordinary peer PR review");
		expect(policy).toContain("Opus");
		expect(briefings).toContain("including uncommitted changes");
		expect(briefings).toContain("authored none of the candidate");
	});

	it("requires explicit escalation handoff and a full first review", () => {
		const briefings = compact(read(briefingsPath));

		expect(briefings).toContain("checkpoint");
		expect(briefings).toContain("transfer implementation ownership");
		expect(briefings).toContain("stop concurrent authorship");
		expect(briefings).toContain(
			"first review after the handoff covers the full candidate",
		);
		expect(briefings).toContain("former author session");
	});

	it("selects one pair for implement and the whole implement-spec graph", () => {
		const matt = compact(read(mattPath));

		expect(matt).toContain("Select the pair at intake");
		expect(matt).toContain("same author session for fixes");
		expect(matt).toContain("one pair for the whole specification graph");
		expect(matt).toContain("fresh opposite-family reviewer");
		expect(matt).toContain("combined branch");
		expect(matt).toContain("fresh opposite-family reviewer at high effort");
	});

	it("binds every authored-PR repair batch and response to its selected pair", () => {
		const babysit = compact(read(babysitPath));

		expect(babysit).toContain("select one pair per repair batch");
		expect(babysit).toContain("same author session");
		expect(babysit).toContain("candidate SHA");
		expect(babysit).toContain("response content digest");
		expect(babysit).toContain("SHA-256 of each exact UTF-8 response body");
		expect(babysit).toContain("Monitor | `pr-monitor`");
		expect(babysit).toContain("Watchdog | `pr-watchdog`");
	});

	it("keeps bundled global templates aligned with the shared agent profile", () => {
		const profile = compact(read("configs/agent-profile/PROFILE.md"));
		for (const relativePath of [
			"configs/codex/AGENTS.md",
			"configs/claude/CLAUDE.md",
		]) {
			const template = compact(read(relativePath));
			expect(template, relativePath).toBe(profile);
			expect(template, relativePath).toContain("Orca orchestration");
			expect(template, relativePath).toContain("Axstack workflows");
			expect(template, relativePath).toContain("gh stack");
		}
	});
});
