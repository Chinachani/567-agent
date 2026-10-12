import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startUpdateFeedFixture } from "../../e2e/update-feed-fixture.mjs";
import { resolveWindowsDataLayoutFromEnvironment } from "./windows-data-layout.js";
import { WindowsDataUpdater } from "./windows-data-updater.js";

const require = createRequire(import.meta.url);
const electronModulePath = require.resolve("electron");
const roots: string[] = [];
const originalElectronModule = require.cache[electronModulePath];
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

class InspectableWindowsUpdater extends WindowsDataUpdater {
	get storage() {
		return { userData: this.app.userDataPath, cache: this.app.baseCachePath };
	}
}

afterEach(async () => {
	if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
	if (originalElectronModule) require.cache[electronModulePath] = originalElectronModule;
	else delete require.cache[electronModulePath];
	vi.unstubAllEnvs();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WindowsDataUpdater", () => {
	it.each(["1.2.10", "1.2.11"])(
		"checks Windows feed version %s and preserves selected storage paths",
		async (version) => {
			const root = await mkdtemp(join(tmpdir(), "windows-updater-"));
			roots.push(root);
			vi.stubEnv("AGENT567_WINDOWS_DATA_ROOT", "D:\\Selected Data");
			vi.stubEnv("AGENT567_UPDATER_CACHE_DIR", "E:\\Update Cache");
			Object.defineProperty(process, "platform", { value: "win32" });
			const requestedPaths: string[] = [];
			// Only the Electron/OS boundary is replaced. NsisUpdater, its HTTP executor,
			// generic provider and YAML parsing all execute their production code.
			require("electron");
			const cachedModule = require.cache[electronModulePath];
			if (!cachedModule) throw new Error("Electron module was not cached");
			require.cache[electronModulePath] = {
				...cachedModule,
				exports: {
					app: {
						isPackaged: true,
						getVersion: () => "1.2.10",
						getName: () => "567-agent",
						getPath: () => root,
						whenReady: async () => {},
						once: () => {},
					},
					session: { fromPartition: () => ({}) },
					net: {
						request: (options: Parameters<typeof request>[0]) => {
							if (typeof options === "object" && "path" in options) requestedPaths.push(String(options.path));
							return request(options);
						},
					},
				},
			};
			const fixture = await startUpdateFeedFixture(version);
			try {
				const updater = new InspectableWindowsUpdater();
				updater.autoDownload = false;
				updater.setFeedURL({ provider: "generic", url: fixture.url });
				const result = await updater.checkForUpdates();
				expect(result?.isUpdateAvailable).toBe(version !== "1.2.10");
				expect(result?.updateInfo.version).toBe(version);
				expect(requestedPaths).toHaveLength(1);
				expect(requestedPaths[0]?.split("?")[0]).toBe("/latest.yml");
				expect(updater.storage).toEqual({
					userData: root,
					cache: resolveWindowsDataLayoutFromEnvironment().updaterCache,
				});
			} finally {
				await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
			}
		},
	);
});
