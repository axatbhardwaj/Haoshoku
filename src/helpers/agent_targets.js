// Single configurable source (PROFILE.md) deployed to every harness.
// Claude reads CLAUDE.md, Codex/Opencode read AGENTS.md, Antigravity reads
// GEMINI.md as global rules. A target with `append` also gets that bundle
// file appended (harness-specific notes). Shared by full sync and scoped patches.
export const AGENT_TARGETS = [
	{ src: "PROFILE.md", destDir: ".claude", dest: "CLAUDE.md" },
	{ src: "PROFILE.md", destDir: ".codex", dest: "AGENTS.md" },
	{
		src: "PROFILE.md",
		destDir: ".config/opencode",
		dest: "AGENTS.md",
	},
	{
		src: "PROFILE.md",
		destDir: ".gemini",
		dest: "GEMINI.md",
		append: "GEMINI.append.md",
	},
];
