import type { SessionEvent } from "@567agent/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { encryptSessionMigrationArchive } from "../conversations/session-migration-backup.js";
import { DesktopConversationRemoteOperations } from "./desktop-conversation-remote-operations.js";

const { errorLog } = vi.hoisted(() => ({ errorLog: vi.fn() }));
vi.mock("../window-manager.js", () => ({ getMainWindow: () => undefined }));
vi.mock("../i18n/index.js", () => ({ mainT: (key: string) => key }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({
		debug: () => undefined,
		error: errorLog,
		info: () => undefined,
		warn: () => undefined,
	}),
}));

describe("DesktopConversationRemoteOperations", () => {
	it("logs the detailed migration import exception and preserves its diagnostic detail", async () => {
		errorLog.mockClear();
		const failure = new Error("message 1 (user): conversation write capability is unavailable");
		const conversations = {
			createSession: async () => ({
				sessionId: "unused",
				sessionPath: "C:/default/.567agent/sessions/unused.jsonl",
				cwd: "C:/default",
				listCwd: "C:/default",
				source: "interactive" as const,
			}),
			listSessions: async () => [],
			openSession: async () => ({
				sessionId: "unused",
				sessionPath: "C:/default/.567agent/sessions/unused.jsonl",
				cwd: "C:/default",
				listCwd: "C:/default",
				source: "interactive" as const,
			}),
			runTurn: async () => ({
				sessionId: "unused",
				sessionPath: "C:/default/.567agent/sessions/unused.jsonl",
				cwd: "C:/default",
				status: "completed" as const,
				stopReason: "stop",
				assistantText: "",
				messageCount: 0,
			}),
			importSessionMigrationArchive: async () => {
				throw failure;
			},
		};
		const operations = new DesktopConversationRemoteOperations(conversations, {
			cwd: "C:/default",
			allowSessionMigrationTransfer: true,
		});
		const archive = {
			schemaVersion: 1,
			exportedAtEpochMs: 1,
			sessions: [],
			messages: [],
		};
		const encrypted = encryptSessionMigrationArchive(Buffer.from(JSON.stringify(archive)), "secure-password");

		await expect(
			operations.receiveEncryptedSessionMigrationArchive(encrypted, "secure-password"),
		).rejects.toMatchObject({
			code: "SESSION_MIGRATION_IMPORT_FAILED",
			message: expect.stringContaining(
				"导入会话失败：message 1 (user): conversation write capability is unavailable",
			),
		});
		expect(errorLog).toHaveBeenCalledWith("mobile conversation archive import failed", {
			error: expect.objectContaining({
				message: expect.stringContaining("导入会话失败"),
				stack: expect.stringContaining("conversation write capability is unavailable"),
				cause: expect.objectContaining({
					message: failure.message,
					stack: expect.stringContaining("conversation write capability is unavailable"),
				}),
			}),
		});
	});

	it("reports decrypt and archive-format failures to the phone with causes logged", async () => {
		errorLog.mockClear();
		const conversations = {
			createSession: async () => ({
				sessionId: "unused",
				sessionPath: "C:/default/.567agent/sessions/unused.jsonl",
				cwd: "C:/default",
				listCwd: "C:/default",
				source: "interactive" as const,
			}),
			listSessions: async () => [],
			openSession: async () => ({
				sessionId: "unused",
				sessionPath: "C:/default/.567agent/sessions/unused.jsonl",
				cwd: "C:/default",
				listCwd: "C:/default",
				source: "interactive" as const,
			}),
			runTurn: async () => ({
				sessionId: "unused",
				sessionPath: "C:/default/.567agent/sessions/unused.jsonl",
				cwd: "C:/default",
				status: "completed" as const,
				stopReason: "stop",
				assistantText: "",
				messageCount: 0,
			}),
		};
		const operations = new DesktopConversationRemoteOperations(conversations, {
			cwd: "C:/default",
			allowSessionMigrationTransfer: true,
		});
		const encrypted = encryptSessionMigrationArchive(Buffer.from("{}"), "secure-password");
		await expect(
			operations.receiveEncryptedSessionMigrationArchive(encrypted, "wrong-password"),
		).rejects.toMatchObject({
			code: "SESSION_MIGRATION_IMPORT_FAILED",
			message: expect.stringMatching(/备份密码不正确.*The password is incorrect/i),
		});

		const invalidArchive = encryptSessionMigrationArchive(Buffer.from("not-json"), "secure-password");
		await expect(
			operations.receiveEncryptedSessionMigrationArchive(invalidArchive, "secure-password"),
		).rejects.toMatchObject({
			code: "SESSION_MIGRATION_IMPORT_FAILED",
			message: expect.stringMatching(/备份包为空或损坏.*Migration backup contents are invalid/i),
		});
		expect(errorLog).toHaveBeenCalledTimes(2);
		const loggedError = errorLog.mock.lastCall?.[1].error as {
			message: string;
			cause?: {
				message?: string;
				cause?: { name?: string };
			};
		};
		expect(loggedError.message).toContain("备份包为空或损坏");
		expect(loggedError.cause?.message).toBe("Migration backup contents are invalid");
		expect(loggedError.cause?.cause?.name).toBe("SyntaxError");
	});

	it("lists sessions from every configured desktop root and opens project sessions by their owning cwd", async () => {
		const defaultSession = {
			id: "default-session",
			path: "C:/default/.567agent/sessions/default.jsonl",
			name: "Default chat",
			firstMessage: "hello",
			modifiedAt: 1,
			cwd: "C:/default",
			access: { readHistory: true, resume: true, rename: true, delete: true },
		};
		const projectSession = {
			...defaultSession,
			id: "project-session",
			path: "C:/projects/a1/.567agent/sessions/project.jsonl",
			name: "A1 chat",
			cwd: "C:/projects/a1",
		};
		const opened = {
			sessionId: projectSession.id,
			sessionPath: projectSession.path,
			cwd: projectSession.cwd,
			listCwd: projectSession.cwd,
			source: "interactive" as const,
		};
		const listSessions = vi.fn(async (cwd: string, sessionDir?: string) => {
			if (cwd === "C:/default") return [defaultSession];
			if (cwd === "C:/projects/a1" && sessionDir === "C:/projects/a1/.567agent/sessions") {
				return [projectSession];
			}
			return [];
		});
		const openSession = vi.fn(async () => opened);
		const deleteRemoteSession = vi.fn(async () => undefined);
		const conversations = {
			createSession: async () => opened,
			listSessions,
			openSession,
			deleteRemoteSession,
			runTurn: async () => ({
				...opened,
				status: "completed" as const,
				stopReason: "stop",
				assistantText: "",
				messageCount: 0,
			}),
		};
		const operations = new DesktopConversationRemoteOperations(conversations, {
			cwd: "C:/default",
			sessionRoots: [
				{ cwd: "C:/default" },
				{ cwd: "C:/projects/a1", sessionDir: "C:/projects/a1/.567agent/sessions" },
			],
		});

		expect(await operations.listSessions()).toEqual([
			{ id: "default-session", title: "Default chat", updatedAtEpochMs: 1 },
			{ id: "project-session", title: "A1 chat", updatedAtEpochMs: 1 },
		]);
		await expect(operations.openSession("project-session")).resolves.toEqual({ sessionId: "project-session" });
		expect(listSessions).toHaveBeenCalledWith("C:/projects/a1", "C:/projects/a1/.567agent/sessions");
		expect(openSession).toHaveBeenCalledWith(projectSession.path, "sandbox", "interactive");
		await operations.deleteSession("project-session");
		expect(deleteRemoteSession).toHaveBeenCalledWith(
			"project-session",
			"C:/projects/a1",
			"C:/projects/a1/.567agent/sessions",
		);
	});

	it("creates an opaque remote session then translates a turn into protocol events", async () => {
		const session = {
			sessionId: "runtime-session-1",
			sessionPath: "C:/work/.vetta/sessions/1.jsonl",
			cwd: "C:/work",
			listCwd: "C:/work",
			source: "interactive" as const,
		};
		let observedTimeout: number | null | undefined;
		const conversations = {
			createSession: async () => session,
			listSessions: async () => [],
			openSession: async () => session,
			runTurn: async (options: { timeoutMs: number | null }) => {
				observedTimeout = options.timeoutMs;
				return {
					...session,
					status: "completed" as const,
					stopReason: "stop",
					assistantText: "Desktop answer",
					messageCount: 2,
				};
			},
		};
		const operations = new DesktopConversationRemoteOperations(conversations, { cwd: "C:/work" });
		const diagnostics = await operations.diagnostics();
		expect(diagnostics).toMatchObject({
			activeSessionCount: 0,
			cwd: "C:/work",
			osLabel: expect.any(String),
			cpu: expect.any(String),
			ram: expect.stringMatching(/(?:GB|MB)$/),
		});

		expect(await operations.createSession()).toEqual({ sessionId: "runtime-session-1" });
		const events = [];
		for await (const event of operations.prompt("runtime-session-1", "hello")) events.push(event);

		expect(events).toEqual([
			{ type: "state", payload: { state: "running" } },
			{ type: "delta", text: "Desktop answer" },
			{ type: "state", payload: { state: "completed", stopReason: "stop" } },
		]);
		expect(observedTimeout).toBeNull();
	});

	it("refuses conditional deletion when the remote conversation has messages", async () => {
		const session = {
			sessionId: "existing-session",
			sessionPath: "C:/work/.567agent/sessions/existing.jsonl",
			cwd: "C:/work",
			listCwd: "C:/work",
			source: "interactive" as const,
		};
		const deleteRemoteSession = vi.fn(async () => undefined);
		const conversations = {
			createSession: async () => session,
			listSessions: async () => [
				{
					id: session.sessionId,
					path: session.sessionPath,
					name: "Existing",
					firstMessage: "hello",
					cwd: session.cwd,
					modifiedAt: 1,
					access: { readHistory: true, resume: true, rename: true, delete: true },
				},
			],
			openSession: async () => session,
			runTurn: async () => ({
				...session,
				status: "completed" as const,
				stopReason: "stop",
				assistantText: "",
				messageCount: 0,
			}),
			readRemoteSessionHistory: () => [],
			hasRemoteSessionContent: () => true,
			deleteRemoteSession,
		};
		const operations = new DesktopConversationRemoteOperations(conversations, { cwd: "C:/work" });

		await expect(operations.deleteEmptySession(session.sessionId)).resolves.toBe(false);
		expect(deleteRemoteSession).not.toHaveBeenCalled();
	});

	it("conditionally deletes a truly empty remote draft", async () => {
		const session = {
			sessionId: "empty-session",
			sessionPath: "C:/work/.567agent/sessions/empty.jsonl",
			cwd: "C:/work",
			listCwd: "C:/work",
			source: "interactive" as const,
		};
		const deleteRemoteSession = vi.fn(async () => undefined);
		const conversations = {
			createSession: async () => session,
			listSessions: async () => [
				{
					id: session.sessionId,
					path: session.sessionPath,
					name: "",
					firstMessage: "",
					cwd: session.cwd,
					modifiedAt: 1,
					access: { readHistory: true, resume: true, rename: true, delete: true },
				},
			],
			openSession: async () => session,
			runTurn: async () => ({
				...session,
				status: "completed" as const,
				stopReason: "stop",
				assistantText: "",
				messageCount: 0,
			}),
			readRemoteSessionHistory: () => [],
			hasRemoteSessionContent: () => false,
			deleteRemoteSession,
		};
		const operations = new DesktopConversationRemoteOperations(conversations, { cwd: "C:/work" });

		await expect(operations.deleteEmptySession(session.sessionId)).resolves.toBe(true);
		expect(deleteRemoteSession).toHaveBeenCalledWith(session.sessionId, "C:/work", undefined);
	});

	it("finishes the remote turn without waiting for AI title generation", async () => {
		const session = {
			sessionId: "title-session",
			sessionPath: "C:/work/.567agent/sessions/title.jsonl",
			cwd: "C:/work",
			listCwd: "C:/work",
			source: "interactive" as const,
		};
		let finishTitle: ((title: string) => void) | undefined;
		const titleJob = new Promise<string>((resolve) => {
			finishTitle = resolve;
		});
		const conversations = {
			createSession: async () => session,
			listSessions: async () => [],
			openSession: async () => session,
			runTurn: async () => ({
				...session,
				status: "completed" as const,
				stopReason: "stop",
				assistantText: "answer",
				messageCount: 2,
			}),
			generateRemoteSessionTitle: vi.fn(() => titleJob),
		};
		const operations = new DesktopConversationRemoteOperations(conversations, { cwd: "C:/work" });
		await operations.createSession();
		const events = [];
		for await (const event of operations.prompt(session.sessionId, "question")) events.push(event);

		expect(events.at(-1)).toMatchObject({ type: "state", payload: { state: "completed" } });
		expect(conversations.generateRemoteSessionTitle).toHaveBeenCalledOnce();
		finishTitle?.("Generated title");
	});

	it("forwards runtime deltas and tool lifecycle events as they arrive", async () => {
		const session = {
			sessionId: "runtime-session-stream",
			sessionPath: "C:/work/.vetta/sessions/stream.jsonl",
			cwd: "C:/work",
			listCwd: "C:/work",
			source: "interactive" as const,
		};
		let subscriber: ((event: SessionEvent) => void) | undefined;
		const conversations = {
			createSession: async () => session,
			listSessions: async () => [],
			openSession: async () => session,
			subscribe: (_sessionId: string, handler: (event: SessionEvent) => void) => {
				subscriber = handler;
				return () => {
					subscriber = undefined;
				};
			},
			runTurn: async () => {
				subscriber?.({
					type: "message.delta",
					delta: "part",
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e1",
					timestamp: 1,
					source: "agent",
				});
				subscriber?.({
					type: "message.final",
					message: { role: "assistant", content: [{ type: "text", text: "part" }] },
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e-final-1",
					timestamp: 1,
					source: "agent",
				} as SessionEvent);
				subscriber?.({
					type: "message.final",
					message: { role: "assistant", content: [{ type: "text", text: "next answer" }] },
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e-final-2",
					timestamp: 2,
					source: "agent",
				} as SessionEvent);
				subscriber?.({
					type: "tool.start",
					toolCallId: "call-1",
					toolName: "read_file",
					args: { path: "README.md" },
					startedAt: 1,
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e2",
					timestamp: 2,
					source: "agent",
				});
				subscriber?.({
					type: "tool.phase",
					toolCallId: "call-1",
					toolName: "read_file",
					label: "读取文件内容",
					atMs: 24,
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e-phase",
					timestamp: 2,
					source: "agent",
				});
				subscriber?.({
					type: "retry.start",
					attempt: 1,
					maxAttempts: 2,
					delayMs: 100,
					errorMessage: "temporary",
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e3",
					timestamp: 3,
					source: "agent",
				});
				subscriber?.({
					type: "compaction.start",
					reason: "threshold",
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e4",
					timestamp: 4,
					source: "agent",
				});
				subscriber?.({
					type: "usage.update",
					input: 100,
					output: 25,
					cacheRead: 0,
					cacheWrite: 0,
					costTotal: 0,
					contextPercent: 12,
					contextWindow: 1000,
					schemaVersion: 1,
					sessionId: session.sessionId,
					eventId: "e5",
					timestamp: 5,
					source: "agent",
				});
				return {
					...session,
					status: "completed" as const,
					stopReason: "stop",
					assistantText: "part",
					messageCount: 2,
				};
			},
		};
		const operations = new DesktopConversationRemoteOperations(conversations, { cwd: "C:/work" });
		await operations.createSession();
		const events = [];
		for await (const event of operations.prompt(session.sessionId, "hello")) events.push(event);
		expect(events).toEqual([
			{ type: "state", payload: { state: "running" } },
			{ type: "delta", text: "part" },
			{ type: "delta", text: "next answer" },
			{
				type: "tool",
				payload: { phase: "started", toolCallId: "call-1", toolName: "read_file", args: '{"path":"README.md"}' },
			},
			{
				type: "tool",
				payload: { phase: "phase", toolCallId: "call-1", toolName: "read_file", label: "读取文件内容" },
			},
			{ type: "state", payload: { state: "retrying", attempt: 1, maxAttempts: 2 } },
			{ type: "state", payload: { state: "compacting" } },
			{ type: "state", payload: { state: "usage", input: 100, output: 25, total: 125, contextPercent: 12 } },
			{ type: "state", payload: { state: "completed", stopReason: "stop" } },
		]);
	});
});
