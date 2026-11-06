import type { AssistantMessage } from "@567agent/ai";
import { describe, expect, it } from "vitest";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	createEmptyConversationDocument,
} from "../../src/conversation/index.js";
import { RuntimeContextUsageTracker } from "../../src/kernel/index.js";

describe("RuntimeContextUsageTracker", () => {
	it("uses the injected document estimator for initialization and document changes", () => {
		let estimate = 12;
		const tracker = new RuntimeContextUsageTracker({ estimateDocumentTokens: () => estimate });
		const document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });

		tracker.initialize(document);
		expect(tracker.readUsage(100)).toEqual({ tokens: 12, contextWindow: 100, percent: 12 });
		estimate = 25;
		tracker.onDocumentChanged(document);
		expect(tracker.readUsage(100).tokens).toBe(25);
	});

	it("prefers completed provider usage and retains the privacy-safe composition report", async () => {
		const tracker = new RuntimeContextUsageTracker({ estimateDocumentTokens: () => 0 });
		await tracker.observe(
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: assistantMessage(30),
				timestamp: 1,
			},
			new AbortController().signal,
		);
		expect(tracker.readUsage(100).tokens).toBe(30);

		const report = {
			version: 1 as const,
			callId: "call-1",
			snapshotId: "snapshot-1",
			phase: "completed" as const,
			createdAt: 2,
			model: { provider: "test", modelId: "model", contextWindow: 100 },
			estimate: { tokens: 20, knownTokens: 20, coverage: "complete" as const },
			providerReportedInputTokens: 42,
			sections: [],
		};
		tracker.publishContextComposition(report);
		expect(tracker.readUsage(100)).toEqual({ tokens: 42, contextWindow: 100, percent: 42, composition: report });
	});

	it("rejects invalid token counts at the boundary", () => {
		const tracker = new RuntimeContextUsageTracker({ estimateDocumentTokens: () => -1 });
		expect(() =>
			tracker.initialize(createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 })),
		).toThrow("token count");
		expect(() => tracker.recordEstimatedTokens(Number.NaN)).toThrow("token count");
		expect(() => tracker.readUsage(-1)).toThrow("Context window");
	});

	it("retains reports across append, invalidates them on compaction and ignores the superseded call", () => {
		let estimate = 100;
		const tracker = new RuntimeContextUsageTracker({ estimateDocumentTokens: () => estimate });
		let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				timestamp: 1,
				message: assistantMessage(100),
			},
			1,
		);
		tracker.initialize(document);
		const report = {
			version: 1 as const,
			callId: "old",
			snapshotId: "s",
			phase: "completed" as const,
			createdAt: 1,
			model: { provider: "test", modelId: "m", contextWindow: 1000 },
			estimate: { tokens: 100, knownTokens: 100, coverage: "complete" as const },
			providerReportedInputTokens: 100,
			sections: [],
		};
		tracker.publishContextComposition(report);
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-2",
				timestamp: 2,
				message: { role: "user", content: "next", timestamp: 2 },
			},
			2,
		);
		tracker.onDocumentChanged(document);
		expect(tracker.readUsage(1000).composition?.callId).toBe("old");
		const previousLeaf = document.activeLeafId;
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "context.compacted",
				sessionId: "session-1",
				timestamp: 3,
				record: {
					summary: "summary",
					summaryMessage: { role: "user", content: "summary", timestamp: 3 },
					firstKeptEntryId: "event-2",
					tokensBefore: 100,
					reason: "manual",
				},
			},
			3,
		);
		estimate = 10;
		tracker.onDocumentChanged(document);
		tracker.publishContextComposition(report);
		expect(tracker.readUsage(1000)).toEqual({ tokens: 10, contextWindow: 1000, percent: 1 });
		tracker.publishContextComposition({ ...report, callId: "new", providerReportedInputTokens: 12 });
		expect(tracker.readUsage(1000)).toMatchObject({ tokens: 12, composition: { callId: "new" } });
		document = applyConversationDocumentCommand(document, {
			type: "active_leaf.set",
			entryId: previousLeaf,
		}).document;
		tracker.onDocumentChanged(document);
		expect(tracker.readUsage(1000).composition).toBeUndefined();
	});
});

function assistantMessage(totalTokens: number): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "test",
		model: "model",
		usage: {
			input: totalTokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}
