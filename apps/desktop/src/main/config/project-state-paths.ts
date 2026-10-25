import { lstatSync } from "node:fs";
import { join } from "node:path";

export const PROJECT_STATE_DIRECTORY = ".567agent";
export const LEGACY_PROJECT_STATE_DIRECTORY = ".vetta";

/** New writes use the canonical path. Legacy files stay in place for history compatibility. */
export function projectStatePath(root: string, ...parts: string[]): string {
	return join(root, PROJECT_STATE_DIRECTORY, ...parts);
}

/** A present canonical file is authoritative, including an unreadable or invalid one. */
export function existingProjectStatePath(root: string, ...parts: string[]): string {
	const canonical = projectStatePath(root, ...parts);
	try {
		lstatSync(canonical);
		return canonical;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return join(root, LEGACY_PROJECT_STATE_DIRECTORY, ...parts);
	}
}
