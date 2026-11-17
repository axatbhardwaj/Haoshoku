import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Latin-1 offsets are byte offsets, including for non-UTF-8 neighbouring bytes.
export function patchRule(bytes, from, to) {
	let managed = false;
	let offset = 0;
	const matches = [];
	for (const line of bytes.toString("latin1").split("\n")) {
		const plain = line.replace(/\r$/, "");
		if (plain.includes("<!-- axstack:begin")) {
			if (managed) throw new Error("Ambiguous Axstack markers");
			managed = true;
		}
		if (!managed) {
			if (plain === from) matches.push(offset);
			if (plain === to) throw new Error("Replacement rule already present");
		}
		if (plain.includes("<!-- axstack:end -->")) {
			if (!managed) throw new Error("Unpaired Axstack marker");
			managed = false;
		}
		offset += line.length + 1;
	}
	if (managed || matches.length !== 1)
		throw new Error("Expected exactly one matching rule outside Axstack block");
	return Buffer.concat([
		bytes.subarray(0, matches[0]),
		Buffer.from(to),
		bytes.subarray(matches[0] + from.length),
	]);
}

export function editRuleFile(file, expectedHash, from, to, guard) {
	const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
	let staging;
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile()) throw new Error("Destination is not a regular file");
		const current = fs.readFileSync(fd);
		if (expectedHash && hash(current) !== expectedHash)
			throw new Error("Destination differs from reviewed before-state");
		const next = patchRule(current, from, to);
		staging = path.join(
			path.dirname(file),
			`.${path.basename(file)}.haoshoku-${randomUUID()}`,
		);
		const stagedFd = fs.openSync(staging, "wx", 0o600);
		try {
			fs.writeFileSync(stagedFd, next);
			const staged = fs.fstatSync(stagedFd);
			if (staged.uid !== stat.uid || staged.gid !== stat.gid)
				fs.fchownSync(stagedFd, stat.uid, stat.gid);
			fs.fchmodSync(stagedFd, stat.mode & 0o7777);
			fs.fsyncSync(stagedFd);
		} finally {
			fs.closeSync(stagedFd);
		}
		guard();
		const live = fs.lstatSync(file);
		if (
			live.ino !== stat.ino ||
			live.dev !== stat.dev ||
			!fs.readFileSync(file).equals(current)
		)
			throw new Error("Destination changed immediately before write");
		fs.renameSync(staging, file);
		staging = undefined;
		if (!fs.readFileSync(file).equals(next))
			throw new Error("Destination readback mismatch; inspect before retrying");
		return hash(next);
	} finally {
		fs.closeSync(fd);
		if (staging) fs.unlinkSync(staging);
	}
}
