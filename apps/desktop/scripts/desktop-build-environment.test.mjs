import assert from "node:assert/strict";
import test from "node:test";
import {
	createOpenSourceBuildEnvironment,
	validateDesktopBuildEnvironment,
} from "./desktop-build-environment.mjs";
import { resolveMacSigningConfig } from "./mac-signing-config.mjs";

const commercialEnv = {
	AGENT567_CLOUD_ENABLED: "true",
	API567_BASE_URL: "https://api.example.com/api/v1",
	AGENT567_UPDATE_PROVIDER: "generic",
	AGENT567_UPDATE_URL: "https://updates.example.com/desktop/stable",
	AGENT567_VENDOR_PLATFORM: "win32-x64",
};

const openSourceEnv = createOpenSourceBuildEnvironment({
	AGENT567_VENDOR_PLATFORM: "linux-x64",
});

test("accepts a commercial Windows build with the default generic updater", () => {
	const config = validateDesktopBuildEnvironment({ env: commercialEnv, platform: "win32", arch: "x64" });
	assert.equal(config.edition, "commercial");
	assert.equal(config.updateConfig.provider, "generic");
	assert.deepEqual(config.platformTags, ["win32-x64"]);
});

test("accepts canonical AGENT567 build settings", () => {
	const config = validateDesktopBuildEnvironment({
		env: {
			AGENT567_CLOUD_ENABLED: "true",
			API567_BASE_URL: "https://api.example.com/api/v1",
			AGENT567_UPDATE_PROVIDER: "generic",
			AGENT567_UPDATE_URL: "https://updates.example.com/desktop/stable",
			AGENT567_VENDOR_PLATFORM: "win32-x64",
		},
		platform: "win32",
		arch: "x64",
	});
	assert.equal(config.edition, "commercial");
	assert.equal(config.updateConfig.provider, "generic");
});

test("does not read NEWAPI_BASE_URL as an API567_BASE_URL alias", () => {
	const { API567_BASE_URL: _ignored, ...oldEnv } = commercialEnv;
	oldEnv.NEWAPI_BASE_URL = "https://legacy.example.com/api/v1";
	assert.throws(
		() => validateDesktopBuildEnvironment({ env: oldEnv, platform: "win32", arch: "x64" }),
		/API567_BASE_URL/,
	);
});

test("creates deterministic open-source defaults while preserving fork coordinates", () => {
	const env = createOpenSourceBuildEnvironment({
		AGENT567_CLOUD_ENABLED: "true",
		API567_BASE_URL: "https://commercial.example.com",
		AGENT567_UPDATE_GITHUB_OWNER: "example",
		AGENT567_UPDATE_GITHUB_REPO: "example-desktop",
		AGENT567_OPEN_MARKETPLACE_REPOSITORY: "example/marketplace",
	});
	assert.equal(env.AGENT567_CLOUD_ENABLED, "false");
	assert.equal(env.API567_BASE_URL, "");
	assert.equal(env.AGENT567_UPDATE_PROVIDER, "github");
	assert.equal(env.AGENT567_UPDATE_GITHUB_OWNER, "example");
	assert.equal(env.AGENT567_OPEN_MARKETPLACE_REPOSITORY, "example/marketplace");
});

test("accepts an open-source Linux build", () => {
	const config = validateDesktopBuildEnvironment({ env: openSourceEnv, platform: "linux", arch: "x64" });
	assert.equal(config.edition, "opensource");
	assert.equal(config.updateConfig.provider, "github");
	assert.deepEqual(config.platformTags, ["linux-x64"]);
});

test("does not supply a hard-coded marketplace in open-source build environments", () => {
	assert.equal(createOpenSourceBuildEnvironment({}).AGENT567_OPEN_MARKETPLACE_REPOSITORY, undefined);
	assert.equal(createOpenSourceBuildEnvironment({ AGENT567_OPEN_MARKETPLACE_REPOSITORY: "" }).AGENT567_OPEN_MARKETPLACE_REPOSITORY, "");
});

