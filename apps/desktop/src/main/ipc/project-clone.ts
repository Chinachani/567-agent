import { ipcMain, type WebContents } from "electron";
import { cancelAllClones, cancelClone, cloneProject, PROJECT_CLONE_CHANNELS } from "../projects/project-clone.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

export function registerProjectCloneIpc(owner: WebContents): () => void {
	ipcMain.handle(PROJECT_CLONE_CHANNELS.CLONE, (event, input: unknown) => {
		assertTrustedMainRenderer(event, owner);
		if (typeof input !== "object" || input === null) throw new Error("Invalid clone request");
		const raw = input as Record<string, unknown>;
		if (
			typeof raw.requestId !== "string" ||
			!raw.requestId ||
			typeof raw.url !== "string" ||
			typeof raw.parentDir !== "string"
		)
			throw new Error("Invalid clone request");
		return cloneProject({ requestId: raw.requestId, url: raw.url, parentDir: raw.parentDir });
	});
	ipcMain.handle(PROJECT_CLONE_CHANNELS.CANCEL, (event, requestId: unknown) => {
		assertTrustedMainRenderer(event, owner);
		if (typeof requestId === "string") cancelClone(requestId);
	});
	return () => {
		cancelAllClones();
		ipcMain.removeHandler(PROJECT_CLONE_CHANNELS.CLONE);
		ipcMain.removeHandler(PROJECT_CLONE_CHANNELS.CANCEL);
	};
}
