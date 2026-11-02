import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { initializeMainMessages } from "../i18n/messages.js";
import {
	assertNoRetiredSceneConflict,
	readInstalledSkillsManifest,
	writeInstalledSkillsManifest,
} from "./skill-manifest-storage.js";

it("keeps retired scene metadata while a user toggles, rereads and removes an ordinary skill", () => {
	const root = mkdtempSync(join(tmpdir(), "agent567-retired-scenes-"));
	try {
		const path = join(root, "skills-manifest.json");
		const scene = { name: "release", type: "scene", source: "market", version: "1", enabled: true, extra: "keep" };
		writeFileSync(
			path,
			JSON.stringify({
				release: scene,
				review: { name: "review", source: "market", version: "1", installedAt: "2026-01-01" },
				invalid: null,
			}),
		);
		const initial = readInstalledSkillsManifest(path);
		expect(Object.keys(initial)).toEqual(["review"]);
		expect(initial.review.enabled).toBe(true);
		writeInstalledSkillsManifest(path, { review: { ...initial.review, enabled: false } });
		expect(readInstalledSkillsManifest(path).review.enabled).toBe(false);
		expect(JSON.parse(readFileSync(path, "utf8")).release).toEqual(scene);
		writeInstalledSkillsManifest(path, {});
		expect(readInstalledSkillsManifest(path)).toEqual({});
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ release: scene });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("rejects a same-name skill before writing and leaves the retired record byte-for-byte intact", () => {
	const root = mkdtempSync(join(tmpdir(), "agent567-retired-name-"));
	try {
		initializeMainMessages("zh");
		const path = join(root, "skills-manifest.json");
		const original = JSON.stringify({ review: { name: "review", type: "scene", enabled: true, extra: "keep" } });
		writeFileSync(path, original);
		expect(() => assertNoRetiredSceneConflict(path, "review")).toThrow("与保留的旧场景同名");
		expect(() => assertNoRetiredSceneConflict(path, "different-name")).not.toThrow();
		initializeMainMessages("en");
		expect(() =>
			writeInstalledSkillsManifest(path, {
				review: {
					name: "review",
					type: "skill",
					source: "market",
					version: "2",
					installedAt: "now",
					enabled: true,
				},
			}),
		).toThrow("matches a preserved scene");
		expect(readFileSync(path, "utf8")).toBe(original);
	} finally {
		initializeMainMessages("zh");
		rmSync(root, { recursive: true, force: true });
	}
});
