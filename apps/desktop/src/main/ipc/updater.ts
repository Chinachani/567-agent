import { ipcMain, type WebContents } from "electron";
import { normalizeUpdaterPreferences } from "../../shared/updater-preferences.js";
import { getAppVersion, updateReleaseHistory, updaterService } from "../updater.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

export function registerUpdaterIpc(owner: WebContents): () => void {
	ipcMain.handle("vetta:updater:check", async (event) => {
		assertTrustedMainRenderer(event, owner);
		return updaterService.check();
	});

	ipcMain.handle("vetta:updater:sync", async (event) => {
		assertTrustedMainRenderer(event, owner);
		await updaterService.syncInBackground();
	});

	ipcMain.handle("vetta:updater:get-state", (event) => {
		assertTrustedMainRenderer(event, owner);
		return updaterService.getState();
	});

	ipcMain.handle("vetta:updater:get-current-version", (event) => {
		assertTrustedMainRenderer(event, owner);
		return getAppVersion();
	});

	ipcMain.handle("vetta:updater:download", async (event) => {
		assertTrustedMainRenderer(event, owner);
		return updaterService.startDownload();
	});
	ipcMain.handle("agent567:updater:pause", (event) => {
		assertTrustedMainRenderer(event, owner);
		updaterService.pauseDownload();
	});

	ipcMain.handle("vetta:updater:install", async (event) => {
		assertTrustedMainRenderer(event, owner);
		await updaterService.install();
	});

	ipcMain.handle("vetta:updater:dismiss", (event) => {
		assertTrustedMainRenderer(event, owner);
		updaterService.dismissReady();
	});

	ipcMain.handle("vetta:updater:cancel", (event) => {
		assertTrustedMainRenderer(event, owner);
		updaterService.cancel();
	});

	ipcMain.handle("agent567:updater:get-preferences", (event) => {
		assertTrustedMainRenderer(event, owner);
		return updaterService.getPreferences();
	});
	ipcMain.handle("agent567:updater:set-preferences", (event, value: unknown) => {
		assertTrustedMainRenderer(event, owner);
		const valid = normalizeUpdaterPreferences(value);
		if (
			!value ||
			typeof value !== "object" ||
			Object.entries(valid).some(([key, item]) => (value as Record<string, unknown>)[key] !== item)
		)
			throw new Error("Invalid updater preferences");
		return updaterService.setPreferences(valid);
	});
	ipcMain.handle("agent567:updater:release-history", (event) => {
		assertTrustedMainRenderer(event, owner);
		return updateReleaseHistory.get();
	});
	return () => {
		ipcMain.removeHandler("agent567:updater:pause");
		ipcMain.removeHandler("agent567:updater:get-preferences");
		ipcMain.removeHandler("agent567:updater:set-preferences");
		ipcMain.removeHandler("agent567:updater:release-history");
		ipcMain.removeHandler("vetta:updater:check");
		ipcMain.removeHandler("vetta:updater:sync");
		ipcMain.removeHandler("vetta:updater:get-state");
		ipcMain.removeHandler("vetta:updater:get-current-version");
		ipcMain.removeHandler("vetta:updater:download");
		ipcMain.removeHandler("vetta:updater:install");
		ipcMain.removeHandler("vetta:updater:dismiss");
		ipcMain.removeHandler("vetta:updater:cancel");
	};
}
