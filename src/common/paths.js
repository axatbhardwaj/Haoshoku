import path from "node:path";

export function projectRoot({
	dir = import.meta.dir,
	execPath = process.execPath,
} = {}) {
	return dir.startsWith("/$bunfs/")
		? path.dirname(execPath)
		: path.resolve(dir, "..", "..");
}

export const PROJECT_ROOT = projectRoot();
