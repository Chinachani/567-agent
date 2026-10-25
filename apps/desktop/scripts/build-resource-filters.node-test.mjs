import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { resolveBuildResourceFilters } from "./build-resource-filters.mjs";

const common = ["pet/**/*", "tray-light.png", "tray-dark.png"];

test("Windows packages include both the app icon and native drag icon", () => {
	assert.deepEqual(resolveBuildResourceFilters(new Set(["win32"])), [...common, "icon.ico", "icon.png"]);
});

test("platform-specific icon filters remain isolated", () => {
	assert.deepEqual(resolveBuildResourceFilters(new Set(["linux"])), [...common, "icon.png"]);
	assert.deepEqual(resolveBuildResourceFilters(new Set(["darwin"])), [
		...common,
		"trayTemplate.png",
		"trayTemplate@2x.png",
		"icon.icns",
		"icon.png",
		"icon-dock.png",
	]);
});

test("every platform's concrete icon resources exist in the build input", () => {
	for (const family of ["win32", "linux", "darwin"]) {
		for (const file of resolveBuildResourceFilters(new Set([family]))) {
			if (file.includes("*")) continue;
			assert.ok(existsSync(new URL(`../build/${file}`, import.meta.url)), `${family}: ${file} is missing`);
		}
	}
});
