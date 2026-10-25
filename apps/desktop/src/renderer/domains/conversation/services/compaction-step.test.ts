import type { AssistantMessage } from "@567agent/ai";
import type { HistoryEntry, SessionEvent } from "@567agent/runtime-core";
import { createConversationUserMessage } from "@shared/conversation";
import { expect, it } from "vitest";
import { fullHistoryToChat } from "./chat-service";
import { applyCompactionStep } from "./compaction-step";
import { ConversationProjection } from "./conversation-projection";

it("keeps automatic compaction inside the reply across replay, output and persisted history", () => {
	const start: Extract<SessionEvent, { type: "compaction.start" }> = {
		schemaVersion: 1,
		type: "compaction.start",
		eventId: "c",
		sessionId: "s",
		source: "agent",
		timestamp: 2,
		turnId: "t",
		reason: "threshold",
	};
	const end = { ...start, type: "compaction.end" as const, success: true, timestamp: 3 };
	let messages = applyCompactionStep([createConversationUserMessage({ id: "u", text: "request" })], start);
	expect(messages).toHaveLength(2);
	messages = applyCompactionStep(messages, end);
	const projection = new ConversationProjection();
	projection.enqueue({
		schemaVersion: 1,
		channel: "assistant",
		source: "agent",
		sessionId: "s",
		eventId: "d",
		turnId: "t",
		timestamp: 4,
		modelCallIndex: 0,
		sequence: 4,
		type: "text_delta",
		delta: "answer",
		contentIndex: 0,
		partial: { role: "assistant", content: [{ type: "text", text: "answer" }] } as AssistantMessage,
	});
	messages = projection.flush(messages);
	const reply = messages.at(-1);
	expect(reply?.kind === "agent" && reply.blocks.map((block) => block.type)).toEqual(["compaction", "text"]);
	const history: HistoryEntry[] = [
		{ type: "message", entryId: "u", message: { role: "user", content: "request", timestamp: 1 } },
		{
			type: "compaction",
			entryId: "c",
			turnId: "t",
			tokensBefore: 100,
			summary: "summary",
			timestamp: new Date(3).toISOString(),
		},
		{
			type: "message",
			entryId: "a",
			message: { role: "assistant", content: [{ type: "text", text: "answer" }], timestamp: 4 } as AssistantMessage,
		},
	];
	const restored = fullHistoryToChat(history);
	expect(restored.map((item) => item.kind)).toEqual(["user", "agent"]);
	expect(applyCompactionStep(applyCompactionStep(restored, start), end)).toEqual(restored);
	const manual = fullHistoryToChat([
		{
			type: "compaction",
			entryId: "legacy",
			summary: "manual",
			tokensBefore: 100,
			timestamp: new Date(1).toISOString(),
		},
	]);
	expect(manual[0].kind).toBe("event");
});

it("keeps a failed compaction reason with its step instead of misusing summary text", () => {
	const event: Extract<SessionEvent, { type: "compaction.end" }> = {
		schemaVersion: 1,
		type: "compaction.end",
		eventId: "failed",
		sessionId: "s",
		source: "agent",
		timestamp: 2,
		turnId: "t",
		reason: "threshold",
		success: false,
		errorMessage: "Provider unavailable",
	};
	const messages = applyCompactionStep([createConversationUserMessage({ id: "u", text: "request" })], event);
	const reply = messages.at(-1);
	expect(reply?.kind === "agent" && reply.blocks[0]).toMatchObject({
		type: "compaction",
		status: "failed",
		errorMessage: "Provider unavailable",
	});
});
