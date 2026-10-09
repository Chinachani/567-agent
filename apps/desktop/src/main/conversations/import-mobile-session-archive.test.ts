import { mkdtemp, readdir, rm } from "node:fs/promises";
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
});
