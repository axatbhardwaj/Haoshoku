import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as kdeTheme from "../src/helpers/configure_kde_theme.js";

let tmpHome;
let tmpProjectRoot;

function kdeBundle(tmpProjectRoot) {
	return path.join(tmpProjectRoot, "configs", "kde");
}

function seedFileComponent(tmpProjectRoot) {
	// Seed the color-schemes/Ocean.colors file component into the bundle.
	const bundlePath = path.join(
		kdeBundle(tmpProjectRoot),
		"color-schemes",
		"Ocean.colors",
	);
	fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
	fs.writeFileSync(bundlePath, "[Colors:Button]\nBackgroundNormal=44,62,80\n");
	return bundlePath;
}

function seedDirComponent(tmpProjectRoot) {
	// Seed the look-and-feel/Ocean directory component into the bundle.
	const bundleDir = path.join(
		kdeBundle(tmpProjectRoot),
		"look-and-feel",
		"Ocean",
	);
	fs.mkdirSync(bundleDir, { recursive: true });
	fs.writeFileSync(
		path.join(bundleDir, "metadata.json"),
		'{"name":"Ocean","version":"1.0"}\n',
	);
	return bundleDir;
}

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-kde-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-kde-root-"),
	);
	fs.mkdirSync(path.join(tmpProjectRoot, "configs", "kde"), { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe("configure_kde_theme module shape", () => {
	it("exports backupKdeTheme, syncKdeTheme, configureKdeTheme", () => {
		expect(typeof kdeTheme.backupKdeTheme).toBe("function");
		expect(typeof kdeTheme.syncKdeTheme).toBe("function");
		expect(typeof kdeTheme.configureKdeTheme).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// syncKdeTheme — FILE target → safeCopyFile (.bak behavior)
// ---------------------------------------------------------------------------

describe("syncKdeTheme — file target uses safeCopyFile (.bak behavior)", () => {
	it("deploys a file component to the system path", async () => {
		seedFileComponent(tmpProjectRoot);

		await kdeTheme.syncKdeTheme({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"color-schemes",
			"Ocean.colors",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toContain("BackgroundNormal");
	});

	it("creates a .bak of a pre-existing file on first sync", async () => {
		seedFileComponent(tmpProjectRoot);

		// Pre-seed a different live file at the destination
		const destDir = path.join(tmpHome, ".local", "share", "color-schemes");
		fs.mkdirSync(destDir, { recursive: true });
		const destFile = path.join(destDir, "Ocean.colors");
		const ORIGINAL = "[Colors:Button]\nBackgroundNormal=0,0,0\n";
		fs.writeFileSync(destFile, ORIGINAL);

		await kdeTheme.syncKdeTheme({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const bakPath = `${destFile}.bak`;
		expect(fs.existsSync(bakPath)).toBe(true);
		expect(fs.readFileSync(bakPath, "utf8")).toBe(ORIGINAL);
	});

	it("preserves original .bak across two syncs (second run is no-op when content unchanged)", async () => {
		seedFileComponent(tmpProjectRoot);

		const destDir = path.join(tmpHome, ".local", "share", "color-schemes");
		fs.mkdirSync(destDir, { recursive: true });
		const destFile = path.join(destDir, "Ocean.colors");
		const ORIGINAL = "[Colors:Button]\nBackgroundNormal=0,0,0\n";
		fs.writeFileSync(destFile, ORIGINAL);

		// First sync: backs up ORIGINAL → .bak, writes new content
		await kdeTheme.syncKdeTheme({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		// Second sync: live matches bundle → no-op; .bak still holds the original
		await kdeTheme.syncKdeTheme({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const bakPath = `${destFile}.bak`;
		expect(fs.existsSync(bakPath)).toBe(true);
		// .bak must NOT have been overwritten with the (now-current) content
		expect(fs.readFileSync(bakPath, "utf8")).toBe(ORIGINAL);
	});
});

// ---------------------------------------------------------------------------
// syncKdeTheme — DIRECTORY target → rename-to-.bak before copyDirRecursive
// ---------------------------------------------------------------------------

describe("syncKdeTheme — directory target renames existing dir to .bak", () => {
	it("deploys a directory component to the system path", async () => {
		seedDirComponent(tmpProjectRoot);

		await kdeTheme.syncKdeTheme({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"plasma",
			"look-and-feel",
			"Ocean",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(
			fs.existsSync(path.join(dest, "metadata.json")),
		).toBe(true);
	});

	it("renames an existing dest dir to dest.bak before deploying", async () => {
		seedDirComponent(tmpProjectRoot);

		// Pre-seed an existing live directory at the destination
		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"plasma",
			"look-and-feel",
			"Ocean",
		);
		fs.mkdirSync(dest, { recursive: true });
		fs.writeFileSync(
			path.join(dest, "old-file.txt"),
			"old content",
		);

		await kdeTheme.syncKdeTheme({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const bakPath = `${dest}.bak`;
		expect(fs.existsSync(bakPath)).toBe(true);
		expect(
			fs.existsSync(path.join(bakPath, "old-file.txt")),
		).toBe(true);
		// New content deployed to dest
		expect(
			fs.existsSync(path.join(dest, "metadata.json")),
		).toBe(true);
	});

	it("removes a stale .bak before renaming dest to .bak (fresh backup each sync)", async () => {
		seedDirComponent(tmpProjectRoot);

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"plasma",
			"look-and-feel",
			"Ocean",
		);
		// Seed the dest and a stale .bak
		fs.mkdirSync(dest, { recursive: true });
		fs.writeFileSync(path.join(dest, "current.txt"), "current");
		const bakPath = `${dest}.bak`;
		fs.mkdirSync(bakPath, { recursive: true });
		fs.writeFileSync(path.join(bakPath, "stale.txt"), "stale");

		await kdeTheme.syncKdeTheme({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		// Stale .bak is gone; new .bak holds what was in dest
		expect(
			fs.existsSync(path.join(bakPath, "stale.txt")),
		).toBe(false);
		expect(
			fs.existsSync(path.join(bakPath, "current.txt")),
		).toBe(true);
	});

	it("preserves original .bak across two syncs when dir content is already in sync", async () => {
		seedDirComponent(tmpProjectRoot);

		const dest = path.join(
			tmpHome,
			".local",
			"share",
			"plasma",
			"look-and-feel",
			"Ocean",
		);

		// Pre-seed an existing live directory with different content (the "original")
		fs.mkdirSync(dest, { recursive: true });
		fs.writeFileSync(path.join(dest, "original-file.txt"), "original user content");

		// First sync: dest differs from bundle → dest renamed to .bak, bundle deployed
		await kdeTheme.syncKdeTheme({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const bakPath = `${dest}.bak`;
		// After run 1: .bak holds the original user dir
		expect(fs.existsSync(bakPath)).toBe(true);
		expect(fs.existsSync(path.join(bakPath, "original-file.txt"))).toBe(true);
		// dest now holds bundle content
		expect(fs.existsSync(path.join(dest, "metadata.json"))).toBe(true);

		// Second sync: dest already holds bundle content → must be a no-op;
		// .bak must still hold the original user dir, NOT the bundle content.
		await kdeTheme.syncKdeTheme({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(fs.existsSync(bakPath)).toBe(true);
		// .bak must NOT have been overwritten with the (now-current) bundle content
		expect(fs.existsSync(path.join(bakPath, "original-file.txt"))).toBe(true);
		// The file that would appear if .bak was overwritten with bundle content:
		expect(fs.existsSync(path.join(bakPath, "metadata.json"))).toBe(false);
	});
});
