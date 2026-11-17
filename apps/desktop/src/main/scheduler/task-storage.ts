import { constants, existsSync } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { createVersionedJsonConfigStore } from "@567agent/toolkit/config-store";
import { migrateVersionedConfig } from "@567agent/toolkit/versioned-config";
import type { AutomationSessionLink, ScheduledTask, TaskExecutionRecord } from "../../shared/automation.js";
import { getAppLogger } from "../logger.js";
import { type LegacyMigrationContext, migrateLegacyTask } from "./automation-migration.js";
import { assertAutomationId, parseAutomationStore, parseLegacyTasks } from "./automation-store-schema.js";

export type { ScheduledTask, TaskExecutionRecord } from "../../shared/automation.js";

const CONFIG_DIR = getAgent567HomePath();
const TASKS_FILE = join(CONFIG_DIR, "automations.json");
const LEGACY_TASKS_FILE = join(CONFIG_DIR, "scheduled-tasks.json");
const LEGACY_BACKUP_FILE = `${LEGACY_TASKS_FILE}.v1.bak`;
const RECORDS_DIR = join(CONFIG_DIR, "task-records");
const SCHEDULER_STATE_FILE = join(CONFIG_DIR, "automation-scheduler-state.json");

const STORE_VERSION = 2;
const taskStore = createVersionedJsonConfigStore({
	path: TASKS_FILE,
	name: "automations",
	normalize: parseAutomationStore,
	readErrorPolicy: "throw",
	writeJson: (path, value) => writeAtomic(path, JSON.stringify(value, null, 2)),
});

let migrationContextProvider: (() => Promise<LegacyMigrationContext>) | undefined;

/** 迁移需要项目列表与对话 cwd，由启动流程注入，避免存储层反向依赖配置模块。 */
export function setLegacyMigrationContextProvider(provider: () => Promise<LegacyMigrationContext>): void {
	migrationContextProvider = provider;
}

async function ensureDirectories(): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
	await mkdir(RECORDS_DIR, { recursive: true });
}

async function writeAtomic(path: string, content: string): Promise<void> {
	// 写临时文件后 rename：rename 在同一文件系统是原子操作，杜绝半截写入。
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	try {
		await writeFile(tmp, content, "utf-8");
		await rename(tmp, path);
	} finally {
		await rm(tmp, { force: true });
	}
}

