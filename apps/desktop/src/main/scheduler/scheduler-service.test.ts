import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeHost } from "@567agent/runtime-core";
import { afterAll, expect, it, vi } from "vitest";

const fixture = await vi.hoisted(async () => {
	const fs = await import("node:fs/promises");
	const os = await import("node:os");
	const path = await import("node:path");
	return { root: await fs.mkdtemp(path.join(os.tmpdir(), "agent567-scene-task-")) };
});
vi.mock("@567agent/action-rpc", () => ({ getAgent567HomePath: () => fixture.root }));
vi.mock("../app-monitor/app-monitor-service.js", () => ({ recordAutomationTaskCreated: vi.fn() }));
// Editing uses real storage; execution has its own runtime contract tests.
vi.mock("./task-executor.js", () => ({ abortTask: vi.fn(), executeTask: vi.fn(), isTaskRunning: () => false }));

import { SchedulerService } from "./scheduler-service.js";
import { loadTasks, type ScheduledTask, saveTasks } from "./task-storage.js";

afterAll(async () => {
	const { rm } = await import("node:fs/promises");
	await rm(fixture.root, { recursive: true, force: true });
});

it("opens a retired automation without rewriting it, then explicitly saves it as an ordinary paused task", async () => {
	const legacy: ScheduledTask = {
		id: "legacy",
		name: "Review",
		prompt: "Review files",
		cron: "0 9 * * *",
		cwd: fixture.root,
		isOnce: false,
		enabled: false,
		createdAt: 1,
		updatedAt: 1,
		lastRunAt: 2,
		lastRunStatus: "failed",
		skill: { name: "review", type: "scene" },
	};
	await saveTasks([legacy]);
	const path = join(fixture.root, "scheduled-tasks.json");
	const original = await readFile(path, "utf8");
	const service = new SchedulerService({
		getRuntime: () => ({}) as RuntimeHost,
		scheduleTask: vi.fn(),
		unscheduleTask: vi.fn(),
	});
	expect((await service.listTasks())[0].skill).toBeUndefined();
	expect((await service.getTask("legacy")).skill).toBeUndefined();
	expect(await readFile(path, "utf8")).toBe(original);
	await service.updateTask("legacy", { name: "Renamed" });
	expect((await loadTasks())[0].skill).toEqual(legacy.skill);
	await service.updateTask("legacy", { prompt: "Review ordinary files", skill: null });
	const stored = (await loadTasks())[0];
	expect(stored.skill).toBeUndefined();
	expect(stored).toMatchObject({
		name: "Renamed",
		enabled: false,
		lastRunAt: 2,
		lastRunStatus: "failed",
		prompt: "Review ordinary files",
	});
	await expect(service.updateTask("legacy", { skill: { name: "review", type: "scene" } })).rejects.toMatchObject({
		code: "SCHEDULER_TASK_INVALID_INPUT",
	});
	await service.updateTask("legacy", { skill: { name: "review", type: "skill" } });
	expect((await service.getTask("legacy")).skill).toEqual({ name: "review", type: "skill" });
	await service.updateTask("legacy", { skill: undefined });
	expect((await service.getTask("legacy")).skill).toBeUndefined();
});
