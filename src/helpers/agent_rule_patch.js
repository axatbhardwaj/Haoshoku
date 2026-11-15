import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { PROJECT_ROOT } from "../common/paths.js";
import { editRuleFile as edit, patchRule as patch } from "./agent_rule_file.js";

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
	let lockFd;
	try {
		lockFd = fs.openSync(lock, "wx", 0o600);
	} catch (error) {
		if (error.code === "EEXIST")
			throw new Error(
				`Stale or active lock: ${lock}. Inspect its owner; remove it only after confirming no run is active.`,
			);
		throw error;
	}
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
						if (fs.lstatSync(file).isSymbolicLink())
							throw new Error(`Symlink destination refused: ${file}`);
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
