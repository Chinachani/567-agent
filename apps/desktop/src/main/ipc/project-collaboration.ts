import { ipcMain, type WebContents } from "electron";
import { PROJECT_COLLABORATION_CHANNELS } from "../../shared/project-collaboration.js";
import { getProjectCollaborationService } from "../project-collaboration/service.js";

import { assertTrustedMainRenderer } from "./trusted-renderer.js";

let serviceChangedUnsubscribe: (() => void) | undefined;

function requireCwd(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "") throw new Error("Project cwd must be a non-empty string");
	return value;
}

export function registerProjectCollaborationHandlers(owner: WebContents): () => void {
	const service = getProjectCollaborationService();
	ipcMain.handle(PROJECT_COLLABORATION_CHANNELS.read, (event, cwd: unknown) => {
		assertTrustedMainRenderer(event, owner);
		return service.read(requireCwd(cwd));
	});
	ipcMain.handle(PROJECT_COLLABORATION_CHANNELS.update, (event, cwd: unknown, patch: unknown) => {
		assertTrustedMainRenderer(event, owner);
		return service.update(requireCwd(cwd), patch);
	});
	ipcMain.handle(PROJECT_COLLABORATION_CHANNELS.control, (event, cwd: unknown, control: unknown) => {
		assertTrustedMainRenderer(event, owner);
		return service.control(requireCwd(cwd), control);
	});

	serviceChangedUnsubscribe?.();
	const unsubscribe = service.onChanged(({ cwd }) => {
		const event = { cwd };
		if (!owner.isDestroyed()) owner.send(PROJECT_COLLABORATION_CHANNELS.changed, event);
	});
	serviceChangedUnsubscribe = unsubscribe;

	return () => {
		ipcMain.removeHandler(PROJECT_COLLABORATION_CHANNELS.read);
		ipcMain.removeHandler(PROJECT_COLLABORATION_CHANNELS.update);
		ipcMain.removeHandler(PROJECT_COLLABORATION_CHANNELS.control);
		if (serviceChangedUnsubscribe === unsubscribe) {
			unsubscribe();
			serviceChangedUnsubscribe = undefined;
		}
	};
}
