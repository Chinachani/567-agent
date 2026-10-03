import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactMatches, baselineArtifactName, compareVersions, metadataFile } from "./desktop-upgrade-e2e.mjs";

test("selects the platform metadata used by electron-updater", () => {
	const expected = process.platform === "win32" ? "latest.yml" : process.platform === "darwin" ? "latest-mac.yml" : "latest-linux.yml";
	assert.equal(metadataFile(), expected);
});

test("compares semantic desktop versions", () => {
	assert.equal(compareVersions("0.5.47", "0.5.46") > 0, true);
	assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
	assert.equal(compareVersions("1.0.0", "1.1.0") < 0, true);
});

test("uses published release artifact names for baseline installation on each platform", () => {
	assert.equal(baselineArtifactName("1.1.9", "win32", "x64"), "567-Agent-1.1.9-win-x64.exe");
	assert.equal(baselineArtifactName("1.1.9", "linux", "x64"), "567-agent-1.1.9.AppImage");
	assert.equal(baselineArtifactName("1.1.9", "darwin", "x64"), "567-Agent-1.1.9-x64-mac.zip");
	assert.equal(baselineArtifactName("1.1.9", "darwin", "arm64"), "567-Agent-1.1.9-arm64-mac.zip");
	for (const [name, platform, architecture] of [
		["567-Agent-1.1.9-win-x64.exe", "win32", "x64"],
		["567-agent-1.1.9.AppImage", "linux", "x64"],
		["567-Agent-1.1.9-x64-mac.zip", "darwin", "x64"],
		["567-Agent-1.1.9-arm64-mac.zip", "darwin", "arm64"],
	]) {
		assert.equal(artifactMatches(name, platform, architecture), true);
	}
});