/** Preserve the old file and an exclusive backup before publishing the validated new store. */
async function migrateLegacyStore(): Promise<void> {
	let raw: string;
	try {
		raw = await readFile(LEGACY_TASKS_FILE, "utf-8");
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return;
		throw error;
	}
	const legacy = parseLegacyTasks(JSON.parse(raw));
	const context = (await migrationContextProvider?.()) ?? {
		conversationCwd: join(CONFIG_DIR, "conversation"),
		isKnownProject: () => false,
		now: Date.now(),
	};
	const migrated = migrateVersionedConfig(
		{ schemaVersion: 1, tasks: legacy },
		{
			currentVersion: STORE_VERSION,
			migrations: [
				{
					fromVersion: 1,
					toVersion: 2,
					migrate: () => ({ tasks: legacy.map((task) => migrateLegacyTask(task, context)) }),
				},
			],
		},
	);
	const next = parseAutomationStore(migrated.config);
	try {
		await copyFile(LEGACY_TASKS_FILE, LEGACY_BACKUP_FILE, constants.COPYFILE_EXCL);
	} catch (error) {
		if (!hasErrorCode(error, "EEXIST")) throw error;
		if ((await readFile(LEGACY_BACKUP_FILE, "utf-8")) !== raw) {
			await copyFile(LEGACY_TASKS_FILE, `${LEGACY_BACKUP_FILE}.${Date.now()}`, constants.COPYFILE_EXCL);
		}
	}
	await taskStore.write(next);
}
function hasErrorCode(error: unknown, code: string): boolean {
	return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
let migrationPromise: Promise<void> | undefined;
function ensureMigrated(): Promise<void> {
	migrationPromise ??= (async () => {
		try {
			await readFile(TASKS_FILE, "utf-8");
		} catch (error) {
			if (!hasErrorCode(error, "ENOENT")) throw error;
			await migrateLegacyStore();
		}
	})().catch((error) => {
		migrationPromise = undefined;
		throw error;
	});
	return migrationPromise;
}
export async function loadTasks(): Promise<ScheduledTask[]> {
	await ensureDirectories();
	await ensureMigrated();
	return (await taskStore.read()).tasks;
}

// 串行化任务文件写入：执行收尾、编辑、暂停等可能并发改同一文件。
let mutationChain: Promise<void> = Promise.resolve();

async function saveTasks(tasks: readonly ScheduledTask[]): Promise<void> {
	await ensureDirectories();
	await taskStore.write({ schemaVersion: 2, tasks: [...tasks] });
}

export async function mutateTasks<T>(mutate: (tasks: ScheduledTask[]) => T | Promise<T>): Promise<T> {
	let result!: T;
	const run = async (): Promise<void> => {
		const tasks = await loadTasks();
		result = await mutate(tasks);
		await saveTasks(tasks);
	};
	mutationChain = mutationChain.then(run, run);
	await mutationChain;
	return result;
}

export async function updateTask(
	taskId: string,
	update: (task: ScheduledTask) => ScheduledTask,
): Promise<ScheduledTask | undefined> {
	return await mutateTasks((tasks) => {
		const index = tasks.findIndex((candidate) => candidate.id === taskId);
		if (index < 0) return undefined;
		tasks[index] = update(tasks[index]);
		return tasks[index];
	});
}

export async function updateTaskLastRun(taskId: string, status: "success" | "failed"): Promise<void> {
	await updateTask(taskId, (task) => ({ ...task, lastRunAt: Date.now(), lastRunStatus: status }));
}

// ── 执行记录：每条一个 jsonl，首行是元数据 ──────────────────────────────

interface StoredRecord {
	readonly record: TaskExecutionRecord;
	readonly file: string;
}

function getTaskRecordsDir(taskId: string): string {
	assertAutomationId(taskId);
	return join(RECORDS_DIR, taskId);
}

function getRecordFilePath(record: Pick<TaskExecutionRecord, "taskId" | "id">): string {
	assertAutomationId(record.id);
	return join(getTaskRecordsDir(record.taskId), `${record.id}.jsonl`);
}

/** Old JSONL records can contain an entire conversation after their metadata line. */
async function readRecordHeader(path: string): Promise<unknown> {
	const handle = await open(path, "r");
	try {
		const chunks: Buffer[] = [];
		for (let total = 0; total < 16 * 1024 * 1024; ) {
			const buffer = Buffer.alloc(8192);
			const { bytesRead } = await handle.read(buffer);
			if (!bytesRead) return JSON.parse(Buffer.concat(chunks).toString("utf8"));
			const newline = buffer.subarray(0, bytesRead).indexOf(10);
			chunks.push(buffer.subarray(0, newline < 0 ? bytesRead : newline));
			if (newline >= 0) return JSON.parse(Buffer.concat(chunks).toString("utf8"));
			total += bytesRead;
		}
		throw new Error("Automation record header is too large");
	} finally {
		await handle.close();
	}
}

function parseRecord(value: unknown, taskId: string, file: string): TaskExecutionRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid automation record");
	const data = value as Record<string, unknown>;
	assertAutomationId(data.id);
	if (
		data.taskId !== taskId ||
		file !== `${data.id}.jsonl` ||
		typeof data.startedAt !== "number" ||
		!Number.isFinite(data.startedAt) ||
		(data.completedAt !== null && (typeof data.completedAt !== "number" || !Number.isFinite(data.completedAt))) ||
		!["running", "success", "failed", "aborted", "skipped", "missed"].includes(String(data.status))
	)
		throw new Error("Invalid automation record metadata");
	for (const key of ["prompt", "responsePreview"])
		if (typeof data[key] !== "string") throw new Error("Invalid automation record text");
	for (const key of ["sessionId", "sessionPath", "cwd", "error", "notifyError"])
		if (data[key] !== undefined && typeof data[key] !== "string")
			throw new Error("Invalid automation record reference");
	if (data.mode !== undefined && data.mode !== "new-session" && data.mode !== "same-session")
		throw new Error("Invalid automation record target");
	return data as unknown as TaskExecutionRecord;
}

