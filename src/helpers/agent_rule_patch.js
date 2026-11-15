import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { PROJECT_ROOT } from "../common/paths.js";

const OLD =
	"- When I correct the same thing twice, write it here as one rule that day.";
const NEW =
	"- When I correct the same thing twice, make it a check, test or code change that day; the rule line here points to that check. Keep prose only for authority or judgement.";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const revision = () =>
	execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: PROJECT_ROOT,
		encoding: "utf8",
	}).trim();

// Latin-1 offsets are byte offsets, including for non-UTF-8 neighbouring bytes.
function patch(bytes, from, to) {
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

function edit(file, expectedHash, from, to, guard) {
	const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile()) throw new Error("Destination is not a regular file");
		const current = fs.readFileSync(fd);
		if (expectedHash && hash(current) !== expectedHash)
			throw new Error("Destination differs from reviewed before-state");
		const next = patch(current, from, to);
		guard();
		const live = fs.lstatSync(file);
		if (
			live.ino !== stat.ino ||
			live.dev !== stat.dev ||
			!fs.readFileSync(file).equals(current)
		)
			throw new Error("Destination changed immediately before write");
		let written = 0;
		while (written < next.length) {
			const count = fs.writeSync(
				fd,
				next,
				written,
				next.length - written,
				written,
			);
			if (!count) throw new Error("Destination write made no progress");
			written += count;
		}
		fs.ftruncateSync(fd, next.length);
		fs.fsyncSync(fd);
		if (!fs.readFileSync(file).equals(next))
			throw new Error("Destination readback mismatch; inspect before retrying");
		return hash(next);
	} finally {
		fs.closeSync(fd);
	}
}

/** Local, explicitly scoped plan/deploy/rollback; never calls full profile sync. */
export function runAgentRulePatch({ mode, evidenceDir, source, destinations }) {
	if (!["plan", "deploy", "rollback"].includes(mode))
		throw new Error("Expected plan, deploy or rollback");
	if (!evidenceDir || !path.isAbsolute(evidenceDir))
		throw new Error("Evidence directory must be an explicit absolute path");
	if (mode === "plan") fs.mkdirSync(evidenceDir, { mode: 0o700 });
	const directory = fs.lstatSync(evidenceDir);
	if (
		!directory.isDirectory() ||
		directory.uid !== process.getuid() ||
		(directory.mode & 0o777) !== 0o700
	)
		throw new Error("Evidence directory must be owned and mode 0700");
	const lock = path.join(evidenceDir, "lock");
	const lockFd = fs.openSync(lock, "wx", 0o600);
	const manifest = path.join(evidenceDir, "receipt.json");
	const save = (receipt) => {
		const staging = path.join(evidenceDir, "receipt.next");
		fs.writeFileSync(staging, `${JSON.stringify(receipt, null, 2)}\n`, {
			mode: 0o600,
		});
		fs.renameSync(staging, manifest);
	};
	try {
		if (mode === "plan") {
			const bytes = fs.readFileSync(source);
			patch(bytes, NEW, OLD); // The reviewed source must carry the new rule.
			fs.writeFileSync(path.join(evidenceDir, "source.before"), bytes, {
				flag: "wx",
				mode: 0o600,
			});
			const receipt = {
				schema: 1,
				host: hostname(),
				source: { path: source, revision: revision(), sha256: hash(bytes) },
				destinations: destinations.map((file, index) => {
					const target = { path: file, before: `${index}.before` };
					try {
						const bytes = fs.readFileSync(file);
						fs.writeFileSync(path.join(evidenceDir, target.before), bytes, {
							flag: "wx",
							mode: 0o600,
						});
						target.sha256 = hash(bytes);
						patch(bytes, OLD, NEW);
						target.status = "planned";
					} catch (error) {
						target.status = "held";
						target.reason = error.message;
					}
					return target;
				}),
			};
			save(receipt);
			return receipt;
		}
		const receipt = JSON.parse(fs.readFileSync(manifest, "utf8"));
		if (
			receipt.schema !== 1 ||
			receipt.host !== hostname() ||
			receipt.source.path !== source ||
			JSON.stringify(receipt.destinations.map((d) => d.path)) !==
				JSON.stringify(destinations)
		)
			throw new Error(
				"Receipt does not match this host, source or destinations",
			);
		for (const target of receipt.destinations) {
			try {
				if (mode === "deploy") {
					if (target.applied) throw new Error("Already applied by this run");
					if (!target.sha256) throw new Error("No reviewed before-state");
					const before = fs.readFileSync(path.join(evidenceDir, target.before));
					if (hash(before) !== target.sha256)
						throw new Error("Before-snapshot differs from plan");
					target.afterSha256 = edit(
						target.path,
						target.sha256,
						OLD,
						NEW,
						() => {
							if (
								revision() !== receipt.source.revision ||
								hash(fs.readFileSync(source)) !== receipt.source.sha256
							)
								throw new Error("Source differs from reviewed before-state");
						},
					);
					target.applied = true;
					target.status = "applied";
				} else {
					if (!target.applied)
						throw new Error("No applied receipt for this run");
					edit(target.path, null, NEW, OLD, () => {});
					target.applied = false;
					target.status = "rolled-back";
				}
				delete target.reason;
			} catch (error) {
				target.status = "held";
				target.reason = error.message;
			}
			save(receipt); // Persist each reached destination before trying its peer.
		}
		return receipt;
	} finally {
		fs.closeSync(lockFd);
		fs.unlinkSync(lock);
	}
}
