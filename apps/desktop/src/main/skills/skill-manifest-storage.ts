import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mainT } from "../i18n/messages.js";
import type { InstalledSkill } from "./installed-skill.js";

function readDocument(path: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function isRetiredScene(value: unknown): boolean {
	return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "scene");
}

export function assertNoRetiredSceneConflict(path: string, name: string): void {
	if (isRetiredScene(readDocument(path)[name])) {
		throw new Error(mainT("skills.retiredNameConflict", { name }));
	}
}

export function readInstalledSkillsManifest(path: string): Record<string, InstalledSkill> {
	const active: Record<string, InstalledSkill> = {};
	for (const [name, value] of Object.entries(readDocument(path))) {
		if (!value || typeof value !== "object" || Array.isArray(value) || isRetiredScene(value)) continue;
		const entry = value as InstalledSkill;
		active[name] = { ...entry, enabled: entry.enabled ?? true };
	}
	return active;
}

export function writeInstalledSkillsManifest(path: string, manifest: Record<string, InstalledSkill>): void {
	// Retired records stay on disk, outside the active resource projection.
	const retired = Object.fromEntries(Object.entries(readDocument(path)).filter(([, value]) => isRetiredScene(value)));
	for (const name of Object.keys(retired)) {
		if (Object.hasOwn(manifest, name)) throw new Error(mainT("skills.retiredNameConflict", { name }));
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ ...retired, ...manifest }, null, 2), "utf8");
}
