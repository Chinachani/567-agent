import { describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import { GeneralSettingsService } from "./general-settings-service.js";

function createConfig(): DesktopConfig {
	return {
		projects: [],
		archivedProjects: [],
		workspacePath: "C:\\workspace",
		defaultExecutionMode: "full-access",
		debugMode: true,
		notificationsEnabled: true,
	};
}

function createConfigStore(initial: DesktopConfig) {
	let config = initial;
	return {
		readConfig: async () => config,
		updateConfig: async (mutate: (config: DesktopConfig) => DesktopConfig | Promise<DesktopConfig>) => {
			config = await mutate(config);
			return config;
		},
		getConfig: () => config,
	};
}

describe("GeneralSettingsService", () => {
	it("returns a stable general settings snapshot", async () => {
		const store = createConfigStore(createConfig());
		const service = new GeneralSettingsService({
			...store,
			allowWorkspaceRoot: vi.fn(),
			getSandbox: () => ({ status: "available", backend: "windows-host", platform: "win32" }),
		});

		await expect(service.getSettings()).resolves.toEqual({
			workspacePath: "C:\\workspace",
			defaultExecutionMode: "full-access",
			notificationsEnabled: true,
			debugMode: true,
			sandbox: { status: "available", backend: "windows-host", platform: "win32" },
		});
	});

	it("updates one setting without dropping adjacent config", async () => {
		const store = createConfigStore(createConfig());
		const service = new GeneralSettingsService({
			...store,
			allowWorkspaceRoot: vi.fn(),
			getSandbox: () => ({ status: "unknown", backend: null, platform: "win32" }),
		});

		await expect(service.setNotifications(false)).resolves.toEqual({ enabled: false });
		expect(store.getConfig()).toEqual({ ...createConfig(), notificationsEnabled: false });
	});

	it("normalizes and authorizes absolute workspace paths", async () => {
		const store = createConfigStore(createConfig());
		const allowWorkspaceRoot = vi.fn();
		const service = new GeneralSettingsService({
			...store,
			allowWorkspaceRoot,
			getSandbox: () => ({ status: "unknown", backend: null, platform: "win32" }),
		});

		await expect(service.setWorkspace("  C:\\next  ")).resolves.toEqual({ path: "C:\\next" });
		expect(allowWorkspaceRoot).toHaveBeenCalledWith("C:\\next");
		expect(store.getConfig()).toEqual({ ...createConfig(), workspacePath: "C:\\next" });
		await expect(service.setWorkspace("relative/path")).rejects.toThrow("workspace path must be absolute");
	});
});
