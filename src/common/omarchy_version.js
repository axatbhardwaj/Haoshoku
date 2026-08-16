import { log, runCommandCapture } from "./utils.js";

export const OMARCHY_V4_REFUSAL =
	"Omarchy 4 or newer must be installed and its version must be detectable.";

export function omarchyMajor(result) {
	if (result?.exitCode !== 0) return null;
	const stdout =
		typeof result?.stdout === "string"
			? result.stdout
			: result?.stdout?.toString?.() ?? "";
	const match = stdout.match(/\bv?(\d+)(?:\.\d+){1,2}\b/);
	return match ? Number(match[1]) : null;
}

export async function checkOmarchyV4({
	captureCommandImpl = runCommandCapture,
	env = process.env,
	logImpl = log,
	versionResult,
} = {}) {
	let result = versionResult;
	if (result === undefined) {
		try {
			result = await captureCommandImpl("omarchy version", {
				env: { ...env, OMARCHY_PATH: "/usr/share/omarchy" },
			});
		} catch {
			result = null;
		}
	}
	const major = omarchyMajor(result);
	if (major !== null && major >= 4) return { ok: true, major };

	logImpl.warning(OMARCHY_V4_REFUSAL);
	return { ok: false, status: "refused", message: OMARCHY_V4_REFUSAL };
}
