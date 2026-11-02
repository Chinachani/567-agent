import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkCandidateMetadata } from "./candidate-metadata.mjs";
import { retarget } from "./release-version.mjs";
import { writeVersionFiles } from "./write-version-files.mjs";

const roots = [];
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "agent567-candidate-"));
	roots.push(root);
	for (const [path, value] of Object.entries({
		"apps/desktop/package.json": '{"name":"@567agent/desktop","version":"1.5.4"}',
		"bun.lock": '{"apps/desktop": {"name": "@567agent/desktop", "version": "1.5.4"}}',
		"apps/mobile/version.properties": "# retained comment\nversionName=1.5.4\nversionCode=10504\n",
		".github/release-notes/v1.5.4.md":
			"# 567 Agent 1.5.4\n<!-- release-status: unreleased -->\n\n## 修复\n\n- 保留原条目\n",
	})) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), value);
	}
	return root;
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("retargets a candidate, preserves notes and Android comments, then validates all persisted metadata", () => {
	const root = fixture();
	expect(checkCandidateMetadata(root)).toBe("1.5.4");
	retarget({ root, version: "1.6.0", latestReleased: "1.5.3" });
	expect(checkCandidateMetadata(root)).toBe("1.6.0");
	expect(readFileSync(join(root, "apps/mobile/version.properties"), "utf8")).toContain("# retained comment");
	expect(readFileSync(join(root, ".github/release-notes/v1.6.0.md"), "utf8")).toContain("保留原条目");
});

it.each(["lock", "mobile"])("invalid %s metadata rejects retargeting before any file changes", (kind) => {
	const root = fixture();
	writeFileSync(join(root, kind === "lock" ? "bun.lock" : "apps/mobile/version.properties"), "invalid");
	const paths = [
		"apps/desktop/package.json",
		"bun.lock",
		"apps/mobile/version.properties",
		".github/release-notes/v1.5.4.md",
	];
	const before = paths.map((p) => readFileSync(join(root, p), "utf8"));
	expect(() => retarget({ root, version: "1.6.0", latestReleased: "1.5.3" })).toThrow();
	expect(paths.map((p) => readFileSync(join(root, p), "utf8"))).toEqual(before);
	expect(readdirSync(join(root, ".github/release-notes"))).toEqual(["v1.5.4.md"]);
});

it("restores completed replacements when a later rename fails", () => {
	const root = fixture();
	const paths = [join(root, "bun.lock"), join(root, "apps/mobile/version.properties")];
	const before = paths.map((path) => readFileSync(path, "utf8"));
	let renames = 0;
	expect(() =>
		writeVersionFiles(
			paths.map((path) => ({ path, text: "new" })),
			(from, to) => {
				if (++renames === 2) throw new Error("simulated disk error");
				renameSync(from, to);
			},
		),
	).toThrow("simulated disk error");
	expect(paths.map((path) => readFileSync(path, "utf8"))).toEqual(before);
	expect(readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(false);
});

it.each([
	["bun.lock", '{"apps/desktop": {"name": "@567agent/desktop", "version": "1.5.3"}}'],
	["apps/mobile/version.properties", "versionName=1.5.4\nversionCode=10503\n"],
	[".github/release-notes/v1.5.4.md", "# 567 Agent 1.5.4\n## 修复\n- TODO\n"],
])("rejects inconsistent candidate metadata in %s", (path, text) => {
	const root = fixture();
	writeFileSync(join(root, path), text);
	expect(() => checkCandidateMetadata(root)).toThrow();
});
