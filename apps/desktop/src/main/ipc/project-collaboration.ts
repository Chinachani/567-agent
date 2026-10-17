import { BrowserWindow, ipcMain } from "electron";
import { PROJECT_COLLABORATION_CHANNELS } from "../../shared/project-collaboration.js";
import { getProjectCollaborationService } from "../project-collaboration/service.js";

let serviceChangedUnsubscribe: (() => void) | undefined;

function requireCwd(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "") throw new Error("Project cwd must be a non-empty string");
	return value;
}

export function registerProjectCollaborationHandlers(): () => void {
	const service = getProjectCollaborationService();
	ipcMain.handle(PROJECT_COLLABORATION_CHANNELS.read, (_event, cwd: unknown) => service.read(requireCwd(cwd)));
	ipcMain.handle(PROJECT_COLLABORATION_CHANNELS.update, (_event, cwd: unknown, patch: unknown) =>
		service.update(requireCwd(cwd), patch),
	);
	ipcMain.handle(PROJECT_COLLABORATION_CHANNELS.control, (_event, cwd: unknown, control: unknown) =>
		service.control(requireCwd(cwd), control),
	);

	serviceChangedUnsubscribe?.();
	const unsubscribe = service.onChanged(({ cwd }) => {
		const event = { cwd };
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.webContents.isDestroyed()) window.webContents.send(PROJECT_COLLABORATION_CHANNELS.changed, event);
		}
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
