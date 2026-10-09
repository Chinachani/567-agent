import { ipcMain } from "electron";
import { getRuntimeManager } from "../runtimes/manager.js";
import type { RuntimeType } from "../runtimes/types.js";

export const RUNTIMES_CHANNELS = {
	GET_STATUS: "vetta:runtimes:get-status",
	PROGRESS: "vetta:runtimes:progress",
	REINSTALL: "vetta:runtimes:reinstall",
	REDETECT: "vetta:runtimes:redetect",
} as const;

export function registerRuntimesIpc(): () => void {
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

	return () => {
		ipcMain.removeHandler(RUNTIMES_CHANNELS.GET_STATUS);
		ipcMain.removeHandler(RUNTIMES_CHANNELS.REINSTALL);
		ipcMain.removeHandler(RUNTIMES_CHANNELS.REDETECT);
	};
}
