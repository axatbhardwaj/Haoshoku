import { expect, test } from "bun:test";
import path from "node:path";

import { projectRoot, PROJECT_ROOT } from "../src/common/paths.js";

test("source root is independent of the executable location", () => {
	expect(
		projectRoot({ dir: "/checkout/src/common", execPath: "/usr/bin/bun" }),
	).toBe("/checkout");
	expect(PROJECT_ROOT).toBe(path.resolve(import.meta.dir, ".."));
});

test("compiled modules resolve assets beside the executable", () => {
	expect(
		projectRoot({ dir: "/$bunfs/root", execPath: "/opt/haoshoku/haoshoku" }),
	).toBe("/opt/haoshoku");
});

test("a source checkout named like bunfs still uses its source root", () => {
	expect(
		projectRoot({
			dir: "/$bunfs-checkout/src/common",
			execPath: "/usr/bin/bun",
		}),
	).toBe("/$bunfs-checkout");
});
