import { describe, expect, it } from "vitest";
import {
	buildBrowserCompareUrl,
	buildCommitApiUrl,
	buildCompareApiUrl,
	checkUpstreams,
	classifyChangedFiles,
	resolveResult,
} from "./check-upstreams.mjs";

const source = {
	id: "zcode",
	repository: "zai-org/ZCode",
	ref: "main",
	pinned: "a".repeat(40),
	highValuePaths: ["packages/runtime-core/"],
};

function jsonResponse(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("check-upstreams", () => {
	it("builds verified API URLs and a browser comparison URL", () => {
		expect(buildCommitApiUrl("zai-org/ZCode", "main")).toBe(
			"https://api.github.com/repos/zai-org/ZCode/commits/main",
		);
		expect(buildCompareApiUrl("zai-org/ZCode", "a".repeat(40), "b".repeat(40))).toBe(
			`https://api.github.com/repos/zai-org/ZCode/compare/${"a".repeat(40)}...${"b".repeat(40)}`,
		);
		expect(buildBrowserCompareUrl("zai-org/ZCode", "a".repeat(40), "b".repeat(40))).toBe(
			`https://github.com/zai-org/ZCode/compare/${"a".repeat(40)}...${"b".repeat(40)}`,
		);
	});

	const manifest = { sources: [source] };

	it("counts one diff entry once while keeping rename source and target", () => {
		expect(
			classifyChangedFiles(
				[
					{ filename: "packages/design-runtime/src/sourceEdit.ts" },
					{ filename: "README.md" },
					{
						filename: "apps/desktop/src/new/name.ts",
						previous_filename: "packages/runtime-core/src/old-name.ts",
					},
				],
				["packages/design-runtime/src/", "packages/runtime-core/"],
			),
		).toEqual({
			changedFiles: [
				"packages/design-runtime/src/sourceEdit.ts",
				"README.md",
				"apps/desktop/src/new/name.ts",
				"packages/runtime-core/src/old-name.ts",
			],
			highValueFiles: ["packages/design-runtime/src/sourceEdit.ts", "apps/desktop/src/new/name.ts"],
			changedEntryCount: 3,
		});
	});

	it("reports an exact verified commit for an identical source", () => {
		const result = resolveResult({
			comparison: { status: "identical", files: [] },
			headSha: "a".repeat(40),
			source,
			classified: { changedFiles: [], highValueFiles: [], changedEntryCount: 0 },
		});
		expect(result.status).toBe("up-to-date");
		expect(result.latest).toBe("a".repeat(40));
		expect(result.compareUrl).toBe(`https://github.com/zai-org/ZCode/compare/${"a".repeat(40)}...${"a".repeat(40)}`);
		expect(result.truncated).toBe(false);
	});

	it("reports the verified head commit for an update", () => {
		const result = resolveResult({
			comparison: { status: "ahead", files: [{ filename: "README.md" }] },
			headSha: "b".repeat(40),
			source,
			classified: { changedFiles: ["README.md"], highValueFiles: [], changedEntryCount: 1 },
		});
		expect(result.status).toBe("update");
		expect(result.latest).toBe("b".repeat(40));
		expect(result.changedCount).toBe(1);
		expect(result.changedEntryCount).toBe(1);
		expect(result.truncated).toBe(false);
	});

	it("marks the GitHub compare file cutoff as partial", () => {
		const files = Array.from({ length: 300 }, (_, index) => ({ filename: `file-${index}.ts` }));
		const result = resolveResult({
			comparison: { status: "ahead", files },
			headSha: "b".repeat(40),
			source,
			classified: {
				changedFiles: files.map((file) => file.filename),
				highValueFiles: [],
				changedEntryCount: files.length,
			},
		});
		expect(result.status).toBe("partial-update");
		expect(result.truncated).toBe(true);
		expect(result.changedEntryCount).toBe(300);
	});

	it("marks missing files as partial and does not assume rename count", () => {
		const result = resolveResult({
			comparison: { status: "ahead" },
			headSha: "b".repeat(40),
			source,
			classified: { changedFiles: [], highValueFiles: [], changedEntryCount: 0 },
		});
		expect(result.status).toBe("partial-update");
		expect(result.truncated).toBe(true);
	});

	it("marks behind and diverged comparisons as partial", () => {
		for (const status of ["behind", "diverged"]) {
			const result = resolveResult({
				comparison: { status, files: [{ filename: "README.md" }] },
				headSha: "b".repeat(40),
				source,
				classified: { changedFiles: ["README.md"], highValueFiles: [], changedEntryCount: 1 },
			});
			expect(result.status).toBe("partial-update");
			expect(result.nonForward).toBe(true);
			expect(result.latest).toBe("b".repeat(40));
			expect(result.compareStatus).toBe(status);
		}
	});

	it("retains the exact head and browser compare link when compare fails", async () => {
		const fetchImpl = async (url) => {
			if (url === buildCommitApiUrl(source.repository, source.ref)) return jsonResponse({ sha: "b".repeat(40) });
			throw new Error("GitHub compare returned HTTP 500");
		};
		const results = await checkUpstreams({ fetchImpl, manifest, timeoutMs: 100 });
		expect(results[0]).toMatchObject({
			status: "partial-update",
			latest: "b".repeat(40),
			error: "GitHub compare returned HTTP 500",
			compareApiUrl: buildCompareApiUrl(source.repository, source.pinned, "b".repeat(40)),
			compareUrl: buildBrowserCompareUrl(source.repository, source.pinned, "b".repeat(40)),
			changedCount: null,
		});
	});

	it("rejects short or non-hex commit SHAs", async () => {
		const fetchImpl = async () => jsonResponse({ sha: "def456" });
		const results = await checkUpstreams({ fetchImpl, manifest, timeoutMs: 100 });
		expect(results[0]).toMatchObject({
			status: "unavailable",
			latest: null,
			error: "GitHub commits request did not return a full 40-character SHA",
		});
	});

	it("rejects a short manifest pin", async () => {
		const shortPinManifest = { sources: [{ ...source, pinned: "a".repeat(39) }] };
		const fetchImpl = async () => jsonResponse({ sha: "b".repeat(40) });
		const results = await checkUpstreams({ fetchImpl, manifest: shortPinManifest, timeoutMs: 100 });
		expect(results[0]).toMatchObject({
			status: "unavailable",
			latest: null,
			error: "Manifest pin must be a full 40-character SHA",
		});
	});

	it("verifies head before compare, pins compare to that head, and skips compare when identical", async () => {
		const calls = [];
		const fetchImpl = async (url) => {
			calls.push(url);
			if (url === buildCommitApiUrl(source.repository, source.ref)) return jsonResponse({ sha: "b".repeat(40) });
			if (url === buildCompareApiUrl(source.repository, source.pinned, "b".repeat(40))) {
				return jsonResponse({ status: "ahead", files: [{ filename: "packages/runtime-core/new.ts" }] });
			}
			throw new Error(`unexpected URL ${url}`);
		};
		const results = await checkUpstreams({ fetchImpl, manifest, timeoutMs: 100 });
		expect(calls).toEqual([
			buildCommitApiUrl(source.repository, source.ref),
			buildCompareApiUrl(source.repository, source.pinned, "b".repeat(40)),
		]);
		expect(results).toHaveLength(1);
		expect(results[0].status).toBe("high-value-update");
		expect(results[0].latest).toBe("b".repeat(40));
	});

	it("skips compare when the verified head matches the pin", async () => {
		const calls = [];
		const fetchImpl = async (url) => {
			calls.push(url);
			return jsonResponse({ sha: "a".repeat(40) });
		};
		const results = await checkUpstreams({ fetchImpl, manifest, timeoutMs: 100 });
		expect(calls).toEqual([buildCommitApiUrl(source.repository, source.ref)]);
		expect(results[0]).toMatchObject({ status: "up-to-date", latest: "a".repeat(40), truncated: false });
	});

	it("reports unavailable results safely for commit and compare failures", async () => {
		const fetchImpl = async () => jsonResponse({ message: "Not Found" }, 404);
		const results = await checkUpstreams({ fetchImpl, manifest, timeoutMs: 100 });
		expect(results[0]).toMatchObject({
			status: "unavailable",
			latest: null,
			error: "GitHub commits request returned HTTP 404",
		});
		expect(() => `${results[0].compareUrl}`).not.toThrow();
	});
});
