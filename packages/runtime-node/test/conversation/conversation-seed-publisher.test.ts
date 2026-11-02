import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Message } from "@567agent/ai";
import {
	type ConversationDocumentEntry,
	selectConversationDocumentMessages,
} from "@567agent/runtime-core/conversation";
import { afterEach, describe, expect, it } from "vitest";
import {
	CONVERSATION_STORAGE_ERROR_CODES,
	createConversationSeedDraft,
	FileConversationRepository,
	publishConversationSeed,
	resolveConversationFilePath,
} from "../../src/conversation/index.js";

describe("conversation seed publisher", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("atomically publishes a native V2 document with identity and name", async () => {
		const rootDir = await temporaryDirectory(temporaryDirectories);
		const entries: ConversationDocumentEntry[] = [
			{
				type: "custom",
				id: "seed-entry",
				parentId: null,
				timestamp: "2026-08-05T00:00:00.000Z",
				customType: "fixture",
				data: { ready: true },
			},
		];

		const result = await publishConversationSeed({
			targetRootDir: rootDir,
			targetSessionId: "native-seed",
			createdAt: 10,
			agentId: "reviewer",
			cwd: "C:\\workspace",
			parentSessionPath: "C:\\sessions\\parent.conversation.jsonl",
			entries,
			activeLeafId: "seed-entry",
			name: "seeded",
		});

		expect(result.targetPath).toBe(resolveConversationFilePath(rootDir, "native-seed"));
		expect(result.document).toMatchObject({
			identity: {
				sessionId: "native-seed",
				agentId: "reviewer",
				cwd: "C:\\workspace",
				parentSessionPath: "C:\\sessions\\parent.conversation.jsonl",
			},
			activeLeafId: "seed-entry",
			name: "seeded",
		});
		const content = await readFile(result.targetPath, "utf8");
		expect(content).toContain('"recordType":"conversation.seed"');
		expect(content).not.toContain("conversation.import.seed");
	});

	it("rejects an existing target instead of overwriting it", async () => {
		const rootDir = await temporaryDirectory(temporaryDirectories);
		const options = {
			targetRootDir: rootDir,
			targetSessionId: "duplicate",
			createdAt: 10,
			entries: [] as readonly ConversationDocumentEntry[],
			activeLeafId: null,
		};
		await publishConversationSeed(options);

		await expect(publishConversationSeed(options)).rejects.toMatchObject({
			code: CONVERSATION_STORAGE_ERROR_CODES.ALREADY_EXISTS,
		});
	});

	it("keeps a native seed draft readable across synchronous updates", async () => {
		const rootDir = await temporaryDirectory(temporaryDirectories);
		const draft = await createConversationSeedDraft({
			targetRootDir: rootDir,
			targetSessionId: "draft",
			createdAt: 10,
		});
		expect(await readFile(draft.targetPath, "utf8")).toContain('"entries":[]');

		draft.update({
			entries: [
				{
					type: "custom",
					id: "draft-entry",
					parentId: null,
					timestamp: "2026-08-05T00:00:00.000Z",
					customType: "fixture",
				},
			],
			activeLeafId: "draft-entry",
		});

		const content = await readFile(draft.targetPath, "utf8");
		expect(content).toContain("draft-entry");
		expect(content).toContain('"recordType":"conversation.seed"');
	});

	it("preserves native seed entries when the conversation is forked", async () => {
		const rootDir = await temporaryDirectory(temporaryDirectories);
		await publishConversationSeed({
			targetRootDir: rootDir,
			targetSessionId: "fork-source",
			createdAt: 10,
			entries: [
				{
					type: "message",
					id: "prompt",
					parentId: null,
					timestamp: "2026-08-05T00:00:00.000Z",
					message: { role: "user", content: "fork me", timestamp: 10 },
				},
			],
			activeLeafId: "prompt",
		});
		const repository = new FileConversationRepository({ rootDir });

		const fork = await repository.fork("fork-source", "prompt");
		const forkedDocument = await repository.readDocument(fork.sessionId);

		expect(fork.text).toBe("fork me");
		expect(forkedDocument.entries).toContainEqual(expect.objectContaining({ id: "prompt", type: "message" }));
		expect(forkedDocument.activeLeafId).toBe("prompt");
	});

	it("forks the chosen reply's whole user turn, retaining tool results and excluding later turns", async () => {
		const rootDir = await temporaryDirectory(temporaryDirectories);
		const assistant = (content: AssistantMessage["content"], timestamp: number): AssistantMessage => ({
			role: "assistant",
			content,
			api: "openai-responses",
			provider: "test",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp,
		});
		const messages: Message[] = [
			{ role: "user", content: "First question", timestamp: 1 },
			assistant(
				[
					{ type: "text", text: "Checking" },
					{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "report.md" } },
				],
				2,
			),
			{
				role: "toolResult",
				toolCallId: "read-1",
				toolName: "read",
				content: [{ type: "text", text: "Report contents" }],
				isError: false,
				timestamp: 3,
			},
			assistant([{ type: "text", text: "Complete first reply" }], 4),
			{ role: "user", content: "Later question", timestamp: 5 },
			assistant([{ type: "text", text: "Later reply" }], 6),
		];
		const entries: ConversationDocumentEntry[] = messages.map((message, index) => ({
			type: "message",
			id: `message-${index}`,
			parentId: index === 0 ? null : `message-${index - 1}`,
			timestamp: new Date(index + 1).toISOString(),
			message,
		}));
		const source = await publishConversationSeed({
			targetRootDir: rootDir,
			targetSessionId: "reply-fork",
			createdAt: 1,
			entries,
			activeLeafId: "message-5",
		});
		const before = await readFile(source.targetPath, "utf8");
		const repository = new FileConversationRepository({ rootDir });
		const fork = await repository.fork("reply-fork", "message-0");
		const restored = await new FileConversationRepository({ rootDir }).readDocument(fork.sessionId);
		expect(restored.activeLeafId).toBe("message-3");
		expect(selectConversationDocumentMessages(restored)).toEqual(messages.slice(0, 4));
		expect(restored.identity.parentEntryId).toBe("message-0");
		expect(await readFile(source.targetPath, "utf8")).toBe(before);
	});
});

async function temporaryDirectory(collection: string[]): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "conversation-seed-publisher-"));
	collection.push(directory);
	return directory;
}
