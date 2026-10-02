import assert from "node:assert/strict";
import test from "node:test";
import { resolveUpdatePublishConfig } from "./resolve-update-publish-config.mjs";

test("defaults packaged builds to the 567 Agent GitHub Releases feed", () => {
	assert.deepEqual(resolveUpdatePublishConfig({}), {
		provider: "github",
		owner: "Chinachani",
		repo: "567-agent",
		releaseType: "release",
	});
});

test("allows an explicit update URL to override the stable default", () => {
	assert.deepEqual(
		resolveUpdatePublishConfig({
			VETTA_UPDATE_PROVIDER: "generic",
			VETTA_UPDATE_URL: "https://releases.example.com/desktop/test/",
		}),
		{
			provider: "generic",
			url: "https://releases.example.com/desktop/test",
			useMultipleRangeRequest: true,
		},
	);
});

test("rejects a package without an update provider", () => {
	assert.throws(
		() => resolveUpdatePublishConfig({ VETTA_UPDATE_PROVIDER: "none" }),
		/expected generic or github/,
	);
});

test("allows repository coordinates to override the default GitHub feed", () => {
	assert.deepEqual(resolveUpdatePublishConfig({
		VETTA_UPDATE_PROVIDER: "github",
		VETTA_UPDATE_GITHUB_OWNER: "example",
		VETTA_UPDATE_GITHUB_REPO: "desktop",
	}), {
		provider: "github",
		owner: "example",
		repo: "desktop",
		releaseType: "release",
	});
});