test("validates GitHub source overrides independently of the cloud edition", () => {
	for (const env of [commercialEnv, openSourceEnv]) {
		assert.doesNotThrow(() => validateDesktopBuildEnvironment({ env: { ...env, AGENT567_OPEN_MARKETPLACE_REPOSITORY: "example/catalog" } }));
		assert.throws(() => validateDesktopBuildEnvironment({ env: { ...env, AGENT567_OPEN_MARKETPLACE_REPOSITORY: "https://invalid.example/catalog" } }), /AGENT567_OPEN_MARKETPLACE_REPOSITORY/);
		assert.doesNotThrow(() => validateDesktopBuildEnvironment({ env: { ...env, AGENT567_OPEN_MARKETPLACE_REPOSITORY: "" } }));
	}
});

test("rejects an implicit edition and reports all independent problems", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: {
					AGENT567_POSTHOG_REPLAY_ENABLED: "yes",
					AGENT567_SENTRY_TRACES_SAMPLE_RATE: "2",
					AGENT567_VENDOR_PLATFORM: "win32-arm64",
				},
			}),
		(error) => {
			assert.match(error.message, /AGENT567_CLOUD_ENABLED/);
			assert.match(error.message, /AGENT567_POSTHOG_REPLAY_ENABLED/);
			assert.match(error.message, /AGENT567_SENTRY_TRACES_SAMPLE_RATE/);
			assert.match(error.message, /win32-arm64/);
			return true;
		},
	);
});

test("rejects commercial and open-source configuration mixing", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...commercialEnv, AGENT567_UPDATE_PROVIDER: "github", AGENT567_UPDATE_GITHUB_OWNER: "x", AGENT567_UPDATE_GITHUB_REPO: "y" },
			}),
		/commercial builds must use.*generic/,
	);
	assert.throws(
		() => validateDesktopBuildEnvironment({ env: { ...openSourceEnv, API567_BASE_URL: "https://api.example.com" } }),
		/API567_BASE_URL.*must be empty/,
	);
});

test("requires HTTPS service URLs for production builds", () => {
	assert.throws(
		() => validateDesktopBuildEnvironment({ env: { ...commercialEnv, API567_BASE_URL: "http://api.example.com" } }),
		/API567_BASE_URL must use https/,
	);
	assert.doesNotThrow(() =>
		validateDesktopBuildEnvironment({
			env: { ...commercialEnv, API567_BASE_URL: "http://localhost:3000" },
			mode: "test",
		}),
	);
});

test("requires a secure production updater and valid GitHub coordinates", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...commercialEnv, AGENT567_UPDATE_URL: "http://releases.example.com/desktop/stable" },
			}),
		/AGENT567_UPDATE_URL must use https/,
	);
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...openSourceEnv, AGENT567_UPDATE_GITHUB_OWNER: "invalid/owner" },
			}),
		/AGENT567_UPDATE_GITHUB_OWNER/,
	);
});

test("rejects partial macOS signing credentials and supports signed local iteration", () => {
	assert.throws(() => resolveMacSigningConfig({ CSC_NAME: "Developer ID" }), /APPLE_TEAM_ID/);
	assert.deepEqual(
		resolveMacSigningConfig({
			CSC_NAME: "Developer ID",
			APPLE_TEAM_ID: "TEAM123",
			AGENT567_SKIP_NOTARIZE: "1",
		}),
		{ enabled: true, notarize: false, teamId: "TEAM123" },
	);
});

test("requires notarization when macOS signature verification is mandatory", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: {
					...openSourceEnv,
					AGENT567_VENDOR_PLATFORM: "darwin-arm64",
					CSC_NAME: "Developer ID",
					APPLE_TEAM_ID: "TEAM123",
					AGENT567_SKIP_NOTARIZE: "1",
					AGENT567_REQUIRE_MAC_SIGNATURE: "1",
				},
				platform: "darwin",
				arch: "arm64",
			}),
		/requires macOS signing and notarization/,
	);
});

test("rejects incomplete Sentry source-map upload settings without exposing values", () => {
	assert.doesNotThrow(() =>
		validateDesktopBuildEnvironment({
			env: { ...commercialEnv, AGENT567_SENTRY_DSN: "https://public-key@sentry.example.com/1" },
		}),
	);
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...commercialEnv, AGENT567_SENTRY_AUTH_TOKEN: "do-not-print" },
			}),
		(error) => {
			assert.match(error.message, /AGENT567_SENTRY_ORG/);
			assert.doesNotMatch(error.message, /do-not-print/);
			return true;
		},
	);
});
