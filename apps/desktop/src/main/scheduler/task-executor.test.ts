import type { RuntimeHost, SessionEvent } from "@567agent/runtime-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTask, TaskExecutionRecord } from "./task-storage.js";

const mocks = vi.hoisted(() => ({
	writeRecord: vi.fn(async (_record: TaskExecutionRecord) => {}),
	emitTaskEvent: vi.fn(),
	ensureConversationSubCwd: vi.fn(async (cwd: string) => cwd),
	generateId: vi.fn(() => "record-1"),
	monitorRuntimeSession: vi.fn(),
	recordAutomationRunStarted: vi.fn(),
	createSession: vi.fn(),
	updateTask: vi.fn(async (_id: string, update: (task: ScheduledTask) => ScheduledTask) => update(scheduledTask())),
	updateTaskLastRun: vi.fn(async (_taskId: string, _status: "success" | "failed") => {}),
}));

vi.mock("../app-monitor/app-monitor-service.js", () => ({
	monitorRuntimeSession: mocks.monitorRuntimeSession,
	recordAutomationRunStarted: mocks.recordAutomationRunStarted,
}));
vi.mock("../execution-mode.js", () => ({
	resolveExecutionMode: () => "full-access",
}));
vi.mock("../config/desktop-config-store.js", () => ({
	DEFAULT_CONVERSATION_CWD: "C:/desktop/conversations",
	DEFAULT_CONVERSATION_SESSION_DIR: "C:/desktop/conversations/.vetta/sessions",
	readDesktopConfig: async () => ({
		defaultExecutionMode: "full-access",
		projects: [{ path: "C:/workspace/automation" }],
	}),
}));
vi.mock("./task-events.js", () => ({
	emitTaskEvent: mocks.emitTaskEvent,
}));
vi.mock("../conversations/desktop-conversation-service.js", () => ({
	getDesktopConversationService: () => ({ createSession: mocks.createSession }),
}));
vi.mock("./automation-notifier.js", () => ({ notifyAutomationFinished: async () => undefined }));
vi.mock("../sandbox/capability.js", () => ({
	assertSandboxAvailableForMode: async () => {},
}));
vi.mock("./task-storage", () => ({
	writeRecord: mocks.writeRecord,
	generateId: mocks.generateId,
	updateTask: mocks.updateTask,
	updateTaskLastRun: mocks.updateTaskLastRun,
}));

import { initializeMainMessages } from "../i18n/messages.js";
import { executeTask, isTaskRunning, shutdownSchedulerTaskExecutor } from "./task-executor.js";

