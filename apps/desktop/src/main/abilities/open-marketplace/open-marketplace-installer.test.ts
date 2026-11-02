import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeMainMessages } from "../../i18n/messages.js";
import {
	assertNoRetiredSceneConflict,
	readInstalledSkillsManifest,
	writeInstalledSkillsManifest,
} from "../../skills/skill-manifest-storage.js";
import type { InstalledSkill } from "../../skills/skill-service";
import { parseMarketplaceManifest } from "./marketplace-schema";
import {
	installOpenMarketplaceAbility,
	type OpenMarketplaceInstallerDependencies,
	type OpenMarketplaceSkillManifest,
} from "./open-marketplace-installer";

const temporaryRoots: string[] = [];

async function createFixture(version = "1.0.0"): Promise<{
	root: string;
	snapshotRoot: string;
	ability: OpenMarketplaceSkillManifest;
}> {
	const root = await mkdtemp(join(tmpdir(), "vetta-open-installer-test-"));
	temporaryRoots.push(root);
	const snapshotRoot = join(root, "snapshot");
	const sourceDir = join(snapshotRoot, "abilities", "skills", "demo-skill");
	await mkdir(sourceDir, { recursive: true });
	await writeFile(
		join(sourceDir, "SKILL.md"),
		`---\nname: demo-skill\ndescription: Demo\nversion: ${version}\n---\n`,
		"utf-8",
	);
	const manifest = parseMarketplaceManifest({
		schemaVersion: 1,
		name: "vetta-open-abilities",
		marketplaceVersion: "2026.07.1",
		repository: "https://github.com/example/vetta-abilities",
		minAppVersion: "0.5.11",
		abilities: [
			{
				type: "skill",
				slug: "demo-skill",
				name: "Demo Skill",
				description: "Demo",
				version,
				configVersion: 3,
				source: { path: "abilities/skills/demo-skill" },
			},
		],
	});
	const ability = manifest.abilities[0];
	if (!ability || ability.type !== "skill") throw new Error("Fixture ability missing");
	return { root, snapshotRoot, ability };
}

