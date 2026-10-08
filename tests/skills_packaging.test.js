import { expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

it("packs retained agent tools without the any selected retired payload or helpers", () => {
	const cache = fs.mkdtempSync(path.join(os.tmpdir(), "skills-pack-cache-"));
	try {
		const packed = Bun.spawnSync(["npm", "pack", "--dry-run", "--json"], {
			cwd: path.resolve(import.meta.dir, ".."),
			env: { ...process.env, npm_config_cache: cache },
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(packed.exitCode, packed.stderr.toString()).toBe(0);
		const output = JSON.parse(packed.stdout.toString());
		const manifest = Array.isArray(output)
			? output[0]
			: Object.values(output)[0];
		const files = manifest.files.map(({ path }) => path);
		expect(
			files.filter(
				(file) =>
					file.startsWith("configs/upstream-skills/") ||
					/^configs\/(?:claude-remote-control|claude-stay-awake|pr-watch)\//.test(
						file,
					) ||
					/src\/helpers\/configure_(?:skills|agent_skills|visual_explainer|claude_remote_control|claude_stay_awake|pr_watch)\.js$/.test(
						file,
					),
			),
		).toEqual([]);
		for (const file of [
			"haoshoku.js",
			"src/helpers/configure_axstack.js",
			"src/helpers/configure_hermes_relay.js",
			"src/helpers/configure_t3_code_server.js",
			"configs/claude/statusline-command.sh",
			"configs/codex/AGENTS.md",
			"configs/agent-profile/PROFILE.md",
		])
			expect(files).toContain(file);
	} finally {
		fs.rmSync(cache, { recursive: true });
	}
}, 30_000);
