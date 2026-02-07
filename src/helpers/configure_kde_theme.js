import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { copyDirRecursive, log, runCommand } from "../common/utils.js";

const HOME = homedir();
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const KDE_BUNDLE_DIR = path.join(PROJECT_ROOT, "configs", "kde");

const COMPONENTS = [
	{
		name: "look-and-feel",
		bundle: "look-and-feel/Ocean",
		system: path.join(HOME, ".local", "share", "plasma", "look-and-feel", "Ocean"),
	},
	{
		name: "kvantum",
		bundle: "kvantum/Ocean",
		system: path.join(HOME, ".config", "Kvantum", "Ocean"),
	},
	{
		name: "aurorae",
		bundle: "aurorae/Ocean",
		system: path.join(HOME, ".local", "share", "aurorae", "themes", "Ocean"),
	},
	{
		name: "desktoptheme",
		bundle: "desktoptheme/Ocean",
		system: path.join(HOME, ".local", "share", "plasma", "desktoptheme", "Ocean"),
	},
	{
		name: "color-schemes",
		bundle: "color-schemes/Ocean.colors",
		system: path.join(HOME, ".local", "share", "color-schemes", "Ocean.colors"),
	},
];

/** Backup KDE Ocean theme from system to configs/kde/. */
export async function backupKdeTheme() {
	log.info("Backing up KDE Ocean theme...");
	fs.mkdirSync(KDE_BUNDLE_DIR, { recursive: true });

	for (const comp of COMPONENTS) {
		const systemPath = comp.system;
		const bundlePath = path.join(KDE_BUNDLE_DIR, comp.bundle);

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
export async function syncKdeTheme() {
	log.info("Syncing KDE Ocean theme...");

	for (const comp of COMPONENTS) {
		const bundlePath = path.join(KDE_BUNDLE_DIR, comp.bundle);
		const systemPath = comp.system;

		if (!fs.existsSync(bundlePath)) {
			log.warning(`${comp.name}: not found in bundle, skipping`);
			continue;
		}

		if (fs.statSync(bundlePath).isDirectory()) {
			copyDirRecursive(bundlePath, systemPath);
		} else {
			fs.mkdirSync(path.dirname(systemPath), { recursive: true });
			fs.copyFileSync(bundlePath, systemPath);
		}
		log.info(`Synced ${comp.name}`);
	}

	log.success("KDE Ocean theme synced to system directories");
}

/** Deploy theme and activate (used by OS setup scripts). */
export async function configureKdeTheme() {
	await syncKdeTheme();
	log.info("Activating KDE Ocean theme...");
	await runCommand("plasma-apply-lookandfeel -a Ocean");
	await runCommand("kvantummanager --set Ocean");
	log.success("KDE Ocean theme activated");
}
