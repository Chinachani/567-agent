import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type LegacyWorkspacePaths, migrateLegacyWorkspace } from "./legacy-workspace-migration.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("migrateLegacyWorkspace", () => {
	it("moves the old default and rewrites registered project paths", () => {
		const paths = createPaths();
		mkdirSync(paths.legacyWorkspace, { recursive: true });
		writeFileSync(join(paths.legacyWorkspace, "design.txt"), "keep");
		const config = {
			workspacePath: "~/.vetta/workspace",
			projects: [{ path: join(paths.legacyWorkspace, "design") }],
			archivedProjects: [join(paths.legacyWorkspace, "old")],
		};

		const migrated = migrateLegacyWorkspace(config, paths);

		expect(migrated.workspacePath).toBe(paths.canonicalWorkspace);
		expect(migrated.projects).toEqual([{ path: join(paths.canonicalWorkspace, "design") }]);
		expect(migrated.archivedProjects).toEqual([join(paths.canonicalWorkspace, "old")]);
		expect(existsSync(join(paths.canonicalWorkspace, "design.txt"))).toBe(true);
		expect(existsSync(paths.legacyWorkspace)).toBe(false);
	});

	it("keeps the legacy path if the canonical destination already contains user files", () => {
		const paths = createPaths();
		mkdirSync(paths.legacyWorkspace, { recursive: true });
		mkdirSync(paths.canonicalWorkspace, { recursive: true });
		writeFileSync(join(paths.legacyWorkspace, "old.txt"), "old");
		writeFileSync(join(paths.canonicalWorkspace, "new.txt"), "new");

		const migrated = migrateLegacyWorkspace({ workspacePath: paths.legacyWorkspace }, paths);

		expect(migrated.workspacePath).toBe(paths.legacyWorkspace);
		expect(readdirSync(paths.canonicalWorkspace)).toEqual(["new.txt"]);
		expect(readdirSync(paths.legacyWorkspace)).toEqual(["old.txt"]);
	});

	it("does not move custom workspace paths or custom configuration homes", () => {
		const paths = createPaths();
		mkdirSync(paths.legacyWorkspace, { recursive: true });
		const customWorkspace = join(paths.userHome, "work", "project");
		const configured = migrateLegacyWorkspace({ workspacePath: customWorkspace }, paths);
		const customHome = { ...paths, configHome: join(paths.userHome, ".custom-agent") };
		const customConfig = migrateLegacyWorkspace({ workspacePath: "~/.vetta/workspace" }, customHome);

		expect(configured.workspacePath).toBe(customWorkspace);
		expect(customConfig.workspacePath).toBe(paths.legacyWorkspace);
		expect(existsSync(paths.legacyWorkspace)).toBe(true);
	});
});

function createPaths(): LegacyWorkspacePaths {
	const userHome = mkdtempSync(join(tmpdir(), "567-workspace-migration-"));
	roots.push(userHome);
	const configHome = join(userHome, ".567agent");
	return {
		configHome,
		userHome,
		legacyWorkspace: join(userHome, ".vetta", "workspace"),
		canonicalWorkspace: join(configHome, "workspace"),
	};
}
