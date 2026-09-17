import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	backupPaseoProfiles,
	extractPaseoPolicy,
	mergePaseoPolicy,
	syncPaseoProfiles,
} from "../src/helpers/configure_paseo_profiles.js";

const roots = [];
const policy = {
	version: 1,
	agentProfiles: [
		{
			id: "review-code",
			name: "review-code",
			provider: "claude",
			model: "opus",
			modeId: "safe",
			thinkingOptionId: "medium",
			notes: "Review the exact candidate.",
		},
	],
	providers: {
		grok: { extends: "acp", command: ["grok", "agent", "stdio"] },
		copilot: { enabled: false },
	},
};

const recurringOpusProfiles = [
	{
		id: "pr-monitor",
		name: "PR Monitor",
		provider: "claude",
		model: "claude-opus-5",
		modeId: "bypassPermissions",
		thinkingOptionId: "low",
	},
	{
		id: "pr-watchdog",
		name: "PR Watchdog",
		provider: "claude",
		model: "claude-opus-5",
		modeId: "bypassPermissions",
		thinkingOptionId: "low",
	},
];

const currentWorkflowProfiles = [
	{
		id: "docs",
		name: "Documentation",
		provider: "claude",
		model: "claude-opus-5",
		modeId: "bypassPermissions",
		thinkingOptionId: "low",
	},
	{
		id: "pr-requirements",
		name: "PR Requirements Review",
		provider: "claude",
		model: "claude-opus-5",
		modeId: "bypassPermissions",
		thinkingOptionId: "medium",
	},
	recurringOpusProfiles[0],
];

const renamedWorkflowProfiles = [
	{
		id: "research-web",
		name: "Web Research",
		provider: "claude",
		model: "claude-opus-5",
		modeId: "bypassPermissions",
		thinkingOptionId: "low",
	},
	{
		id: "pr-correctness",
		name: "PR Correctness Review",
		provider: "claude",
		model: "claude-opus-5",
		modeId: "bypassPermissions",
		thinkingOptionId: "medium",
	},
	...recurringOpusProfiles,
];

const currentResearchAndExplainerProfiles = [
	{
		id: "research-requirements",
		name: "Requirements Research",
		provider: "claude",
		model: "claude-opus-5",
		modeId: "bypassPermissions",
		thinkingOptionId: "medium",
	},
	{
		id: "explainer",
		name: "Visual Explainer",
		provider: "claude",
		model: "claude-sonnet-5",
		modeId: "bypassPermissions",
		thinkingOptionId: "xhigh",
	},
];

const responsibilityProfileReplacements = new Map([
	["fable-planner", "planning-advisor"],
	["research-opus", "research-requirements"],
	["research-sol-medium", "research-code"],
	["implement-sol-high", "implement-code"],
	["review-opus", "review-code"],
	["docs-glm", "docs"],
	["pr-security-opus", "pr-security"],
	["pr-integration-sol", "pr-integration"],
	["pr-requirements-glm", "pr-requirements"],
	["pr-architecture-opus", "pr-architecture"],
	["explore-sonnet", "explore-codebase"],
	["explore-terra", "explore-execution"],
	["explainer-opus", "explainer"],
	["explainer-review-terra", "explainer-review"],
	["explainer-content-sol", "explainer-content"],
	["explainer-content-opus", "explainer-content-review"],
]);

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-paseo-policy-"));
	roots.push(root);
	const home = path.join(root, "home");
	const projectRoot = path.join(root, "project");
	const policyPath = path.join(
		projectRoot,
		"configs",
		"paseo",
		"agent-profiles.json",
	);
	fs.mkdirSync(path.dirname(policyPath), { recursive: true });
	fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
	return {
		configPath: path.join(home, ".paseo", "config.json"),
		home,
		policyPath,
		projectRoot,
	};
}

const logger = (warnings = [], info = []) => ({
	error: (value) => warnings.push(value),
	info: (value) => info.push(value),
	success() {},
	warning: (value) => warnings.push(value),
});

