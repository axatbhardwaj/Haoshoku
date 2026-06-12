import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { copyDirRecursive, log, runCommand, safeCopyFile } from "../common/utils.js";

/**
 * Recursively compare two directory trees for identical content.
 *
 * Returns true only if both paths exist, have the same set of entries at every
 * level, and every corresponding file has byte-identical content. Symlinks are
 * compared by their link target string, not the content they point to.
 *
 * @param {string} a  First directory path
 * @param {string} b  Second directory path
 * @returns {boolean}
 */
function dirsAreIdentical(a, b) {
	if (!fs.existsSync(a) || !fs.existsSync(b)) return false;

	const entriesA = fs.readdirSync(a).sort();
	const entriesB = fs.readdirSync(b).sort();

	if (entriesA.length !== entriesB.length) return false;
	if (entriesA.some((name, i) => name !== entriesB[i])) return false;

	for (const name of entriesA) {
		const pathA = path.join(a, name);
		const pathB = path.join(b, name);
		const statA = fs.lstatSync(pathA);
		const statB = fs.lstatSync(pathB);

		if (statA.isSymbolicLink() !== statB.isSymbolicLink()) return false;
		if (statA.isDirectory() !== statB.isDirectory()) return false;

		if (statA.isSymbolicLink()) {
			if (fs.readlinkSync(pathA) !== fs.readlinkSync(pathB)) return false;
		} else if (statA.isDirectory()) {
			if (!dirsAreIdentical(pathA, pathB)) return false;
		} else {
			if (!fs.readFileSync(pathA).equals(fs.readFileSync(pathB))) return false;
		}
	}

	return true;
}

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

/**
 * Resolve the KDE bundle dir and build the COMPONENTS list from injected home
 * + projectRoot (defaults to real $HOME and the haoshoku project root).
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
function resolveComponents({ home = HOME_DEFAULT, projectRoot = PROJECT_ROOT_DEFAULT } = {}) {
	const kdeBundleDir = path.join(projectRoot, "configs", "kde");

	return [
		{
			name: "look-and-feel",
			bundle: "look-and-feel/Ocean",
			system: path.join(home, ".local", "share", "plasma", "look-and-feel", "Ocean"),
		},
		{
			name: "kvantum",
			bundle: "kvantum/Ocean",
			system: path.join(home, ".config", "Kvantum", "Ocean"),
		},
		{
			name: "aurorae",
			bundle: "aurorae/Ocean",
			system: path.join(home, ".local", "share", "aurorae", "themes", "Ocean"),
		},
		{
			name: "desktoptheme",
			bundle: "desktoptheme/Ocean",
			system: path.join(home, ".local", "share", "plasma", "desktoptheme", "Ocean"),
		},
		{
			name: "color-schemes",
			bundle: "color-schemes/Ocean.colors",
			system: path.join(home, ".local", "share", "color-schemes", "Ocean.colors"),
		},
	].map((comp) => ({
		...comp,
		bundlePath: path.join(kdeBundleDir, comp.bundle),
	}));
}

/** Backup KDE Ocean theme from system to configs/kde/. */
export async function backupKdeTheme(opts = {}) {
	const { projectRoot = PROJECT_ROOT_DEFAULT } = opts;
	const kdeBundleDir = path.join(projectRoot, "configs", "kde");

	log.info("Backing up KDE Ocean theme...");
	fs.mkdirSync(kdeBundleDir, { recursive: true });

	for (const comp of resolveComponents(opts)) {
		const systemPath = comp.system;
		const bundlePath = comp.bundlePath;

		if (!fs.existsSync(systemPath)) {
			log.warning(`${comp.name}: not found at ${systemPath}, skipping`);
			continue;
		}

		if (fs.statSync(systemPath).isDirectory()) {
			copyDirRecursive(systemPath, bundlePath);
		} else {
			fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
			fs.copyFileSync(systemPath, bundlePath);
		}
		log.info(`Backed up ${comp.name}`);
	}

	log.success("KDE Ocean theme backed up to configs/kde/");
}

/** Deploy KDE Ocean theme from configs/kde/ to system directories. */
export async function syncKdeTheme(opts = {}) {
	log.info("Syncing KDE Ocean theme...");

	for (const comp of resolveComponents(opts)) {
		const bundlePath = comp.bundlePath;
		const systemPath = comp.system;

		if (!fs.existsSync(bundlePath)) {
			log.warning(`${comp.name}: not found in bundle, skipping`);
			continue;
		}

		if (fs.statSync(bundlePath).isDirectory()) {
			// Directory target: if a real dir exists at dest, rename it to dest.bak
			// (rm a stale .bak first so the rename always succeeds).
			// Content-aware guard: if dest already matches the bundle exactly,
			// skip the backup+copy entirely so the original user .bak is preserved
			// across repeated sync runs (second run must not overwrite .bak with
			// the bundle content that was deployed on the first run).
			if (fs.existsSync(systemPath)) {
				if (dirsAreIdentical(systemPath, bundlePath)) {
					log.dim(`${comp.name} dir unchanged — skipping`);
					continue;
				}
				const bakPath = `${systemPath}.bak`;
				if (fs.existsSync(bakPath)) {
					fs.rmSync(bakPath, { recursive: true, force: true });
				}
				fs.renameSync(systemPath, bakPath);
				log.info(`Backed up existing ${comp.name} dir to ${bakPath}`);
			}
			copyDirRecursive(bundlePath, systemPath);
		} else {
			fs.mkdirSync(path.dirname(systemPath), { recursive: true });
			safeCopyFile(bundlePath, systemPath);
		}
		log.info(`Synced ${comp.name}`);
	}

	log.success("KDE Ocean theme synced to system directories");
}

/** Deploy theme and activate (used by OS setup scripts). */
export async function configureKdeTheme(opts = {}) {
	await syncKdeTheme(opts);
	log.info("Activating KDE Ocean theme...");
	await runCommand("plasma-apply-lookandfeel -a Ocean");
	await runCommand("kvantummanager --set Ocean");
	log.success("KDE Ocean theme activated");
}
