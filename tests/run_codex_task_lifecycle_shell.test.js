import { expect, it } from "bun:test";
import path from "node:path";

it("passes the run-codex-task lifecycle bash suite", async () => {
	const root = path.join(import.meta.dir, "..");
	const proc = Bun.spawn(
		["bash", "tests/shell/run-codex-task-lifecycle.test.sh"],
		{
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	if (exitCode !== 0) {
		console.error(
			`run-codex-task lifecycle bash suite failed\nstdout:\n${stdout}\nstderr:\n${stderr}`,
		);
	}
	expect(exitCode).toBe(0);
}, 60_000);