describe("Paseo orchestration policy", () => {
	it("extracts only profile and provider whitelist fields", () => {
		const extracted = extractPaseoPolicy({
			daemon: {
				auth: { password: "secret" },
				relay: { token: "secret" },
				agentProfiles: [{ ...policy.agentProfiles[0], secret: "drop" }],
			},
			agents: {
				providers: {
					grok: { ...policy.providers.grok, env: { KEY: "secret" } },
				},
			},
			app: { baseUrl: "private" },
		});

		expect(extracted).toEqual({
			version: 1,
			agentProfiles: policy.agentProfiles,
			providers: { grok: policy.providers.grok },
		});
		expect(JSON.stringify(extracted)).not.toContain("secret");
	});

	it("merges managed ids while preserving unknown state and provider secrets", () => {
		const live = {
			version: 1,
			daemon: {
				auth: { password: "bcrypt" },
				relay: { enabled: true },
				listen: "127.0.0.1:7777",
				cors: ["private"],
				agentProfiles: [
					{ id: "review-code", model: "old" },
					{ id: "personal", model: "keep" },
				],
			},
			agents: {
				providers: {
					grok: { env: { GROK_TOKEN: "keep" }, command: ["old"] },
				},
			},
		};
		const original = structuredClone(live);

		const merged = mergePaseoPolicy(live, policy);

		expect(live).toEqual(original);
		expect(merged.daemon.auth).toEqual(live.daemon.auth);
		expect(merged.daemon.relay).toEqual(live.daemon.relay);
		expect(merged.daemon.listen).toBe(live.daemon.listen);
		expect(merged.daemon.cors).toEqual(live.daemon.cors);
		expect(merged.daemon.agentProfiles).toEqual([
			policy.agentProfiles[0],
			{ id: "personal", model: "keep" },
		]);
		expect(merged.agents.providers.grok).toEqual({
			env: { GROK_TOKEN: "keep" },
			...policy.providers.grok,
		});
	});

	it("replaces managed role IDs while preserving custom profiles and secrets", () => {
		const projectRoot = path.resolve(import.meta.dir, "..");
		const bundledPolicy = JSON.parse(
			fs.readFileSync(
				path.join(projectRoot, "configs", "paseo", "agent-profiles.json"),
				"utf8",
			),
		);
		const liveProfiles = [
			{
				id: "planning-advisor",
				name: "Live Planning Advisor",
				provider: "claude",
				model: "live-fable",
				credentials: { token: "keep-planning-secret" },
			},
			{
				id: "implement-code",
				name: "Live Implementation",
				provider: "codex",
				model: "live-sol",
				env: { IMPLEMENT_TOKEN: "keep-implementation-secret" },
			},
			{
				id: "review-code",
				name: "Live Review",
				provider: "claude",
				model: "live-opus",
				notes: "keep live review differences",
			},
			{
				id: "custom-role",
				name: "Custom Role",
				provider: "private",
				model: "custom-model",
				secret: "keep-custom-secret",
			},
		];
		const live = {
			version: 7,
			daemon: {
				auth: { password: "keep-auth-secret" },
				agentProfiles: liveProfiles,
			},
			agents: {
				providers: {
					codex: { env: { CODEX_TOKEN: "keep-provider-secret" } },
				},
			},
		};

		const merged = mergePaseoPolicy(live, bundledPolicy);
		const bundledProfiles = new Map(
			bundledPolicy.agentProfiles.map((profile) => [profile.id, profile]),
		);

		for (const id of ["planning-advisor", "implement-code", "review-code"]) {
			expect(merged.daemon.agentProfiles).toContainEqual(
				bundledProfiles.get(id),
			);
		}
		expect(merged.daemon.agentProfiles.at(-1)).toEqual(liveProfiles.at(-1));
		expect(merged.daemon.auth).toEqual(live.daemon.auth);
		expect(merged.agents.providers.codex).toEqual(live.agents.providers.codex);
		expect(mergePaseoPolicy(merged, bundledPolicy)).toEqual(merged);
	});

	it("retires every model-bearing alias only when its responsibility is bundled", () => {
		const projectRoot = path.resolve(import.meta.dir, "..");
		const bundledPolicy = JSON.parse(
			fs.readFileSync(
				path.join(projectRoot, "configs", "paseo", "agent-profiles.json"),
				"utf8",
			),
		);
		const customProfile = {
			id: "custom-high",
			model: "private-model",
			secret: "keep-custom-secret",
		};
		const live = {
			version: 17,
			daemon: {
				auth: { token: "keep-auth-secret" },
				agentProfiles: [
					...[...responsibilityProfileReplacements].map(([id]) => ({
						id,
						thinkingOptionId: "high",
						secret: `retire-${id}`,
					})),
					customProfile,
				],
			},
			agents: {
				providers: { codex: { env: { CODEX_TOKEN: "keep-provider-secret" } } },
			},
		};

		const merged = mergePaseoPolicy(live, bundledPolicy);
		const mergedIds = merged.daemon.agentProfiles.map(({ id }) => id);

		for (const [legacyId, replacementId] of responsibilityProfileReplacements) {
			expect(mergedIds).not.toContain(legacyId);
			expect(mergedIds).toContain(replacementId);
		}
		expect(merged.daemon.agentProfiles.at(-1)).toEqual(customProfile);
		expect(merged.daemon.auth).toEqual(live.daemon.auth);
		expect(merged.agents.providers.codex).toEqual(live.agents.providers.codex);
		expect(mergePaseoPolicy(merged, bundledPolicy)).toEqual(merged);

		const noReplacement = mergePaseoPolicy(
			{ daemon: { agentProfiles: [{ id: "implement-sol-high" }] } },
			policy,
		);
		expect(noReplacement.daemon.agentProfiles.at(-1)).toEqual({
			id: "implement-sol-high",
		});
	});

	it("replaces retired managed profiles without disturbing unrelated live state", () => {
		const upgradedPolicy = {
			...policy,
			agentProfiles: [...policy.agentProfiles, ...currentWorkflowProfiles],
		};
		const live = {
			version: 7,
			daemon: {
				auth: { password: "bcrypt" },
				relay: { enabled: true, token: "keep" },
				listen: "127.0.0.1:7777",
				state: { currentAgentId: "keep-running" },
				agentProfiles: [
					{ id: "docs-muse", model: "retired-customized" },
					{ id: "pr-requirements-muse", model: "retired" },
					{ id: "pr-monitor-muse", model: "retired" },
					{ id: "personal", provider: "opencode", model: "keep" },
				],
			},
			agents: {
				providers: {
					opencode: { env: { OPENCODE_API_KEY: "keep" } },
					private: { command: ["keep-provider"] },
				},
			},
			app: { baseUrl: "https://private.example" },
		};

		const merged = mergePaseoPolicy(live, upgradedPolicy);

		expect(mergePaseoPolicy(merged, upgradedPolicy)).toEqual(merged);
		expect(merged.version).toBe(7);
		expect(merged.daemon).toMatchObject({
			auth: live.daemon.auth,
			relay: live.daemon.relay,
			listen: live.daemon.listen,
			state: live.daemon.state,
		});
		expect(merged.daemon.agentProfiles).toEqual([
			policy.agentProfiles[0],
			...currentWorkflowProfiles,
			{ id: "personal", provider: "opencode", model: "keep" },
		]);
		expect(merged.agents.providers.opencode).toEqual(
			live.agents.providers.opencode,
		);
		expect(merged.agents.providers.private).toEqual(
			live.agents.providers.private,
		);
		expect(merged.app).toEqual(live.app);
	});

	it("removes a retired profile only when its replacement is managed", () => {
		const retired = [
			{ id: "docs-muse", model: "keep-until-replacement" },
			{ id: "pr-requirements-muse", model: "keep-until-replacement" },
			{ id: "pr-monitor-muse", model: "retire" },
		];
		const merged = mergePaseoPolicy(
			{ daemon: { agentProfiles: retired } },
			{
				...policy,
				agentProfiles: [...policy.agentProfiles, currentWorkflowProfiles[2]],
			},
		);

		expect(merged.daemon.agentProfiles).toEqual([
			policy.agentProfiles[0],
			currentWorkflowProfiles[2],
			retired[0],
			retired[1],
		]);
	});

	it("migrates renamed workflow aliases idempotently while preserving unrelated state", () => {
		const renamedPolicy = {
			...policy,
			agentProfiles: [...policy.agentProfiles, ...renamedWorkflowProfiles],
		};
		const live = {
			version: 11,
			daemon: {
				auth: { token: "keep-auth-secret" },
				agentProfiles: [
					{ id: "research-grok", secret: "retire" },
					{ id: "pr-correctness-grok", secret: "retire" },
					{ id: "pr-monitor-glm", secret: "retire" },
					{ id: "pr-monitor-muse", secret: "retire-alias" },
					{ id: "watchdog-grok", secret: "retire" },
					{ id: "custom-grok-tool", secret: "keep-custom-secret" },
				],
			},
			agents: {
				providers: {
					grok: { env: { GROK_TOKEN: "keep-provider-secret" } },
				},
			},
		};

		const merged = mergePaseoPolicy(live, renamedPolicy);

		expect(merged.daemon.agentProfiles).toEqual([
			policy.agentProfiles[0],
			...renamedWorkflowProfiles,
			{ id: "custom-grok-tool", secret: "keep-custom-secret" },
		]);
		expect(merged.daemon.auth).toEqual(live.daemon.auth);
		expect(merged.agents.providers.grok).toEqual({
			env: { GROK_TOKEN: "keep-provider-secret" },
			...policy.providers.grok,
		});
		expect(mergePaseoPolicy(merged, renamedPolicy)).toEqual(merged);

		const withoutReplacement = mergePaseoPolicy(live, policy);
		expect(withoutReplacement.daemon.agentProfiles.slice(1)).toEqual(
			live.daemon.agentProfiles,
		);
	});

	it("retires legacy research and explainer profiles only with their replacements", () => {
		const legacyResearch = {
			id: "research-sonnet",
			model: "keep-until-replacement",
		};
		const legacyPresentation = {
			id: "explainer-sonnet",
			model: "keep-until-replacement",
		};
		const custom = { id: "research-custom", model: "keep" };
		const live = {
			version: 9,
			daemon: {
				auth: { password: "keep" },
				state: { currentAgentId: "keep" },
				agentProfiles: [legacyResearch, legacyPresentation, custom],
			},
			agents: {
				providers: { claude: { env: { API_TOKEN: "keep" } } },
			},
		};
		const researchOnlyPolicy = {
			...policy,
			agentProfiles: [
				...policy.agentProfiles,
				currentResearchAndExplainerProfiles[0],
			],
		};

		const researchOnly = mergePaseoPolicy(live, researchOnlyPolicy);

		expect(researchOnly.daemon.agentProfiles).toEqual([
			policy.agentProfiles[0],
			currentResearchAndExplainerProfiles[0],
			legacyPresentation,
			custom,
		]);
		expect(researchOnly.daemon.auth).toEqual(live.daemon.auth);
		expect(researchOnly.daemon.state).toEqual(live.daemon.state);
		expect(researchOnly.agents.providers.claude).toEqual(
			live.agents.providers.claude,
		);
		const presentationOnly = mergePaseoPolicy(live, {
			...policy,
			agentProfiles: [
				...policy.agentProfiles,
				currentResearchAndExplainerProfiles[1],
			],
		});
		expect(presentationOnly.daemon.agentProfiles).toEqual([
			policy.agentProfiles[0],
			currentResearchAndExplainerProfiles[1],
			legacyResearch,
			custom,
		]);

		const completePolicy = {
			...researchOnlyPolicy,
			agentProfiles: [
				...researchOnlyPolicy.agentProfiles,
				currentResearchAndExplainerProfiles[1],
			],
		};
		const complete = mergePaseoPolicy(researchOnly, completePolicy);

		expect(complete.daemon.agentProfiles).toEqual([
			policy.agentProfiles[0],
			...currentResearchAndExplainerProfiles,
			custom,
		]);
		expect(mergePaseoPolicy(complete, completePolicy)).toEqual(complete);
	});

	it("ships responsibility workflow routes with Grok disabled", () => {
		const projectRoot = path.resolve(import.meta.dir, "..");
		const bundledPolicy = JSON.parse(
			fs.readFileSync(
				path.join(projectRoot, "configs", "paseo", "agent-profiles.json"),
				"utf8",
			),
		);
		const profiles = new Map(
			bundledPolicy.agentProfiles.map((profile) => [profile.id, profile]),
		);

		for (const expected of currentResearchAndExplainerProfiles) {
			const { notes: _notes, ...actual } = profiles.get(expected.id) ?? {};
			expect(actual).toEqual(expected);
		}
		expect(profiles.get("docs")).toMatchObject({
			provider: "claude",
			model: "claude-opus-5",
			modeId: "bypassPermissions",
			thinkingOptionId: "low",
		});
		expect(profiles.get("pr-requirements")).toMatchObject({
			provider: "claude",
			model: "claude-opus-5",
			modeId: "bypassPermissions",
			thinkingOptionId: "medium",
		});
		for (const expected of renamedWorkflowProfiles) {
			const { notes: _notes, ...actual } = profiles.get(expected.id) ?? {};
			expect(actual).toEqual(expected);
		}
		expect(bundledPolicy.providers.grok).toEqual({
			enabled: false,
			extends: "acp",
			label: "Grok",
			description:
				"xAI's Grok Build agentic coding CLI with parallel subagents. Requires a SuperGrok or X Premium+ subscription.",
			command: ["grok", "agent", "stdio"],
		});
		expect(
			bundledPolicy.agentProfiles.some(
				({ provider }) => provider === "opencode",
			),
		).toBe(false);
		for (const retiredId of [
			"research-grok",
			"pr-correctness-grok",
			"pr-monitor-glm",
			"watchdog-grok",
		]) {
			expect(profiles.has(retiredId)).toBe(false);
		}
		expect(
			bundledPolicy.agentProfiles.some(({ id, name }) =>
				`${id} ${name}`.toLowerCase().includes("grok"),
			),
		).toBe(false);
		expect(profiles.has("research-sonnet")).toBe(false);
		expect(profiles.has("explainer-sonnet")).toBe(false);
		const expectedEffort = {
			"planning-advisor": "medium",
			"research-requirements": "medium",
			"research-code": "medium",
			"research-web": "low",
			"implement-code": "medium",
			"review-code": "medium",
			docs: "low",
			"pr-security": "high",
			"pr-correctness": "medium",
			"pr-integration": "medium",
			"pr-requirements": "medium",
			"pr-architecture": "high",
			"pr-complexity": "medium",
			"pr-monitor": "low",
			"pr-watchdog": "low",
			"explore-codebase": "xhigh",
			"explore-execution": "low",
			explainer: "xhigh",
			"explainer-review": "max",
			"explainer-content": "low",
			"explainer-content-review": "medium",
		};
		expect(Object.keys(expectedEffort)).toHaveLength(21);
		for (const [id, effort] of Object.entries(expectedEffort)) {
			expect(profiles.get(id)?.thinkingOptionId, id).toBe(effort);
		}
		expect(
			Object.values(expectedEffort).reduce((counts, effort) => {
				counts[effort] = (counts[effort] ?? 0) + 1;
				return counts;
			}, {}),
		).toEqual({ medium: 10, low: 6, high: 2, xhigh: 2, max: 1 });
		expect(profiles.get("explainer")?.model).toBe("claude-sonnet-5");
		expect(profiles.get("explainer")?.provider).toBe("claude");
		expect(profiles.get("explainer-review")?.model).toBe("gpt-5.6-luna");
		expect(profiles.get("explainer-review")?.provider).toBe("codex");
		expect(
			Object.entries(expectedEffort)
				.filter(([, effort]) => effort === "xhigh")
				.map(([id]) => id),
		).toEqual(["explore-codebase", "explainer"]);
		expect(profiles.get("docs")?.notes).toContain("Ordinary prose stays prose");
		expect(profiles.get("docs")?.notes).toContain("visual-explainer");
		expect(profiles.get("explainer")?.notes).toContain(
			"~/.config/haoshoku/visual-explainer.json",
		);
		expect(profiles.get("explainer")?.notes).toContain("fixed dark or light");
		expect(profiles.get("explainer")?.notes).toContain(
			"explicit per-request theme overrides",
		);
		expect(profiles.get("explainer-review")?.notes).toContain(
			"source accuracy",
		);
		expect(profiles.get("explainer-content")?.notes).toContain(
			"only when assigned",
		);
		for (const id of ["implement-code", "review-code"]) {
			expect(profiles.get(id)?.thinkingOptionId).toBe("medium");
			expect(profiles.get(id)?.notes).toContain("per-launch high override");
		}
	});

	it("ships one authoritative simplicity checklist across peer and checkpoint review", () => {
		const projectRoot = path.resolve(import.meta.dir, "..");
		const skillRoot = path.join(projectRoot, "configs", "agent-skills");
		const bundledPolicy = JSON.parse(
			fs.readFileSync(
				path.join(projectRoot, "configs", "paseo", "agent-profiles.json"),
				"utf8",
			),
		);
		const profiles = new Map(
			bundledPolicy.agentProfiles.map((profile) => [profile.id, profile]),
		);
		const peerReview = fs.readFileSync(
			path.join(skillRoot, "paseo-pr-review", "SKILL.md"),
			"utf8",
		);
		const babysit = fs.readFileSync(
			path.join(skillRoot, "paseo-pr-babysit", "SKILL.md"),
			"utf8",
		);
		const briefings = fs.readFileSync(
			path.join(skillRoot, "model-routing", "references", "briefings.md"),
			"utf8",
		);
		const simplicity = fs.readFileSync(
			path.join(
				skillRoot,
				"model-routing",
				"references",
				"simplicity-review.md",
			),
			"utf8",
		);
		const simplicityContract = simplicity.replace(/\s+/g, " ");

		expect(profiles.get("pr-complexity")).toEqual({
			id: "pr-complexity",
			name: "PR Complexity Review",
			provider: "claude",
			model: "claude-opus-5",
			modeId: "bypassPermissions",
			thinkingOptionId: "medium",
			notes:
				"Independently review only Complexity and Simplicity for the pinned PR revision. Apply ~/.agents/skills/model-routing/references/simplicity-review.md. Return evidence, coverage and limitations; keep product files unchanged, launch no nested review, and submit nothing externally.",
		});
		expect(profiles.get("review-code")?.notes).toContain(
			"~/.agents/skills/model-routing/references/simplicity-review.md",
		);
		expect(peerReview).toContain("six independent reviews");
		expect(peerReview).toContain(
			"| Complexity and simplicity | `pr-complexity` |",
		);
		expect(peerReview).toContain("all six reports");
		expect(peerReview).toContain("six-angle coverage");
		expect(peerReview).toContain("full six-angle re-review");
		expect(babysit).toContain("six-angle workflow is exceptional");
		expect(babysit).not.toContain("five-angle peer-review workflow");
		expect(peerReview).toContain(
			"../model-routing/references/simplicity-review.md",
		);
		expect(briefings).toContain("[simplicity checklist](simplicity-review.md)");
		expect(briefings).toContain("inside the existing `review-code` seat");
		for (const requirement of [
			"unnecessary abstractions",
			"unnecessary layers",
			"unnecessary dependencies",
			"unnecessary configuration",
			"speculative features",
			"concrete simpler alternative",
			"requirements, security, and testability",
			"Fewer lines alone are not enough",
			"non-blocking unless",
			"concrete consequence or documented rule",
			"No unrelated rewrites",
		]) {
			expect(simplicityContract).toContain(requirement);
		}
	});

	it("retires the managed Astra advisor while preserving custom profiles and secrets", () => {
		const policy = JSON.parse(
			fs.readFileSync(
				path.join(import.meta.dir, "..", "configs/paseo/agent-profiles.json"),
				"utf8",
			),
		);
		const live = {
			daemon: {
				auth: { token: "keep" },
				agentProfiles: [
					{
						id: "technical-advisor",
						model: "stale-astra",
						secret: "retire-with-profile",
					},
					{
						id: "custom-astra",
						model: "gpt-6-astra",
						secret: "keep-custom-secret",
					},
				],
			},
		};
		const merged = mergePaseoPolicy(live, policy);
		const fableAdvisor = policy.agentProfiles.find(
			({ id }) => id === "planning-advisor",
		);
		expect(fableAdvisor).toMatchObject({
			name: "Fable Advisor",
			provider: "claude",
			model: "claude-fable-5-1",
			modeId: "bypassPermissions",
			thinkingOptionId: "medium",
		});
		expect(fableAdvisor.notes).toContain("Sole standing planning advisor");
		expect(fableAdvisor.notes).toContain(
			"High-stakes decisions require this advisor's plain AGREE",
		);
		expect(fableAdvisor.notes).toContain(
			"unless the user explicitly overrides the gate",
		);
		expect(
			policy.agentProfiles.some(({ id }) => id === "technical-advisor"),
		).toBe(false);
		expect(
			merged.daemon.agentProfiles.some(({ id }) => id === "technical-advisor"),
		).toBe(false);
		expect(merged.daemon.agentProfiles.at(-1)).toEqual({
			id: "custom-astra",
			model: "gpt-6-astra",
			secret: "keep-custom-secret",
		});
		expect(merged.daemon.auth).toEqual(live.daemon.auth);
		expect(live.daemon.agentProfiles).toHaveLength(2);
		expect(mergePaseoPolicy(merged, policy)).toEqual(merged);
	});

	it("routes sole-advisor planning while keeping known work direct", () => {
		const root = path.join(
			import.meta.dir,
			"..",
			"configs",
			"agent-skills",
			"model-routing",
		);
		const routing = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
		const briefings = fs.readFileSync(
			path.join(root, "references", "briefings.md"),
			"utf8",
		);
		const mattWorkflows = fs.readFileSync(
			path.join(root, "references", "matt-workflows.md"),
			"utf8",
		);
		const readme = fs.readFileSync(
			path.join(import.meta.dir, "..", "README.md"),
			"utf8",
		);
		const readmeContract = readme.replace(/\s+/g, " ");
		expect(routing).toContain(
			"The main conversation is the driver, using its selected model",
		);
		for (const contract of [
			"Prefer Astra at low reasoning",
			"preferred Astra driver starts at low",
			"unrelated work returns to low",
			"xhigh only for an explicit exceptional request",
			"no dedicated Astra advisor profile",
			"bundled `implement-code` and `review-code` profiles remain at medium",
			"Override `thinkingOptionId` per launch",
			"substantive authorization or trust-boundary changes",
			"wallet, recovery or transaction correctness",
			"irreversible data or infrastructure operations",
			"significant financial or loss risk",
			"material architecture commitments",
			"same substantive defect survives two evidence-backed attempts",
			"evidence rejects the current causal explanation",
			"substantive review finding remains disputed",
			"Inspecting credential configuration, mentioning security",
			"unrelated tasks start at medium",
			"immutable-revision, independent-review, test",
			"native metadata integrity, protected-config or publication-authority gates",
			"unresolved consequential decision",
			"cheap factual checks",
			"a source-linked question and evidence",
			"records its own assessment before reading",
			"Settled and mechanical work continues without renewed consultation",
			"`planning-advisor` at medium as the sole standing advisor",
			"`planning-advisor` must return plain AGREE",
			"unless the user explicitly overrides this gate",
			"Implementation and review use the selected pair",
			"select the ordinary implementation pair below",
			"Cache that discovery and verified workspace ownership for the task",
			"configuration, host, model or mode changes",
			"known quota outages early",
			"Quota evidence never counts as approval",
			"selected profile and capability fields",
		]) {
			expect(routing).toContain(contract);
		}
		expect(mattWorkflows).toContain("implementation-pair policy");
		for (const contract of [
			"compact, source-linked brief",
			"changed evidence",
			"strongest counterargument",
			"targeted resolving check",
			"driver records its accepted assessment",
			"`planning-advisor` must return plain `AGREE`",
			"unless the user explicitly overrides this gate",
			"at most two focused evidence rounds",
		]) {
			expect(briefings).toContain(contract);
		}
		expect(mattWorkflows).toContain("planning-advice triggers");
		expect(mattWorkflows).toContain(
			"One appropriate researcher is the default",
		);
		expect(mattWorkflows).toContain(
			"Invoking `/implement` alone does not launch nested review agents",
		);
		expect(mattWorkflows).toContain(
			"direct user invocation of `code-review` or explicit full parallel review",
		);
		expect(mattWorkflows).toContain("plain AGREE from `planning-advisor`");
		expect(mattWorkflows).toContain(
			"unless the user explicitly overrides the gate",
		);
		expect(`${routing}\n${briefings}\n${mattWorkflows}`).not.toContain(
			"technical-advisor",
		);
		expect(`${routing}\n${briefings}\n${mattWorkflows}`).not.toContain(
			"Decision Council",
		);
		for (const relativePath of [
			"configs/codex/AGENTS.md",
			"configs/claude/CLAUDE.md",
			"configs/agent-profile/PROFILE.md",
		]) {
			const instructions = fs.readFileSync(
				path.join(import.meta.dir, "..", relativePath),
				"utf8",
			);
			expect(instructions).toContain("Orca orchestration");
			expect(instructions).toContain("Axstack workflows");
			expect(instructions).toContain("gh stack");
			expect(instructions).not.toContain("technical-advisor");
		}
		expect(readme).toContain("Fable's plain AGREE");
		expect(readmeContract).toContain(
			"2 high, 10 medium, 6 low, 2 xhigh, and 1 max",
		);
		expect(readme).toContain("unless the user explicitly overrides the gate");
	});

	it("keeps routine reviews single-seat and changed-candidate review incremental", () => {
		const projectRoot = path.resolve(import.meta.dir, "..");
		const skillRoot = path.join(projectRoot, "configs", "agent-skills");
		const routing = fs.readFileSync(
			path.join(skillRoot, "model-routing", "SKILL.md"),
			"utf8",
		);
		const briefings = fs.readFileSync(
			path.join(skillRoot, "model-routing", "references", "briefings.md"),
			"utf8",
		);
		const babysit = fs.readFileSync(
			path.join(skillRoot, "paseo-pr-babysit", "SKILL.md"),
			"utf8",
		);
		const peerReview = fs.readFileSync(
			path.join(skillRoot, "paseo-pr-review", "SKILL.md"),
			"utf8",
		);

		for (const contents of [routing, briefings, babysit]) {
			expect(contents).toContain("same reviewer");
			expect(contents).toContain("exact delta");
			expect(contents).toContain("affected coverage");
			expect(contents).toContain("refreshed SHA");
		}
		expect(routing).toContain("Standards, Spec and simplicity directly");
		expect(routing).toContain("explicitly invokes `code-review`");
		expect(peerReview).toContain("Ordinary peer PR review uses `review-code`");
		expect(peerReview).toContain("document the distinct coverage upfront");
		expect(peerReview).toContain("explicitly selected this skill");
	});

	it("routes requested visual artifacts without forcing ordinary prose to HTML", () => {
		const projectRoot = path.resolve(import.meta.dir, "..");
		const skillRoot = path.join(projectRoot, "configs", "agent-skills");
		const files = [
			"model-routing/SKILL.md",
			"model-routing/references/matt-workflows.md",
			"model-routing/references/briefings.md",
		];
		const contents = files.map((relativePath) =>
			fs.readFileSync(path.join(skillRoot, relativePath), "utf8"),
		);

		expect(contents[0]).toContain("`research-requirements`");
		expect(contents[1]).toContain("`research-requirements`");
		expect(contents[0]).toContain("visual-explainer");
		expect(contents[0]).toContain("Ordinary prose remains prose");
		expect(contents[2]).toContain("visual-explainer.json");
		expect(contents[2]).toContain("fixed `dark` or `light`");
		expect(contents[2]).toContain("regardless of the OS preference");
		expect(contents[2]).toContain(
			"remove or override any `prefers-color-scheme`",
		);
		expect(contents[2]).toContain(
			"For `system`, retain responsive theme media queries",
		);
		for (const content of contents) {
			expect(content).not.toContain("html-deliverables");
			expect(content).not.toContain("exact approved Markdown");
			expect(content).not.toContain("research-sonnet");
			expect(content).not.toContain("explainer-sonnet");
		}
	});

	it("ships current documentation and PR workflow profile IDs", () => {
		const projectRoot = path.resolve(import.meta.dir, "..");
		const bundledPolicy = JSON.parse(
			fs.readFileSync(
				path.join(projectRoot, "configs", "paseo", "agent-profiles.json"),
				"utf8",
			),
		);
		const routed = bundledPolicy.agentProfiles
			.filter(({ id }) =>
				currentWorkflowProfiles.some((profile) => profile.id === id),
			)
			.map(({ notes: _notes, ...profile }) => profile);

		expect(routed).toEqual(currentWorkflowProfiles);
		expect(
			bundledPolicy.agentProfiles.map(({ id }) => id),
		).not.toContainAnyValues([
			"docs-muse",
			"pr-requirements-muse",
			"pr-monitor-muse",
			"pr-monitor-glm",
		]);

		const skillExpectations = {
			"model-routing/SKILL.md": ["docs", "recurring watchers and watchdogs"],
			"model-routing/references/briefings.md": ["docs"],
			"model-routing/references/matt-workflows.md": ["docs"],
			"paseo-pr-babysit/SKILL.md": ["pr-monitor", "pr-watchdog"],
			"paseo-pr-review/SKILL.md": ["pr-correctness", "pr-requirements"],
		};
		for (const [relativePath, expected] of Object.entries(skillExpectations)) {
			const contents = fs.readFileSync(
				path.join(projectRoot, "configs", "agent-skills", relativePath),
				"utf8",
			);
			for (const value of expected) expect(contents).toContain(value);
			for (const retiredId of [
				"research-grok",
				"pr-correctness-grok",
				"pr-monitor-glm",
				"watchdog-grok",
			]) {
				expect(contents).not.toContain(retiredId);
			}
			expect(contents).not.toContain("Grok");
		}

		const activeReferencePaths = [
			"README.md",
			"configs/codex/AGENTS.md",
			"configs/claude/CLAUDE.md",
			...Object.keys(skillExpectations).map((relativePath) =>
				path.join("configs", "agent-skills", relativePath),
			),
			"configs/agent-skills/model-routing/references/simplicity-review.md",
		];
		for (const relativePath of activeReferencePaths) {
			const contents = fs.readFileSync(
				path.join(projectRoot, relativePath),
				"utf8",
			);
			for (const legacyId of responsibilityProfileReplacements.keys()) {
				expect(contents, `${relativePath}: ${legacyId}`).not.toContain(
					legacyId,
				);
			}
		}
	});

	it("keeps peer-review checkouts under the repository project", () => {
		const skill = fs.readFileSync(
			path.join(
				import.meta.dir,
				"..",
				"configs",
				"agent-skills",
				"paseo-pr-review",
				"SKILL.md",
			),
			"utf8",
		);

		expect(skill).toContain(
			"paseo workspace create --project <project-id> --isolation local",
		);
		expect(skill).toContain("paseo run --workspace <workspace-id>");
		expect(skill).toContain("workspace.projectId == project-id");
	});

	it("keeps recurring heartbeats session-owned and healthy ticks driver-quiet", () => {
		const projectRoot = path.resolve(import.meta.dir, "..");
		const skill = fs.readFileSync(
			path.join(
				projectRoot,
				"configs",
				"agent-skills",
				"paseo-pr-babysit",
				"SKILL.md",
			),
			"utf8",
		);

		for (const contract of [
			"separate Opus monitor and watchdog sessions",
			"Each session creates and owns its own heartbeat",
			'`*/5 * * * *` with `expiresIn: "24h"`',
			'`0 * * * *` with `expiresIn: "48h"`',
			"checks only the monitor snapshot timestamp, session and heartbeat health",
			"Routine healthy ticks update only the watchdog snapshot and do not message or wake the driver",
			"The monitor never renews without that acknowledgement",
		]) {
			expect(skill).toContain(contract);
		}
		expect(skill).not.toContain("driver-owned hourly watchdog");
	});

	it("writes a minimal fresh config without invoking Paseo", async () => {
		const { configPath, home, projectRoot } = fixture();
		const calls = [];

		expect(
			await syncPaseoProfiles({
				home,
				projectRoot,
				runProcessImpl: async (args) => calls.push(args),
			}),
		).toBe(true);
		expect(calls).toEqual([]);
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			version: 1,
			daemon: { agentProfiles: policy.agentProfiles },
			agents: { providers: policy.providers },
		});
	});

	it("refuses a missing config with an ambiguous PID before any CLI call", async () => {
		const { configPath, home, projectRoot } = fixture();
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(path.join(path.dirname(configPath), "paseo.pid"), "{}\n");
		const calls = [];

		expect(
			await syncPaseoProfiles({
				home,
				projectRoot,
				runProcessImpl: async (args) => calls.push(args),
			}),
		).toBe(false);
		expect(calls).toEqual([]);
		expect(fs.existsSync(configPath)).toBe(false);
	});

	it("does not overwrite malformed or concurrently-created config", async () => {
		const malformed = fixture();
		fs.mkdirSync(path.dirname(malformed.configPath), { recursive: true });
		fs.writeFileSync(malformed.configPath, "[]\n");
		expect(await syncPaseoProfiles(malformed)).toBe(false);
		expect(fs.readFileSync(malformed.configPath, "utf8")).toBe("[]\n");

		const raced = fixture();
		const competing = '{"version":1,"owner":"upstream"}\n';
		expect(
			await syncPaseoProfiles({
				...raced,
				safeCopyFileImpl: (_source, destination, options) => {
					fs.writeFileSync(destination, competing);
					options.beforeReplace();
				},
			}),
		).toBe(false);
		expect(fs.readFileSync(raced.configPath, "utf8")).toBe(competing);
	});

	it("reloads only the running daemon for the exact home and listen address", async () => {
		const { configPath, home, projectRoot } = fixture();
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(configPath, '{"version":1,"unknown":"keep"}\n');
		const calls = [];
		const warnings = [];
		const paseoHome = path.dirname(configPath);
		const runner = async (args, options) => {
			calls.push(args);
			expect(options.env.PASEO_HOME).toBeUndefined();
			expect(options.env.PASEO_HOST).toBeUndefined();
			if (args.includes("status")) {
				return {
					exitCode: 0,
					stdout: JSON.stringify({
						home: paseoHome,
						listen: "127.0.0.1:6767",
						localDaemon: "running",
					}),
				};
			}
			return {
				exitCode: 0,
				stdout: JSON.stringify({ restartRequiredPaths: ["daemon.listen"] }),
			};
		};

		expect(
			await syncPaseoProfiles({
				home,
				logger: logger(warnings),
				projectRoot,
				runProcessImpl: runner,
				whichImpl: () => "/usr/bin/paseo",
				environment: { PASEO_HOME: "/wrong", PASEO_HOST: "ssh://wrong" },
			}),
		).toBe(true);
		expect(calls).toEqual([
			["/usr/bin/paseo", "daemon", "status", "--home", paseoHome, "--json"],
			["/usr/bin/paseo", "reload", "--host", "127.0.0.1:6767", "--json"],
		]);
		expect(warnings.join("\n")).toContain("daemon.listen");
	});

	it("skips reload for a stopped or different-home daemon", async () => {
		for (const status of [
			{ localDaemon: "stopped" },
			{
				home: "/another/home/.paseo",
				listen: "127.0.0.1:6767",
				localDaemon: "running",
			},
		]) {
			const { configPath, home, projectRoot } = fixture();
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, "{}\n");
			const calls = [];
			await syncPaseoProfiles({
				home,
				projectRoot,
				runProcessImpl: async (args) => {
					calls.push(args);
					return { exitCode: 0, stdout: JSON.stringify(status) };
				},
				whichImpl: () => "/usr/bin/paseo",
			});
			expect(calls).toHaveLength(1);
		}
	});

	it("backs up a secret-free policy without invoking Paseo", () => {
		const { configPath, home, policyPath, projectRoot } = fixture();
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				daemon: {
					auth: { password: "drop" },
					relay: { token: "drop" },
					agentProfiles: policy.agentProfiles,
				},
				agents: {
					providers: { grok: { ...policy.providers.grok, key: "drop" } },
				},
			}),
		);

		expect(backupPaseoProfiles({ home, projectRoot })).toBe(true);
		const backedUp = fs.readFileSync(policyPath, "utf8");
		expect(backedUp).not.toContain("password");
		expect(backedUp).not.toContain("relay");
		expect(backedUp).not.toContain("token");
		expect(JSON.parse(backedUp)).toEqual({
			version: 1,
			agentProfiles: policy.agentProfiles,
			providers: { grok: policy.providers.grok },
		});
	});
});
