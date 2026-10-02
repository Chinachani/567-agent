import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	DESKTOP_BUILD_OUTPUTS,
	DESKTOP_REQUIRED_SOURCE_FILES,
	VETTA_DESIGN_SHARE_FILE_ASSOCIATION,
	VETTA_PLUGIN_FILE_ASSOCIATION,
	LEGACY_PLUGIN_FILE_ASSOCIATION,
} from "./desktop-packaging-layout.mjs";
import { APP_NAME, BUNDLE_ID, infoPlistContents } from "./build-appshot-helper.js";
import desktopAfterPack from "./desktop-after-pack.mjs";

const desktopRoot = join(import.meta.dirname, "..");

test("production build outputs have stable staging destinations", () => {
	assert.deepEqual(
		DESKTOP_BUILD_OUTPUTS,
		[
			{ source: "dist/main", target: "main" },
			{ source: "dist/preload", target: "preload" },
			{ source: "dist/renderer", target: "renderer" },
			{ source: "dist/ocr-preload", target: "ocr-preload" },
			{ source: "dist/ocr-runner", target: "ocr-runner" },
		],
	);
});

test("required source entry points exist", () => {
	for (const relativePath of DESKTOP_REQUIRED_SOURCE_FILES) {
		assert.ok(existsSync(join(desktopRoot, relativePath)), `missing Desktop source entry: ${relativePath}`);
	}
});

test("packaged Desktop registers the dedicated Vetta plugin package type", () => {
	assert.deepEqual(VETTA_PLUGIN_FILE_ASSOCIATION, {
		ext: "567plugin",
		name: "567 Agent Plugin Package",
		description: "Installable 567 Agent plugin package",
		mimeType: "application/vnd.vetta.plugin+zip",
		role: "Editor",
	});
});

test("packaged Desktop registers the 567design share file type", () => {
	assert.deepEqual(VETTA_DESIGN_SHARE_FILE_ASSOCIATION, {
		ext: "567design",
		name: "567 Agent Design Share Package",
		description: "567 Agent 设计分享包",
		mimeType: "application/vnd.567agent.design+zip",
		role: "Editor",
	});
});

test("new and legacy plugin packages keep dedicated file associations", () => {
	assert.equal(LEGACY_PLUGIN_FILE_ASSOCIATION.ext, "vettapkg");
	assert.equal(LEGACY_PLUGIN_FILE_ASSOCIATION.mimeType, VETTA_PLUGIN_FILE_ASSOCIATION.mimeType);
	const installer = readFileSync(join(desktopRoot, "build", "installer.iss"), "utf8");
	assert.ok(installer.includes('Subkey: "Software\\Classes\\.567plugin"'));
	assert.ok(installer.includes('Subkey: "Software\\Classes\\.vettapkg"'));
	assert.ok(installer.includes('Subkey: "Software\\Classes\\567Agent.PluginPackage\\shell\\open\\command"'));
	assert.ok(installer.includes('Subkey: "Software\\Classes\\agent567\\shell\\open\\command"'));
	assert.ok(installer.includes('Subkey: "Software\\Classes\\vetta\\shell\\open\\command"'));
});

test("macOS helper metadata and runtime resolution use the same brand", () => {
	assert.equal(APP_NAME, "567 Agent Computer Use");
	assert.equal(BUNDLE_ID, "com.api567.agent.computer-use");
	const plist = infoPlistContents();
	assert.ok(plist.includes(`<string>${APP_NAME}</string>`));
	assert.ok(plist.includes(`<string>${BUNDLE_ID}</string>`));
	const resolver = readFileSync(join(desktopRoot, "src/main/appshot/helper-resolver.ts"), "utf8");
	assert.ok(resolver.includes(`APP_BUNDLE_NAME = "${APP_NAME}.app"`));
	assert.ok(resolver.includes(`EXECUTABLE_NAME = "${APP_NAME}"`));
});

test("macOS packaging and update verification share the configured bundle identity", () => {
	const desktopManifest = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
	const packScript = readFileSync(join(desktopRoot, "scripts/prepare-pack.js"), "utf8");
	const verifyScript = readFileSync(join(desktopRoot, "scripts/verify-mac-update.mjs"), "utf8");
	assert.equal(desktopManifest.desktopAppId, "com.api567.agent");
	assert.ok(packScript.includes("desktopAppId"));
	assert.ok(packScript.includes('artifactName: "567-Agent-${version}-${arch}-mac.${ext}"'));
	assert.ok(verifyScript.includes("desktopAppId"));
});

test("Linux afterPack clears the FPM package marker before target packaging", async () => {
	const directory = await mkdtemp(join(tmpdir(), "desktop-after-pack-"));
	try {
		const markerDir = join(directory, "resources");
		await mkdir(markerDir);
		await writeFile(join(markerDir, "package-type"), "rpm");
		await desktopAfterPack({ electronPlatformName: "linux", appOutDir: directory });
		assert.equal(existsSync(join(markerDir, "package-type")), false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("Windows installer registers and opens 567design files", () => {
	const installer = readFileSync(join(desktopRoot, "build", "installer.iss"), "utf8");
	assert.ok(installer.includes('Subkey: "Software\\Classes\\.567design"'));
	assert.match(installer, /567 Agent 设计分享包/);
	assert.ok(installer.includes('Subkey: "Software\\Classes\\567Agent.DesignShare\\shell\\open\\command"'));
	assert.match(installer, /ValueData: """\{app\}\\567-Agent\.exe"" ""%1"""/);
});
