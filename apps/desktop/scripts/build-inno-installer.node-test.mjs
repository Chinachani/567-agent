import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
	writeAppUpdateConfig,
	writeInnoUpdateMetadata,
	writeInnoVerificationManifest,
} from "./build-inno-installer.mjs";
import { resolveUpdatePublishConfig } from "./resolve-update-publish-config.mjs";

test("writes updater config into the version directory installed by Inno", async () => {
	const sourceDir = await mkdtemp(join(tmpdir(), "vetta-inno-test-"));
	const version = "0.5.42";
	const resourcesDir = join(sourceDir, "versions", version, "resources");
	await mkdir(resourcesDir, { recursive: true });

	try {
		const publishConfig = resolveUpdatePublishConfig({
			VETTA_UPDATE_PROVIDER: "generic",
			VETTA_UPDATE_URL: "https://updates.example.com/desktop/test",
		});
		assert.ok(publishConfig);
		await writeAppUpdateConfig(join(sourceDir, "versions", version), publishConfig);

		const config = await readFile(join(resourcesDir, "app-update.yml"), "utf8");
		assert.match(config, /provider: generic/);
		assert.match(config, /url: https:\/\/updates\.example\.com\/desktop\/test/);
		assert.match(config, /useMultipleRangeRequest: true/);
		assert.match(config, /updaterCacheDirName: 567-agent-updater/);
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
	}
});

test("Inno bootstrap and electron-updater share one cache directory", () => {
	const installer = readFileSync(new URL("../build/installer.iss", import.meta.url), "utf8");
	assert.match(installer, /\\567-agent-updater/);
	assert.doesNotMatch(installer, /\\567agent-updater/);
});

test("writes a stable versioned file manifest for pre-publish verification", async () => {
	const sourceDir = await mkdtemp(join(tmpdir(), "vetta-inno-test-"));
	const manifestPath = join(sourceDir, "installer.files.json");
	const versionDir = join(sourceDir, "version");
	await mkdir(join(versionDir, "resources"), { recursive: true });
	await Promise.all([
		writeFile(join(versionDir, "567-Agent.exe"), "exe"),
		writeFile(join(versionDir, "resources", "app.asar"), "asar"),
	]);

	try {
		await writeInnoVerificationManifest(versionDir, manifestPath, "1.2.3");
		assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), {
			version: "1.2.3",
			files: [
				{ path: "567-Agent.exe", size: 3 },
				{ path: "resources/app.asar", size: 4 },
			],
		});
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
	}
});

test("writes parseable latest.yml metadata for the Inno installer", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-inno-test-"));
	const metadata = {
		version: "1.2.3",
		files: [{ url: "567-Agent-1.2.3-win-x64.exe", sha512: "dGVzdA==", size: 1234 }],
		path: "567-Agent-1.2.3-win-x64.exe",
		sha512: "dGVzdA==",
		releaseDate: "2026-10-03T00:00:00.000Z",
		releaseNotes: "Windows update metadata regression test",
	};

	try {
		await writeInnoUpdateMetadata(releaseDir, metadata);
		assert.deepEqual(parse(await readFile(join(releaseDir, "latest.yml"), "utf8")), metadata);
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
});
