import { ipcMain, webContents } from "electron";
import { RUNTIMES_STATUS_CHANGED_CHANNEL } from "../../shared/runtime-install-progress.js";
import { getRuntimeManager } from "../runtimes/manager.js";
import { runtimeRepairRestarter } from "../runtimes/repair-restart.js";
import type { RuntimeType } from "../runtimes/types.js";

export const RUNTIMES_CHANNELS = {
	GET_STATUS: "vetta:runtimes:get-status",
	PROGRESS: "vetta:runtimes:progress",
	REINSTALL: "vetta:runtimes:reinstall",
	REDETECT: "vetta:runtimes:redetect",
	RESTART_REPAIR: "agent567:runtimes:restart-repair",
} as const;

export function registerRuntimesIpc(): () => void {
	const unsubscribe = getRuntimeManager().onStatusChanged(() => {
		for (const contents of webContents.getAllWebContents()) {
			if (contents.isDestroyed()) continue;
			try {
				contents.send(RUNTIMES_STATUS_CHANGED_CHANNEL);
			} catch {
				/* Window closed during notification. */
			}
		}
	});
	ipcMain.handle(RUNTIMES_CHANNELS.GET_STATUS, () => {
		return getRuntimeManager().getStatus();
	});

	ipcMain.handle(RUNTIMES_CHANNELS.REINSTALL, async (event, type: unknown) => {
		if (type !== "node" && type !== "python") {
			throw new Error(`invalid runtime type: ${String(type)}`);
		}
		return getRuntimeManager().reinstall(type as RuntimeType, (progress) => {
			if (!event.sender.isDestroyed()) event.sender.send(RUNTIMES_CHANNELS.PROGRESS, progress);
		});
	});

	ipcMain.handle(RUNTIMES_CHANNELS.REDETECT, () => {
		return getRuntimeManager().redetect();
	});
	ipcMain.handle(RUNTIMES_CHANNELS.RESTART_REPAIR, (_event, type: unknown) => {
		if (type !== "node" && type !== "python") throw new Error(`invalid runtime type: ${String(type)}`);
		return runtimeRepairRestarter.restart(type);
	});

	return () => {
		unsubscribe();
		ipcMain.removeHandler(RUNTIMES_CHANNELS.GET_STATUS);
		ipcMain.removeHandler(RUNTIMES_CHANNELS.REINSTALL);
		ipcMain.removeHandler(RUNTIMES_CHANNELS.REDETECT);
		ipcMain.removeHandler(RUNTIMES_CHANNELS.RESTART_REPAIR);
	};
}