async function loadStoredRecords(taskId: string): Promise<StoredRecord[]> {
	const taskDir = getTaskRecordsDir(taskId);
	if (!existsSync(taskDir)) return [];
	const stored: StoredRecord[] = [];
	try {
		for (const file of await readdir(taskDir)) {
			if (!file.endsWith(".jsonl")) continue;
			const filePath = join(taskDir, file);
			try {
				stored.push({ record: parseRecord(await readRecordHeader(filePath), taskId, file), file: filePath });
			} catch (error) {
				getAppLogger("scheduler").warn("Could not read automation history entry", { taskId, file }, error);
			}
		}
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw error;
	}
	return stored.sort((a, b) => b.record.startedAt - a.record.startedAt);
}

export async function loadRecords(taskId: string): Promise<TaskExecutionRecord[]> {
	return (await loadStoredRecords(taskId)).map(({ record }) => record);
}

/** 新建或覆盖一条记录（按 record.id 定位文件）。 */
export async function writeRecord(record: TaskExecutionRecord): Promise<void> {
	const content = `${JSON.stringify(record)}\n`;
	if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw new Error("Automation record header is too large");
	await mkdir(getTaskRecordsDir(record.taskId), { recursive: true });
	await writeAtomic(getRecordFilePath(record), content);
}

export async function deleteTaskRecords(taskId: string): Promise<void> {
	await rm(getTaskRecordsDir(taskId), { recursive: true, force: true });
}

async function listRecordTaskIds(): Promise<string[]> {
	if (!existsSync(RECORDS_DIR)) return [];
	try {
		return (await readdir(RECORDS_DIR, { withFileTypes: true }))
			.filter((d) => d.isDirectory() && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(d.name))
			.map((d) => d.name);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw error;
	}
}

/**
 * 按 sessionPath 删除对应的执行记录（会话被删除时调用），
 * 保证执行历史里不残留指向已删除会话的条目。返回受影响的 taskId 列表。
 */
export async function deleteRecordsBySessionPaths(isDeleted: (sessionPath: string) => boolean): Promise<string[]> {
	const affected = new Set<string>();
	for (const taskId of await listRecordTaskIds()) {
		for (const { record, file } of await loadStoredRecords(taskId)) {
			if (record.sessionPath && isDeleted(record.sessionPath)) {
				await rm(file, { force: true });
				affected.add(taskId);
			}
		}
	}
	return [...affected];
}

/**
 * 会话与自动化的归属：执行记录里的会话，加上 same-session 绑定的会话。
 * 任务已删除的记录目录不再计入，那些会话回到普通会话的样子。
 */
export async function loadAutomationSessionLinks(tasks: readonly ScheduledTask[]): Promise<AutomationSessionLink[]> {
	const links = new Map<string, AutomationSessionLink>();
	for (const task of tasks) {
		const base = { taskId: task.id, taskName: task.name };
		// 「每次新建会话」产生过的会话一直归入会话组，即便任务后来改成了同一个会话。
		for (const record of await loadRecords(task.id)) {
			if (record.sessionPath && (record.mode ?? "new-session") === "new-session" && !links.has(record.sessionPath)) {
				links.set(record.sessionPath, { ...base, sessionPath: record.sessionPath, mode: "new-session" });
			}
		}
		// 只有当前绑定的会话带标记；换绑或改策略后，旧绑定会话回到普通会话。
		if (task.runTarget.mode === "same-session" && task.runTarget.sessionPath) {
			links.set(task.runTarget.sessionPath, {
				...base,
				sessionPath: task.runTarget.sessionPath,
				mode: "same-session",
			});
		}
	}
	return [...links.values()];
}

export function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ── 调度器存活心跳：用于推算应用未运行期间错过的触发 ────────────────────

export interface SchedulerState {
	readonly aliveAt: number;
}

export async function readSchedulerState(): Promise<SchedulerState | undefined> {
	try {
		const state = JSON.parse(await readFile(SCHEDULER_STATE_FILE, "utf-8")) as SchedulerState;
		return typeof state.aliveAt === "number" && Number.isFinite(state.aliveAt) ? state : undefined;
	} catch {
		return undefined;
	}
}

export async function writeSchedulerState(state: SchedulerState): Promise<void> {
	await ensureDirectories();
	await writeAtomic(SCHEDULER_STATE_FILE, JSON.stringify(state));
}
