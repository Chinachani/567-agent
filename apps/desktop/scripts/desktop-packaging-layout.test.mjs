import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	DESKTOP_BUILD_OUTPUTS,
	DESKTOP_REQUIRED_SOURCE_FILES,
	VETTA_DESIGN_SHARE_FILE_ASSOCIATION,
	VETTA_PLUGIN_FILE_ASSOCIATION,
} from "./desktop-packaging-layout.mjs";

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
		ext: "vettapkg",
		name: "Vetta Plugin Package",
		description: "Installable Vetta plugin package",
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

test("Windows installer registers and opens 567design files", () => {
	const installer = readFileSync(join(desktopRoot, "build", "installer.iss"), "utf8");
	assert.match(installer, /Subkey: "\.567design"/);
	assert.match(installer, /567 Agent 设计分享包/);
	assert.match(installer, /Subkey: "567Agent\.DesignShare\\shell\\open\\command"/);
	assert.match(installer, /ValueData: """\{app\}\\567-Agent\.exe"" ""%1"""/);
});
