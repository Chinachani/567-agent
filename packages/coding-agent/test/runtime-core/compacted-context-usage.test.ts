import type { AssistantMessage, Message, Model } from "@567agent/ai";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	createEmptyConversationDocument,
	selectConversationDocumentModelMessages,
} from "@567agent/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import { DefaultCodingAgentContextRuntime } from "../../src/compaction/runtime/context-runtime.js";
import { estimateTokens } from "../../src/compaction/token-policy.js";

describe("compacted context usage", () => {
	it("recalculates immediately after compaction, on restore and in the next model call without altering billing usage", async () => {
		const runtime = createRuntime();
		let document = originalDocument();
		runtime.initialize(document);
		expect(runtime.readUsage(1_000_000).tokens).toBe(467_000);
		runtime.publishContextComposition(report("old-call", 467_000));
		document = compact(document);
		runtime.onDocumentChanged(document);
		const messages = selectConversationDocumentModelMessages(document);
		const expected = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
		expect(runtime.readUsage(1_000_000)).toMatchObject({ tokens: expected });
		expect(runtime.readUsage(1_000_000).composition).toBeUndefined();

		const prepared = await runtime.prepare(
			{
				sessionId: "session-1",
				turnId: "next-turn",
				messages,
				historyMessages: messages,
				document,
				tokenBudget: 1_000_000,
				reservedOutputTokens: 1000,
				reportObservation: async () => {},
			},
			new AbortController().signal,
		);
		expect(prepared.estimatedTokens).toBe(expected);
		const model: Model<"openai-responses"> = {
			id: "model",
			name: "Model",
			provider: "test",
			api: "openai-responses",
			baseUrl: "https://test.invalid/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 1000,
		};
		const transformed = await runtime.transform(
			{ sessionId: "session-1", turnId: "next-turn", messages, modelBinding: { model } },
			new AbortController().signal,
		);
		expect(transformed).toEqual(messages);
		expect(runtime.readUsage(1_000_000).tokens).toBe(expected);
		// A fresh runtime reopening the same canonical document must agree.
		const reopened = createRuntime();
		reopened.initialize(document);
		expect(reopened.readUsage(1_000_000).tokens).toBe(expected);
		expect(document.entries.find((entry) => entry.id === "event-3")).toMatchObject({
			message: { usage: { totalTokens: 467_000 } },
		});
		await runtime.dispose();
		await reopened.dispose();
	});

	it("uses provider usage again after a post-compaction reply and follows branch selection", () => {
		const runtime = createRuntime();
		const original = originalDocument();
		let document = compact(original);
		runtime.initialize(document);
		document = append(document, assistant(24_000, 5));
		runtime.onDocumentChanged(document);
		expect(runtime.readUsage(1_000_000).tokens).toBe(24_000);
		runtime.publishContextComposition(report("new-call", 23_000));
		expect(runtime.readUsage(1_000_000).composition?.callId).toBe("new-call");
		document = applyConversationDocumentCommand(document, {
			type: "active_leaf.set",
			entryId: original.activeLeafId,
		}).document;
		runtime.onDocumentChanged(document);
		expect(runtime.readUsage(1_000_000).tokens).toBe(467_000);
		expect(runtime.readUsage(1_000_000).composition).toBeUndefined();
		runtime.dispose();
	});
});

function createRuntime() {
	return new DefaultCodingAgentContextRuntime({
		resolveApiKey: () => undefined,
		hookRuntime: {
			runPreCompact: async () => ({
				shouldStop: false,
				shouldBlock: false,
				additionalContexts: [],
				continuationFragments: [],
				runs: [],
			}),
			runPostCompact: async () => ({
				shouldStop: false,
				shouldBlock: false,
				additionalContexts: [],
				continuationFragments: [],
				runs: [],
			}),
			markSessionStart: () => {},
		},
	});
}

function append(document: ConversationDocument, message: Message): ConversationDocument {
	return applyStoredEventToConversationDocument(
		document,
		{
			type: "message.appended",
			sessionId: "session-1",
			turnId: "turn-1",
			message,
			timestamp: message.timestamp,
		},
		document.journalVersion + 1,
	);
}

function originalDocument() {
	let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
	for (const message of [
		{ role: "user" as const, content: "old history".repeat(100), timestamp: 1 },
		{ role: "user" as const, content: "kept question", timestamp: 2 },
		assistant(467_000, 3),
	])
		document = append(document, message);
	return document;
}

function compact(document: ConversationDocument): ConversationDocument {
	return applyStoredEventToConversationDocument(
		document,
		{
			type: "context.compacted",
			sessionId: "session-1",
			timestamp: 4,
			record: {
				summary: "short summary",
				summaryMessage: { role: "user", content: "short summary", timestamp: 4 },
				firstKeptEntryId: "event-2",
				tokensBefore: 467_000,
				reason: "manual",
			},
		},
		document.journalVersion + 1,
	);
}

function assistant(totalTokens: number, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "kept reply" }],
		api: "openai-responses",
		provider: "test",
		model: "model",
		timestamp,
		stopReason: "stop",
		usage: {
			input: totalTokens - 10,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

function report(callId: string, tokens: number) {
	return {
		version: 1 as const,
		callId,
		snapshotId: "snapshot",
		phase: "completed" as const,
		createdAt: 3,
		model: { provider: "test", modelId: "model", contextWindow: 1_000_000 },
		estimate: { tokens, knownTokens: tokens, coverage: "complete" as const },
		providerReportedInputTokens: tokens,
		sections: [],
	};
}
