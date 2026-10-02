import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVettaPluginPackage } from "@vetta-org/plugin-vite/pack";
import { describe, expect, it } from "vitest";
import {
	copyPluginPackage,
	createInstalledPluginFromManifest,
	extractPluginArchive,
	findPluginManifest,
	readPluginManifestFromArchive,
	validatePluginPackageResources,
} from "../src/main/plugins/plugin-package.js";
import { PluginPackageOpenService } from "../src/main/plugins/plugin-package-open-service.js";

describe("plugin package distribution", () => {
	it.each(["567plugin", "vettapkg"])(
		"packs, confirms and installs a %s file through the public boundaries",
		async (extension) => {
			const root = await mkdtemp(join(tmpdir(), "567-agent-plugin-flow-"));
			try {
				const project = join(root, "project");
				await mkdir(join(project, "dist/assets"), { recursive: true });
				await writeFile(
					join(project, "plugin.json"),
					JSON.stringify({
						id: "demo",
						name: "Demo",
						version: "1.0.0",
						pluginApiVersion: "^2.0.0",
						entry: "dist/mf-manifest.json",
						moduleFederation: { remoteName: "demo", expose: "./plugin" },
						permissions: [],
					}),
				);
				await writeFile(
					join(project, "dist/mf-manifest.json"),
					JSON.stringify({ metaData: { remoteEntry: { name: "remoteEntry.js" } } }),
				);
				await writeFile(join(project, "dist/remoteEntry.js"), "export function activate() {}\n");
				const packed = await createVettaPluginPackage({ rootDir: project });
				expect(packed.outputPath).toBe(join(project, "release/demo-1.0.0.567plugin"));
				const filePath = join(project, `release/demo-1.0.0.${extension}`);
				if (filePath !== packed.outputPath) await rename(packed.outputPath, filePath);
				const events: string[] = [];
				const service = new PluginPackageOpenService({
					revealApp: () => events.push("reveal"),
					inspect: async (file) => readPluginManifestFromArchive(await readFile(file)),
					confirm: async (_file, manifest) => {
						expect(manifest.id).toBe("demo");
						events.push("confirm");
						return true;
					},
					install: async (file, inspected) => {
						await extractPluginArchive(await readFile(file), join(root, "extract"));
						const { manifest, sourceDir } = await findPluginManifest(join(root, "extract"));
						expect(manifest).toEqual(inspected);
						validatePluginPackageResources(sourceDir, manifest);
						await copyPluginPackage(sourceDir, join(root, "plugins"), manifest.id, manifest.version);
						events.push("installed");
						return createInstalledPluginFromManifest({
							manifest,
							locales: {},
							hostApiVersion: "2.0.0",
							rootPath: join(root, "plugins/demo/versions/1.0.0"),
							reloadToken: "1",
						});
					},
					notifyInstalled: async (installed) => {
						expect(installed.activeVersion).toBe("1.0.0");
						events.push("notified");
					},
					notifyError: async (_file, error) => {
						throw error;
					},
				});
				expect(service.enqueue(filePath)).toBe(true);
				expect(events).toEqual([]);
				service.markReady();
				await service.waitForIdle();
				expect(events).toEqual(["reveal", "confirm", "installed", "notified"]);
				expect(await readFile(join(root, "plugins/demo/versions/1.0.0/dist/remoteEntry.js"), "utf8")).toContain(
					"activate",
				);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);
});
