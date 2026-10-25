import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeHost } from "@567agent/runtime-core";
import { isConversationDocumentCommand } from "@567agent/runtime-storage/conversation";
import { describe, expect, it, vi } from "vitest";
import type { DesktopConversationService, DesktopConversationSession } from "./desktop-conversation-service.js";
import { importMobileSessionArchive, mobileMessageToConversationRecord } from "./import-mobile-session-archive.js";
import type { SessionMigrationArchive } from "./session-migration-backup.js";

const archive: SessionMigrationArchive = {
	schemaVersion: 1,
	exportedAtEpochMs: 10,
	sessions: [{ id: "mobile-1", title: "Imported chat", createdAtEpochMs: 1, updatedAtEpochMs: 2 }],
	messages: [
		{
			sessionId: "mobile-1",
			items: [
				{
					id: "user-1",
					sessionId: "mobile-1",
					role: "user",
					content: "hello",
					status: "Complete",
					createdAtEpochMs: 1,
				},
				{
					id: "assistant-1",
					sessionId: "mobile-1",
					role: "assistant",
					content: "world",
					status: "Complete",
					createdAtEpochMs: 2,
				},
			],
		},
	],
};

describe("import mobile session archive", () => {
	it("converts user and assistant messages and preserves the turn relationship", () => {
		const group = archive.messages[0];
		if (!group) throw new Error("Test fixture has no messages");
		const user = mobileMessageToConversationRecord(group.items[0]!, "turn-1");
		const assistant = mobileMessageToConversationRecord(group.items[1]!, "turn-1");
		expect(user?.kind).toBe("user");
		expect(assistant?.kind).toBe("agent");
		expect(user?.turnId).toBe(assistant?.turnId);
	});

	it("keeps imported tool output in a structured tool call accepted by conversation storage", () => {
		const assistant = mobileMessageToConversationRecord(
			{
				id: "assistant-with-tool",
				sessionId: "mobile-1",
				role: "assistant",
				content: "The file was created.",
				status: "Complete",
				createdAtEpochMs: 3,
				toolEvents: [
					{
						phase: "completed",
						phaseLabel: "已完成",
						toolCallId: "tool-1",
						toolName: "write_file",
						arguments: '{"path":"notes.txt"}',
						detail: "Wrote file",
						result: "Created notes.txt",
						durationMs: 125,
					},
				],
			},
			"turn-1",
		);
		if (!assistant || assistant.kind !== "agent") throw new Error("Expected imported assistant message");
		const content = assistant.message.content;
		expect(content).toEqual([
			{ type: "text", text: "The file was created." },
			expect.objectContaining({
				type: "toolCall",
				id: "tool-1",
				name: "write_file",
				arguments: { path: "notes.txt" },
				result: "已完成\nWrote file\nCreated notes.txt",
				durationMs: 125,
			}),
		]);
		expect(isConversationDocumentCommand({ type: "message.append", record: assistant })).toBe(true);
		expect(JSON.stringify(content)).not.toContain("[工具记录：");
	});

	it("writes assistant images as project media and links them from history", async () => {
		const session = { sessionId: "desktop-1", sessionPath: "/tmp/desktop-1.jsonl" } as DesktopConversationSession;
		const records: unknown[] = [];
		const runtime = {
			renameSessionById: vi.fn(async () => undefined),
			appendConversationMessage: vi.fn(async (_id: string, record: unknown) => records.push(record)),
			deleteSession: vi.fn(async () => undefined),
		} as unknown as RuntimeHost;
		const conversationService = {
			createSession: vi.fn(async () => session),
		} as unknown as DesktopConversationService;
		const archiveWithImage: SessionMigrationArchive = {
			...archive,
			messages: [
				{
					sessionId: "mobile-1",
					items: [
						{
							id: "assistant-with-image",
							sessionId: "mobile-1",
							role: "assistant",
							content: "Generated image",
							status: "Complete",
							createdAtEpochMs: 4,
							images: [{ id: "image-1", mimeType: "image/png", base64Data: "AQID", fileName: "result.png" }],
						},
					],
				},
			],
		};
		const cwd = await mkdtemp(join(tmpdir(), "mobile-import-image-"));
		try {
			await importMobileSessionArchive(archiveWithImage, { runtime, conversationService, cwd });
			const record = records[0] as { message: { content: Array<{ type: string; text?: string }> } };
			const text = record.message.content.find((part) => part.type === "text")?.text ?? "";
			expect(text).toMatch(/!\[导入的图片\]\(\.567agent\/imported-media\/[^)]+\.png\)/);
			expect(await readdir(join(cwd, ".567agent", "imported-media"))).toHaveLength(1);
			expect(isConversationDocumentCommand({ type: "message.append", record: records[0] as never })).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("creates a desktop session, imports messages, and reports the new path", async () => {
		const session = { sessionId: "desktop-1", sessionPath: "/tmp/desktop-1.jsonl" } as DesktopConversationSession;
		const runtime = {
			renameSessionById: vi.fn(async () => undefined),
			appendConversationMessage: vi.fn(async () => undefined),
			deleteSession: vi.fn(async () => undefined),
		} as unknown as RuntimeHost;
		const conversationService = {
			createSession: vi.fn(async () => session),
		} as unknown as DesktopConversationService;

		const result = await importMobileSessionArchive(archive, { runtime, conversationService, cwd: "/tmp" });

		expect(result).toEqual({
			importedSessions: 1,
			importedMessages: 2,
			sessionPaths: [session.sessionPath],
		});
		expect(runtime.renameSessionById).toHaveBeenCalledWith(session.sessionId, "Imported chat");
		expect(runtime.appendConversationMessage).toHaveBeenCalledTimes(2);
	});

	it("deletes sessions created by a failed import", async () => {
		const session = { sessionId: "desktop-1", sessionPath: "/tmp/desktop-1.jsonl" } as DesktopConversationSession;
		const runtime = {
			renameSessionById: vi.fn(async () => undefined),
			appendConversationMessage: vi.fn(async () => {
				throw new Error("disk full");
			}),
			deleteSession: vi.fn(async () => undefined),
		} as unknown as RuntimeHost;
		const conversationService = {
			createSession: vi.fn(async () => session),
		} as unknown as DesktopConversationService;

		await expect(importMobileSessionArchive(archive, { runtime, conversationService, cwd: "/tmp" })).rejects.toThrow(
			"Mobile conversation import failed at session 1 (Imported chat), desktop id desktop-1: Mobile conversation import failed at message 1 (user): disk full",
		);
		expect(runtime.deleteSession).toHaveBeenCalledWith(session.sessionPath);
	});
	it("skips mirrored desktop sessions and their media instead of copying them back", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent567-import-mirror-"));
		const createSession = vi.fn();
		const runtime = {} as RuntimeHost;
		try {
			const result = await importMobileSessionArchive(
				{
					...archive,
					sessions: [{ ...archive.sessions[0]!, origin: "Desktop" }],
					messages: [
						{
							sessionId: "mobile-1",
							items: [
								{
									...archive.messages[0]!.items[1]!,
									images: [{ id: "mirror", mimeType: "image/png", base64Data: "invalid" }],
								},
							],
						},
					],
				},
				{ cwd, runtime, conversationService: { createSession } as unknown as DesktopConversationService },
			);
			expect(result).toEqual({ importedSessions: 0, importedMessages: 0, sessionPaths: [] });
			expect(createSession).not.toHaveBeenCalled();
			expect(await readdir(cwd)).toEqual([]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
	it("removes only new media after failure and allows a clean retry without orphan files", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent567-import-retry-"));
		const mediaRoot = join(cwd, ".567agent", "imported-media");
		const session = { sessionId: "desktop-1", sessionPath: join(cwd, "session.jsonl") } as DesktopConversationSession;
		const append = vi.fn(async () => ({ entryId: "entry" }));
		append.mockRejectedValueOnce(new Error("disk full"));
		const runtime = {
			renameSessionById: async () => {},
			appendConversationMessage: append,
			deleteSession: vi.fn(async () => {}),
		} as unknown as RuntimeHost;
		const conversationService = { createSession: async () => session } as unknown as DesktopConversationService;
		const source: SessionMigrationArchive = {
			...archive,
			messages: [
				{
					sessionId: "mobile-1",
					items: [
						{
							...archive.messages[0]!.items[1]!,
							images: [{ id: "new", mimeType: "image/png", base64Data: "AQID" }],
						},
					],
				},
			],
		};
		try {
			await mkdir(mediaRoot, { recursive: true });
			await writeFile(join(mediaRoot, "existing.png"), "existing data");
			await expect(importMobileSessionArchive(source, { cwd, runtime, conversationService })).rejects.toThrow(
				"disk full",
			);
			expect(await readdir(mediaRoot)).toEqual(["existing.png"]);
			expect(await readFile(join(mediaRoot, "existing.png"), "utf8")).toBe("existing data");
			expect(runtime.deleteSession).toHaveBeenCalledWith(session.sessionPath);
			const result = await importMobileSessionArchive(source, { cwd, runtime, conversationService });
			expect(result.importedSessions).toBe(1);
			expect(result.importedMessages).toBe(1);
			expect(await readdir(mediaRoot)).toHaveLength(2);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
	it("keeps a phone reset boundary excluded after a later summary is imported", async () => {
		const restoreImportedContext = vi.fn(async () => undefined);
		const source = {
			...archive,
			sessions: [
				{
					...archive.sessions[0]!,
					context: {
						resetThroughMessageId: "old-assistant",
						resetThroughCreatedAtEpochMs: 2,
						throughMessageId: "recent-assistant",
						throughCreatedAtEpochMs: 4,
						summary: "Recent summary",
					},
				},
			],
			messages: [
				{
					sessionId: archive.sessions[0]!.id,
					items: [
						{ ...archive.messages[0]!.items[0]!, id: "old-user", role: "user" as const, createdAtEpochMs: 1 },
						{
							...archive.messages[0]!.items[0]!,
							id: "old-assistant",
							role: "assistant" as const,
							createdAtEpochMs: 2,
						},
						{ ...archive.messages[0]!.items[0]!, id: "recent-user", role: "user" as const, createdAtEpochMs: 3 },
						{
							...archive.messages[0]!.items[0]!,
							id: "recent-assistant",
							role: "assistant" as const,
							createdAtEpochMs: 4,
						},
					],
				},
			],
		};
		const { parseSessionMigrationArchive } = await import("./session-migration-backup.js");
		let index = 0;
		const runtime = {
			renameSessionById: async () => {},
			deleteSession: async () => {},
			appendConversationMessage: async () => ({ entryId: `entry-${++index}` }),
		} as unknown as RuntimeHost;
		const conversationService = {
			createSession: async () => ({ sessionId: "desktop-1", sessionPath: "/tmp/desktop-1.jsonl" }),
			restoreImportedContext,
		} as unknown as DesktopConversationService;
		await importMobileSessionArchive(parseSessionMigrationArchive(Buffer.from(JSON.stringify(source))), {
			runtime,
			conversationService,
			cwd: "/tmp",
		});
		expect(restoreImportedContext).toHaveBeenCalledWith(
			"desktop-1",
			expect.objectContaining({ excludedTurnIds: ["entry-1"] }),
			["entry-3"],
		);
	});
});