describe("scheduler RuntimeHost consumer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		initializeMainMessages("zh");
		mocks.createSession.mockResolvedValue({
			sessionId: "automation-session",
			sessionPath: "C:/sessions/automation.jsonl",
			cwd: "C:/workspace/automation",
			listCwd: "C:/workspace/automation",
		});
	});

	it("records an actionable failure for an old scene automation before starting a model session", async () => {
		const task = { ...scheduledTask(), skill: { type: "scene" as const, name: "release" } };
		const before = structuredClone(task);
		const createSession = vi.fn();
		const prompt = vi.fn();
		await executeTask(task, { createSession, prompt } as unknown as RuntimeHost, { trigger: "manual" });
		expect(createSession).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
		expect(mocks.writeRecord).toHaveBeenCalledWith(
			expect.objectContaining({ status: "failed", error: expect.stringMatching(/场景|Scenes/) }),
		);
		expect(task).toEqual(before);
	});

	it("maps one automation turn and records exactly one terminal result without disposing the shared session", async () => {
		const handlers = new Set<(event: SessionEvent) => void>();
		const createSession = vi.fn(async () => ({ sessionId: "automation-session" }));
		let finishRename: () => void = () => {};
		const renameSessionById = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishRename = resolve;
				}),
		);
		const disposeSession = vi.fn();
		const prompt = vi.fn(async () => {
			emit(handlers, messageDelta("automation-session", "scheduled response"));
			emit(handlers, toolCallStart("automation-session"));
			emit(handlers, toolStart("automation-session"));
			emit(handlers, toolEnd("automation-session"));
			emit(handlers, lifecycle("automation-session", "agent_end"));
			return { status: "completed" };
		});
		const runtime = {
			getState: () => ({ executionMode: "full-access", isStreaming: false }),
			getMessages: () => [{ role: "assistant", content: "scheduled response" }],
			createSession,
			renameSessionById,
			disposeSession,
			getSessionPath: () => "C:/desktop/conversations/.vetta/sessions/automation.jsonl",
			subscribe: (_sessionId: string, handler: (event: SessionEvent) => void) => {
				handlers.add(handler);
				return () => handlers.delete(handler);
			},
			prompt,
		} as unknown as RuntimeHost;
		const task = scheduledTask();

		const execution = executeTask(task, runtime, { trigger: "manual" });
		await vi.waitFor(() => expect(renameSessionById).toHaveBeenCalledOnce());
		expect(prompt).not.toHaveBeenCalled();
		finishRename();
		await execution;
		await vi.waitFor(() => expect(mocks.writeRecord).toHaveBeenCalledTimes(2));

		expect(mocks.createSession).toHaveBeenCalledWith(
			{
				cwd: task.runTarget.projectCwd,
				scenario: "automation",
				agentMode: "work",
				executionMode: "full-access",
			},
			"other",
			"automation",
		);
		expect(prompt).toHaveBeenCalledWith("automation-session", {
			text: task.prompt,
			modelKey: "test/provider-model",
			promptRef: { kind: "skill", name: "scheduled-skill" },
			metadata: { unattended: true, automationTaskId: task.id },
		});
		expect(mocks.writeRecord).toHaveBeenCalledTimes(2);
		expect(mocks.updateTaskLastRun).toHaveBeenCalledOnce();
		expect(mocks.updateTaskLastRun).toHaveBeenCalledWith(task.id, "success");
		expect(mocks.writeRecord.mock.calls.at(-1)?.[0]).toMatchObject({
			sessionId: "automation-session",
			status: "success",
			responsePreview: "scheduled response",
		});
		expect(mocks.emitTaskEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task.started", taskId: task.id, sessionId: "automation-session" }),
		);
		expect(isTaskRunning(task.id)).toBe(false);
		expect(handlers.size).toBe(0);
		expect(disposeSession).not.toHaveBeenCalled();
	});

	it.each(["provider down", ""])("records a failed turn as failed when the error message is %j", async (message) => {
		const handlers = new Set<(event: SessionEvent) => void>();
		const runtime = {
			getState: () => ({ executionMode: "full-access", isStreaming: false }),
			getMessages: () => [{ role: "assistant", content: "scheduled response" }],
			createSession: vi.fn(async () => ({ sessionId: "automation-session" })),
			renameSessionById: vi.fn(async () => {}),
			getSessionPath: () => "C:/desktop/conversations/.vetta/sessions/automation.jsonl",
			subscribe: (_sessionId: string, handler: (event: SessionEvent) => void) => {
				handlers.add(handler);
				return () => handlers.delete(handler);
			},
			prompt: vi.fn(async () => {
				emit(handlers, {
					...eventBase("automation-session"),
					type: "error",
					turnId: "turn-1",
					error: { message },
				} as SessionEvent);
				emit(handlers, lifecycle("automation-session", "agent_end"));
				return { status: "failed", error: { message } };
			}),
		} as unknown as RuntimeHost;
		const task = scheduledTask();

		await executeTask(task, runtime, { trigger: "manual" });
		await vi.waitFor(() => expect(mocks.updateTaskLastRun).toHaveBeenCalledWith(task.id, "failed"));

		expect(mocks.writeRecord.mock.calls.at(-1)?.[0]).toMatchObject({
			status: "failed",
			error: message,
		});
		expect(mocks.emitTaskEvent).toHaveBeenCalledWith({
			type: "record.updated",
			taskId: task.id,
		});
	});

	it("aborts active work, releases subscriptions, and rejects work after shutdown", async () => {
		const handlers = new Set<(event: SessionEvent) => void>();
		let finishPrompt: () => void = () => {};
		const prompt = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishPrompt = resolve;
				}),
		);
		const abort = vi.fn(async () => {
			emit(handlers, lifecycle("automation-session", "aborted"));
			finishPrompt();
		});
		const runtime = {
			getState: () => ({ executionMode: "full-access", isStreaming: false }),
			getMessages: () => [{ role: "assistant", content: "scheduled response" }],
			abort,
			createSession: vi.fn(async () => ({ sessionId: "automation-session" })),
			getSessionPath: () => "C:/desktop/conversations/.vetta/sessions/automation.jsonl",
			prompt,
			renameSessionById: vi.fn(),
			subscribe: (_sessionId: string, handler: (event: SessionEvent) => void) => {
				handlers.add(handler);
				return () => handlers.delete(handler);
			},
		} as unknown as RuntimeHost;
		const task = scheduledTask();
		const execution = executeTask(task, runtime, { trigger: "manual" });
		await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());

		const firstShutdown = shutdownSchedulerTaskExecutor();
		const secondShutdown = shutdownSchedulerTaskExecutor();
		await Promise.all([firstShutdown, secondShutdown, execution]);

		expect(abort).toHaveBeenCalledOnce();
		expect(isTaskRunning(task.id)).toBe(false);
		expect(handlers.size).toBe(0);
		await expect(executeTask(task, runtime, { trigger: "manual" })).rejects.toThrowError(
			"Scheduler task executor is shutting down",
		);
	});
});

function scheduledTask(): ScheduledTask {
	return {
		id: "scheduled-task",
		name: "Scheduled Task",
		prompt: "Run the scheduled task",
		schedule: { kind: "hourly", minute: 0 },
		runTarget: { mode: "new-session", projectCwd: "C:/workspace/automation" },
		enabled: true,
		model: { key: "test/provider-model" },
		skill: { type: "skill", name: "scheduled-skill" },
		createdAt: 1,
		updatedAt: 1,
		lastRunAt: null,
		lastRunStatus: null,
	};
}

function emit(handlers: ReadonlySet<(event: SessionEvent) => void>, event: SessionEvent): void {
	for (const handler of handlers) handler(event);
}

function eventBase(sessionId: string) {
	return {
		schemaVersion: 1 as const,
		sessionId,
		eventId: `${sessionId}-event`,
		timestamp: 1,
		source: "runtime-core" as const,
	};
}

function lifecycle(sessionId: string, phase: "agent_end" | "aborted"): SessionEvent {
	return { ...eventBase(sessionId), type: "session.lifecycle", phase };
}

function messageDelta(sessionId: string, delta: string): SessionEvent {
	return { ...eventBase(sessionId), type: "message.delta", delta };
}

function toolCallStart(sessionId: string): SessionEvent {
	return {
		...eventBase(sessionId),
		type: "toolcall.start",
		toolCallId: "read-call",
		toolName: "read",
	};
}

function toolStart(sessionId: string): SessionEvent {
	return {
		...eventBase(sessionId),
		type: "tool.start",
		toolCallId: "read-call",
		toolName: "read",
		args: { path: "message.txt" },
		startedAt: 1,
	};
}

function toolEnd(sessionId: string): SessionEvent {
	return {
		...eventBase(sessionId),
		type: "tool.end",
		toolCallId: "read-call",
		toolName: "read",
		isError: false,
		result: "content",
		startedAt: 1,
		durationMs: 1,
		phases: [],
	};
}