function dependencies(
	root: string,
	manifest: { current: Record<string, InstalledSkill> },
	overrides?: Partial<OpenMarketplaceInstallerDependencies>,
): OpenMarketplaceInstallerDependencies {
	return {
		assertInstallableName: (name) => assertNoRetiredSceneConflict(join(root, "skills-manifest.json"), name),
		getBaseDir: () => join(root, "skills"),
		tmpBaseDir: join(root, "tmp"),
		readManifest: () => manifest.current,
		writeManifest: (next) => {
			manifest.current = next;
		},
		recordInstall: vi.fn(),
		recordEvent: vi.fn(),
		...overrides,
	};
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("installOpenMarketplaceAbility", () => {
	it("preserves a retired scene on conflict while an unrelated skill still installs and updates", async () => {
		const fixture = await createFixture();
		const path = join(fixture.root, "skills-manifest.json");
		const scene = { name: "demo-skill", type: "scene", version: "legacy", enabled: true };
		await writeFile(path, JSON.stringify({ "demo-skill": scene }));
		const legacyDir = join(fixture.root, "scenes", "demo-skill");
		await mkdir(legacyDir, { recursive: true });
		await writeFile(join(legacyDir, "SKILL.md"), "old scene content");
		initializeMainMessages("zh");
		const deps = dependencies(
			fixture.root,
			{ current: {} },
			{
				readManifest: () => readInstalledSkillsManifest(path),
				writeManifest: (value) => writeInstalledSkillsManifest(path, value),
			},
		);
		const origin = {
			kind: "github-marketplace" as const,
			marketplace: "test-market",
			marketplaceVersion: "1",
			repository: "https://github.com/example/skills",
		};
		await expect(installOpenMarketplaceAbility(fixture.snapshotRoot, fixture.ability, origin, deps)).rejects.toThrow(
			"与保留的旧场景同名",
		);
		expect(deps.recordInstall).not.toHaveBeenCalled();
		await expect(readFile(join(fixture.root, "skills", "demo-skill", "SKILL.md"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		const renamed = {
			...fixture.ability,
			slug: "new-skill",
			name: "New Skill",
			source: { path: "abilities/skills/new-skill" },
		};
		const renamedDir = join(fixture.snapshotRoot, renamed.source.path);
		await mkdir(renamedDir, { recursive: true });
		await writeFile(join(renamedDir, "SKILL.md"), "---\nname: new-skill\ndescription: New\nversion: 1.0.0\n---\n");
		await installOpenMarketplaceAbility(fixture.snapshotRoot, renamed, origin, deps);
		await writeFile(join(renamedDir, "SKILL.md"), "---\nname: new-skill\ndescription: New\nversion: 2.0.0\n---\n");
		await installOpenMarketplaceAbility(fixture.snapshotRoot, { ...renamed, version: "2.0.0" }, origin, deps);
		expect(readInstalledSkillsManifest(path)["new-skill"].version).toBe("2.0.0");
		expect(JSON.parse(await readFile(path, "utf8"))["demo-skill"]).toEqual(scene);
		expect(await readFile(join(legacyDir, "SKILL.md"), "utf8")).toBe("old scene content");
	});

	it("installs from the validated snapshot and records origin plus config version", async () => {
		const fixture = await createFixture();
		const manifest = { current: {} as Record<string, InstalledSkill> };
		const deps = dependencies(fixture.root, manifest);
		const origin = {
			kind: "github-marketplace" as const,
			marketplace: "vetta-open-abilities",
			marketplaceVersion: "2026.07.1",
			repository: "https://github.com/example/vetta-abilities",
			ref: "refa/market-v3",
		};

		await installOpenMarketplaceAbility(fixture.snapshotRoot, fixture.ability, origin, deps);

		expect(await readFile(join(fixture.root, "skills", "demo-skill", "SKILL.md"), "utf-8")).toContain(
			"version: 1.0.0",
		);
		expect(manifest.current["demo-skill"]).toMatchObject({ source: "market", version: "1.0.0", enabled: true });
		expect(deps.recordInstall).toHaveBeenCalledWith("skill", "demo-skill", "1.0.0", {
			origin,
			configVersion: 3,
			catalogId: "github:https://github.com/example/vetta-abilities:skill:demo-skill",
			slug: "demo-skill",
		});
		expect(deps.recordEvent).toHaveBeenCalledWith(
			expect.objectContaining({ name: "demo-skill", operation: "installed" }),
		);
		expect(deps.recordEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				logContext: expect.objectContaining({
					version: "1.0.0",
					installMode: "marketplace",
					artifactKind: "snapshot-source",
					marketplaceRef: "refa/market-v3",
				}),
			}),
		);
	});

	it("restores the previous directory and manifest when ledger recording fails", async () => {
		const fixture = await createFixture("2.0.0");
		const destination = join(fixture.root, "skills", "demo-skill");
		await mkdir(destination, { recursive: true });
		await writeFile(join(destination, "SKILL.md"), "old package", "utf-8");
		const previous: InstalledSkill = {
			name: "demo-skill",
			version: "1.0.0",
			installedAt: "2026-07-01T00:00:00.000Z",
			source: "market",
			enabled: false,
			type: "skill",
		};
		const manifest = { current: { "demo-skill": previous } as Record<string, InstalledSkill> };
		const deps = dependencies(fixture.root, manifest, {
			recordInstall: () => {
				throw new Error("ledger failed");
			},
		});

		await expect(
			installOpenMarketplaceAbility(
				fixture.snapshotRoot,
				fixture.ability,
				{
					kind: "github-marketplace",
					marketplace: "vetta-open-abilities",
					marketplaceVersion: "2026.07.1",
					repository: "https://github.com/example/vetta-abilities",
				},
				deps,
			),
		).rejects.toThrow("ledger failed");

		expect(await readFile(join(destination, "SKILL.md"), "utf-8")).toBe("old package");
		expect(manifest.current).toEqual({ "demo-skill": previous });
	});
});
