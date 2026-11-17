import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import type { AutomationTaskEvent, AutomationTaskInput, AutomationTaskPatch } from "../../shared/automation.js";
import type { SchedulerService } from "../scheduler/scheduler-service.js";
import { emitTaskEvent, onTaskEvent } from "../scheduler/task-events.js";
import { getRunningTaskIds } from "../scheduler/task-executor.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

const CHANNELS = {
	GET_TASKS: "vetta:scheduler:get-tasks",
	CREATE_TASK: "vetta:scheduler:create-task",
	UPDATE_TASK: "vetta:scheduler:update-task",
	DELETE_TASK: "vetta:scheduler:delete-task",
	TOGGLE_TASK: "vetta:scheduler:toggle-task",
	DISABLE_TASK: "vetta:scheduler:disable-task",
	GET_RECORDS: "vetta:scheduler:get-records",
	GET_RUNNING: "vetta:scheduler:get-running",
	GET_SESSION_LINKS: "vetta:scheduler:get-session-links",
	RUN_NOW: "vetta:scheduler:run-now",
	ABORT: "vetta:scheduler:abort",
	EVENT: "vetta:scheduler:event",
} as const;

export type TaskEvent = AutomationTaskEvent;

export function registerSchedulerIpc(webContents: WebContents, service: SchedulerService): () => void {
	const eventHandler = (event: TaskEvent) => {
		if (!webContents.isDestroyed()) webContents.send(CHANNELS.EVENT, event);
	};
	const unsubscribeEvents = onTaskEvent(eventHandler);
	const guard = (event: IpcMainInvokeEvent): void => assertTrustedMainRenderer(event, webContents);
	const unsubscribeTasksChanged = service.onTasksChanged(() => {
		emitTaskEvent({ type: "tasks.changed" });
	});

	ipcMain.handle(CHANNELS.GET_TASKS, async (event) => {
		guard(event);
		return await service.listTasks();
	});
	ipcMain.handle(CHANNELS.CREATE_TASK, async (event, task: AutomationTaskInput) => {
		guard(event);
		return await service.createTask(task);
	});
	ipcMain.handle(CHANNELS.UPDATE_TASK, async (event, id: string, patch: AutomationTaskPatch) => {
		guard(event);
		await service.updateTask(id, patch);
	});
	ipcMain.handle(CHANNELS.DELETE_TASK, async (event, id: string) => {
		guard(event);
		await service.deleteTask(id);
	});
	ipcMain.handle(CHANNELS.TOGGLE_TASK, async (event, id: string) => {
		guard(event);
		await service.toggleTask(id);
	});
	ipcMain.handle(CHANNELS.DISABLE_TASK, async (event, id: string) => {
		guard(event);
		await service.setEnabled(id, false);
	});
	ipcMain.handle(CHANNELS.GET_RECORDS, async (event, taskId: string) => {
		guard(event);
		return await service.getHistory(taskId);
	});
	ipcMain.handle(CHANNELS.GET_RUNNING, async (event) => {
		guard(event);
		return getRunningTaskIds();
	});
	ipcMain.handle(CHANNELS.GET_SESSION_LINKS, async (event) => {
		guard(event);
		return await service.listSessionLinks();
	});
	ipcMain.handle(CHANNELS.ABORT, async (event, taskId: string) => {
		guard(event);
		await service.abort(taskId);
	});
	ipcMain.handle(CHANNELS.RUN_NOW, async (event, taskId: string) => {
		guard(event);
		await service.runNow(taskId);
	});

	return () => {
		unsubscribeTasksChanged();
		unsubscribeEvents();
		for (const channel of Object.values(CHANNELS)) {
			if (channel !== CHANNELS.EVENT) ipcMain.removeHandler(channel);
		}
	};
}
