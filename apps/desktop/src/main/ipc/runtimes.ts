import { ipcMain, type WebContents } from "electron";
import { RUNTIMES_STATUS_CHANGED_CHANNEL } from "../../shared/runtime-install-progress.js";
import { getRuntimeManager } from "../runtimes/manager.js";
import { runtimeRepairRestarter } from "../runtimes/repair-restart.js";
import type { RuntimeType } from "../runtimes/types.js";

import { assertTrustedMainRenderer } from "./trusted-renderer.js";

export const RUNTIMES_CHANNELS = {
	INSTALL_GIT: "vetta:runtimes:install-git",
	GET_STATUS: "vetta:runtimes:get-status",
	PROGRESS: "vetta:runtimes:progress",
	REINSTALL: "vetta:runtimes:reinstall",
	REDETECT: "vetta:runtimes:redetect",
	RESTART_REPAIR: "agent567:runtimes:restart-repair",
} as const;

export function registerRuntimesIpc(owner: WebContents): () => void {
	const unsubscribe = getRuntimeManager().onStatusChanged(() => {
		for (const contents of [owner]) {
			if (contents.isDestroyed()) continue;
			try {
				contents.send(RUNTIMES_STATUS_CHANGED_CHANNEL);
			} catch {
				/* Window closed during notification. */
			}
		}
	});
	ipcMain.handle(RUNTIMES_CHANNELS.GET_STATUS, (event) => {
		assertTrustedMainRenderer(event, owner);
		return getRuntimeManager().getStatus();
	});

	ipcMain.handle(RUNTIMES_CHANNELS.REINSTALL, async (event, type: unknown) => {
		assertTrustedMainRenderer(event, owner);
		if (type !== "node" && type !== "python") {
			throw new Error(`invalid runtime type: ${String(type)}`);
		}
		return getRuntimeManager().reinstall(type as RuntimeType, (progress) => {
			if (!event.sender.isDestroyed()) event.sender.send(RUNTIMES_CHANNELS.PROGRESS, progress);
		});
	});

	ipcMain.handle(RUNTIMES_CHANNELS.REDETECT, (event) => {
		assertTrustedMainRenderer(event, owner);
		return getRuntimeManager().redetect();
	});
	ipcMain.handle(RUNTIMES_CHANNELS.RESTART_REPAIR, (event, type: unknown) => {
		assertTrustedMainRenderer(event, owner);
		if (type !== "node" && type !== "python") throw new Error(`invalid runtime type: ${String(type)}`);
		return runtimeRepairRestarter.restart(type);
	});

	ipcMain.handle(RUNTIMES_CHANNELS.INSTALL_GIT, (event) => {
		assertTrustedMainRenderer(event, owner);
		return getRuntimeManager().installGit();
	});
	return () => {
		ipcMain.removeHandler(RUNTIMES_CHANNELS.INSTALL_GIT);
		unsubscribe();
		ipcMain.removeHandler(RUNTIMES_CHANNELS.GET_STATUS);
		ipcMain.removeHandler(RUNTIMES_CHANNELS.REINSTALL);
		ipcMain.removeHandler(RUNTIMES_CHANNELS.REDETECT);
		ipcMain.removeHandler(RUNTIMES_CHANNELS.RESTART_REPAIR);
	};
}
