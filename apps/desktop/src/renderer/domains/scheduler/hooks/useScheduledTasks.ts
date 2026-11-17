import { scheduledTasksAtom, scheduledTasksErrorAtom, scheduledTasksRequestVersionAtom } from "@shared/store/atoms";
import { useAtom, useStore } from "jotai";
import { useCallback, useEffect } from "react";
import type { AutomationTaskInput, AutomationTaskPatch } from "../../../../shared/automation";

export function useScheduledTasks() {
	const [tasks] = useAtom(scheduledTasksAtom);
	const [error] = useAtom(scheduledTasksErrorAtom);
	const store = useStore();

	const refreshTasks = useCallback(async () => {
		const version = store.get(scheduledTasksRequestVersionAtom) + 1;
		store.set(scheduledTasksRequestVersionAtom, version);
		try {
			const loaded = await window.agent567.scheduler.getTasks();
			if (store.get(scheduledTasksRequestVersionAtom) !== version) return;
			store.set(scheduledTasksAtom, loaded);
			store.set(scheduledTasksErrorAtom, null);
		} catch (reason) {
			if (store.get(scheduledTasksRequestVersionAtom) === version)
				store.set(scheduledTasksErrorAtom, reason instanceof Error ? reason.message : String(reason));
		}
	}, [store]);

	useEffect(() => {
		return window.agent567.scheduler.onTaskEvent((event) => {
			if (event.type === "tasks.changed") {
				void refreshTasks();
			}
		});
	}, [refreshTasks]);

	const createTask = useCallback(
		async (data: AutomationTaskInput) => {
			const task = await window.agent567.scheduler.createTask(data);
			await refreshTasks();
			return task;
		},
		[refreshTasks],
	);

	// 主进程会顺带清理暂停原因、重排作业，更新后以它的结果为准。
	const updateTask = useCallback(
		async (id: string, patch: AutomationTaskPatch) => {
			await window.agent567.scheduler.updateTask(id, patch);
			await refreshTasks();
		},
		[refreshTasks],
	);

	const deleteTask = useCallback(
		async (id: string) => {
			await window.agent567.scheduler.deleteTask(id);
			await refreshTasks();
		},
		[refreshTasks],
	);

	const toggleTask = useCallback(
		async (id: string) => {
			await window.agent567.scheduler.toggleTask(id);
			await refreshTasks();
		},
		[refreshTasks],
	);

	const runNow = useCallback(async (id: string) => {
		await window.agent567.scheduler.runTaskNow(id);
	}, []);

	const abortTask = useCallback(async (id: string) => {
		await window.agent567.scheduler.abortTask(id);
	}, []);

	const getTask = useCallback((id: string) => tasks.find((t) => t.id === id), [tasks]);

	return {
		tasks,
		error,
		createTask,
		updateTask,
		deleteTask,
		toggleTask,
		runNow,
		abortTask,
		getTask,
		refreshTasks,
	};
}
