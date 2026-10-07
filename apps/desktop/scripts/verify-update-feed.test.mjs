import assert from "node:assert/strict";
import test from "node:test";
import { resolveUpdateFeedBase, verifyUpdateFeed } from "./verify-update-feed.mjs";

const version = "0.5.46";
const metadata = {
	"latest.yml": `version: ${version}\npath: Vetta-Setup-${version}.exe\nfiles:\n  - url: Vetta-Setup-${version}.exe\n`,
	"latest-mac.yml": `version: ${version}\nfiles:\n  - url: Vetta-${version}.zip\n    sha512: test\n`,
	"latest-linux.yml": `version: ${version}\npath: Vetta-${version}.AppImage\nfiles:\n  - url: Vetta-${version}.AppImage\n`,
};

function createFetch() {
	const calls = [];
	return {
		calls,
		fetchImpl: async (url, init) => {
			calls.push({ url, method: init.method });
			const fileName = new URL(url).pathname.split("/").at(-1);
			if (fileName in metadata) return { ok: true, status: 200, text: async () => metadata[fileName] };
			return { ok: true, status: 200, text: async () => "" };
		},
	};
}

test("resolves provider-specific public feed bases", () => {
	assert.equal(
		resolveUpdateFeedBase({
			env: { AGENT567_UPDATE_PROVIDER: "generic", AGENT567_UPDATE_URL: "https://updates.example.com/desktop/stable" },
			version,
		}),
		"https://updates.example.com/desktop/stable/",
	);
	assert.equal(
		resolveUpdateFeedBase({
		env: { AGENT567_UPDATE_PROVIDER: "github", AGENT567_UPDATE_GITHUB_OWNER: "Chinachani", AGENT567_UPDATE_GITHUB_REPO: "567-agent" },
			version,
		}),
		"https://github.com/Chinachani/567-agent/releases/download/v0.5.46/",
	);
});

test("accepts a Git tag version with the leading v", () => {
	assert.equal(
		resolveUpdateFeedBase({
		env: { AGENT567_UPDATE_PROVIDER: "github", AGENT567_UPDATE_GITHUB_OWNER: "Chinachani", AGENT567_UPDATE_GITHUB_REPO: "567-agent" },
		version: "v0.5.46",
		}),
		"https://github.com/Chinachani/567-agent/releases/download/v0.5.46/",
	);
});

test("verifies only metadata published by the Windows and Linux release matrix", async () => {
	const fake = createFetch();
	const result = await verifyUpdateFeed({
		env: { AGENT567_UPDATE_PROVIDER: "generic", AGENT567_UPDATE_URL: "https://updates.example.com/desktop/stable" },
		version,
		fetchImpl: fake.fetchImpl,
		retryDelayMs: 0,
	});
	assert.deepEqual(result.metadataFiles, ["latest.yml", "latest-linux.yml"]);
	assert.equal(result.artifacts.length, 2);
	assert.equal(fake.calls.filter((call) => call.method === "GET").length, 2);
	assert.equal(fake.calls.filter((call) => call.method === "HEAD").length, 2);
});

test("allows macOS metadata to be opted into when a macOS release is published", async () => {
	const fake = createFetch();
	const result = await verifyUpdateFeed({
		env: { AGENT567_UPDATE_PROVIDER: "generic", AGENT567_UPDATE_URL: "https://updates.example.com/desktop/stable" },
		version,
		metadataFiles: ["latest.yml", "latest-linux.yml", "latest-mac.yml"],
		fetchImpl: fake.fetchImpl,
		retryDelayMs: 0,
	});
	assert.ok(result.metadataFiles.includes("latest-mac.yml"));
});

test("falls back to a ranged GET when a CDN rejects HEAD", async () => {
	const fake = createFetch();
	const fetchImpl = async (url, init) => {
		if (init.method === "HEAD") return { ok: false, status: 405, text: async () => "" };
		return fake.fetchImpl(url, init);
	};
	await verifyUpdateFeed({
		env: { AGENT567_UPDATE_PROVIDER: "generic", AGENT567_UPDATE_URL: "https://updates.example.com/desktop/stable" },
		version,
		metadataFiles: ["latest-linux.yml"],
		fetchImpl,
		retryDelayMs: 0,
	});
	assert.ok(fake.calls.some((call) => call.method === "GET"));
});

test("rejects a feed that serves a different release version", async () => {
	const fake = createFetch();
	assert.rejects(
		verifyUpdateFeed({
			env: { AGENT567_UPDATE_PROVIDER: "generic", AGENT567_UPDATE_URL: "https://updates.example.com/desktop/stable" },
			version: "0.5.47",
			metadataFiles: ["latest.yml"],
			fetchImpl: fake.fetchImpl,
			retryDelayMs: 0,
		}),
		/expected 0\.5\.47/,
	);
});
