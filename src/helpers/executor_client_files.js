import fs from "node:fs";
import path from "node:path";
import { ExecutorClientError } from "./executor_client_config.js";

function optionalStat(fsImpl, file) {
	try {
		return fsImpl.lstatSync(file);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

export function inspectClientFile(file, fsImpl = fs) {
	for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
		const stat = optionalStat(fsImpl, dir);
		if (
			stat &&
			(!stat.isDirectory() ||
				stat.isSymbolicLink() ||
				![0, process.getuid()].includes(stat.uid) ||
				(stat.mode & 0o022 && !(stat.uid === 0 && stat.mode & 0o1000)))
		)
			throw new ExecutorClientError(
				"unsafe config path; use owned, non-symlink config homes and retry. Both configs left intact.",
			);
		if (dir === path.dirname(dir)) break;
	}
	const stat = optionalStat(fsImpl, file);
	if (
		stat &&
		(!stat.isFile() ||
			stat.isSymbolicLink() ||
			stat.uid !== process.getuid() ||
			stat.nlink !== 1 ||
			stat.mode & 0o022)
	)
		throw new ExecutorClientError(
			"unsafe config path; use owned regular config files without links or shared write permissions. Both configs left intact.",
		);
	const original = stat ? fsImpl.readFileSync(file) : null;
	if (original && !Buffer.from(original.toString("utf8")).equals(original))
		throw new ExecutorClientError(
			"config is malformed or unsupported; use valid UTF-8 and retry. Both configs left intact.",
		);
	return { file, stat, original };
}

function sameInput(a, b) {
	return (
		a.stat?.ino === b.stat?.ino &&
		a.stat?.dev === b.stat?.dev &&
		a.stat?.mode === b.stat?.mode &&
		a.stat?.mtimeMs === b.stat?.mtimeMs &&
		(a.original === null
			? b.original === null
			: b.original !== null && a.original.equals(b.original))
	);
}

function replaceContents(fd, bytes, fsImpl) {
	let offset = 0;
	while (offset < bytes.length) {
		const count = fsImpl.writeSync(
			fd,
			bytes,
			offset,
			bytes.length - offset,
			offset,
		);
		if (!count) throw new Error("Short config write");
		offset += count;
	}
	fsImpl.ftruncateSync(fd, bytes.length);
	fsImpl.fsyncSync(fd);
}

export function writeClientPlans(plans, fsImpl = fs) {
	// Open both files before updating either. Existing secret-bearing bytes live
	// only in memory and their original file: no temp files or backup copies.
	const opened = [];
	try {
		for (const plan of plans) {
			if (!sameInput(plan, inspectClientFile(plan.file, fsImpl)))
				throw new ExecutorClientError(
					"Config changed during setup; retry after other writers finish.",
				);
		}
		for (const plan of plans.filter(
			(p) => p.content !== p.original?.toString("utf8"),
		)) {
			fsImpl.mkdirSync(path.dirname(plan.file), {
				recursive: true,
				mode: 0o700,
			});
			const flags =
				(plan.stat
					? fs.constants.O_RDWR
					: fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL) |
				fs.constants.O_NOFOLLOW;
			const fd = fsImpl.openSync(plan.file, flags, 0o600);
			const item = { plan, fd, touched: false };
			opened.push(item);
			const current = fsImpl.fstatSync(fd);
			item.stat = current;
			if (
				plan.stat &&
				(current.ino !== plan.stat.ino ||
					current.dev !== plan.stat.dev ||
					!fsImpl.readFileSync(fd).equals(plan.original))
			)
				throw new ExecutorClientError(
					"Config changed during setup; retry after other writers finish.",
				);
		}
		// Opening the second file can race with an independent writer of the first.
		// Recheck every input together before the first content mutation.
		for (const plan of plans) {
			const item = opened.find((entry) => entry.plan === plan);
			const expected = item
				? {
						...plan,
						stat: item.stat,
						original: plan.original ?? Buffer.alloc(0),
					}
				: plan;
			if (!sameInput(expected, inspectClientFile(plan.file, fsImpl)))
				throw new Error("Config changed during setup");
		}
		for (const item of opened) {
			item.touched = true;
			replaceContents(item.fd, Buffer.from(item.plan.content), fsImpl);
		}
	} catch {
		let recovered = true;
		for (const { plan, fd, touched } of opened.reverse()) {
			try {
				if (!plan.stat) {
					if (fsImpl.lstatSync(plan.file).ino !== fsImpl.fstatSync(fd).ino)
						throw new Error();
					fsImpl.unlinkSync(plan.file);
				} else if (touched) {
					replaceContents(fd, plan.original, fsImpl);
				}
			} catch {
				recovered = false;
			}
		}
		throw new ExecutorClientError(
			recovered
				? "Client setup incomplete; original config contents restored/preserved. Check permissions and concurrent writers, then retry."
				: "Client setup incomplete; recovery could not be confirmed. Inspect both effective user configs manually before retrying; no authenticated discovery verified.",
		);
	} finally {
		for (const { fd } of opened) fsImpl.closeSync(fd);
	}
}
