// @vitest-environment jsdom

import type { InstalledPlugin } from "@preload/api";
import { i18n, initI18n } from "@shared/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginPermissionApi, PluginPermissionError, pluginPermissionRecovery } from "./plugin-permissions";
import { createPluginStorageApi, type PluginStorageBridge } from "./plugin-storage-api";

const storageList = vi.fn(async () => ["city.json"]);
const storageReadFile = vi.fn(async () => "city");
const storageReadSnapshot = vi.fn(async () => ({
	revision: "revision-1",
	files: { "city.json": "city", "project.json": "project" },
}));
const storageCommit = vi.fn(async () => ({ revision: "revision-2", changedPaths: ["city.json"] }));
const storageDeleteBlob = vi.fn(async () => undefined);

describe("plugin storage API", () => {
	const requireRead = vi.fn();
	const requireWrite = vi.fn();
	const bridge = {
		storageList,
		storageReadFile,
		storageReadSnapshot,
		storageCommit,
		storageDeleteBlob,
	} as unknown as PluginStorageBridge;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("requires write permission when deleting a private blob", async () => {
		const storage = createPluginStorageApi("session-1", bridge, requireRead, requireWrite);
		await storage.deleteBlob("source-1");
		expect(requireWrite).toHaveBeenCalledOnce();
		expect(storageDeleteBlob).toHaveBeenCalledWith("session-1", "source-1");
	});

	it("uses an explicit encoding for file reads and maps single writes to commit", async () => {
		const storage = createPluginStorageApi("session-1", bridge, requireRead, requireWrite);

		await expect(storage.readFile("city.json", "utf8")).resolves.toBe("city");
		await expect(storage.writeFile("city.json", "", "utf8")).resolves.toMatchObject({ revision: "revision-2" });

		expect(storageReadFile).toHaveBeenCalledWith("session-1", "city.json", "utf8");
		expect(requireRead).toHaveBeenCalledOnce();
		expect(storageCommit).toHaveBeenCalledWith("session-1", [
			{ type: "write", path: "city.json", data: "", encoding: "utf8" },
		]);
		expect(requireWrite).toHaveBeenCalledOnce();
	});

	it("requires both a manifest declaration and an explicit grant before reading plugin storage", async () => {
		const plugin = { permissions: [], grantedPermissions: [] } as Pick<
			InstalledPlugin,
			"permissions" | "grantedPermissions"
		>;
		const permissions = createPluginPermissionApi(plugin as InstalledPlugin);
		const storage = createPluginStorageApi(
			"session-1",
			bridge,
			() => permissions.require("storage.read"),
			requireWrite,
		);

		expect(() => storage.readFile("city.json", "utf8")).toThrow(
			expect.objectContaining({
				permission: "storage.read",
				reason: "undeclared",
			}),
		);
		plugin.permissions = ["storage.read"];
		expect(() => storage.readFile("city.json", "utf8")).toThrow(
			expect.objectContaining({
				permission: "storage.read",
				reason: "ungranted",
			}),
		);
		expect(storageReadFile).not.toHaveBeenCalled();
		plugin.grantedPermissions = ["storage.read"];
		await expect(storage.readFile("city.json", "utf8")).resolves.toBe("city");
	});

	it("explains whether a startup permission failure needs reauthorization or a package fix", async () => {
		initI18n();
		await i18n.changeLanguage("en");

		const ungranted = pluginPermissionRecovery(new PluginPermissionError("storage.read", "ungranted"));
		expect(ungranted).toContain("storage.read");
		expect(ungranted).toContain("has not been granted");

		const undeclared = pluginPermissionRecovery(new PluginPermissionError("storage.read", "undeclared"));
		expect(undeclared).toContain("storage.read");
		expect(undeclared).toContain("does not declare");
		expect(pluginPermissionRecovery(new Error("unrelated"))).toBeUndefined();
	});

	it("forwards multi-file commits, removals, snapshots, and expected revisions", async () => {
		const storage = createPluginStorageApi("session-1", bridge, requireRead, requireWrite);
		const changes = [
			{ type: "write", path: "city.json", data: "city", encoding: "utf8" },
			{ type: "remove", path: "old.json" },
		] as const;

		await storage.commit(changes, { expectedRevision: "revision-1" });
		await expect(storage.readSnapshot(["city.json", "project.json"], "utf8")).resolves.toMatchObject({
			revision: "revision-1",
		});

		expect(storageCommit).toHaveBeenCalledWith("session-1", changes, "revision-1");
		expect(storageReadSnapshot).toHaveBeenCalledWith("session-1", ["city.json", "project.json"], "utf8");
	});
});
