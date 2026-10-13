import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	createEmptyConversationDocument,
	projectConversationDocumentHistory,
	selectConversationDocumentMessages,
} from "@567agent/runtime-core/conversation";
import type { StoredSessionEvent } from "@567agent/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { AssistantTurnTimingPersistence } from "../src/sessions/projection/assistant-turn-timing-persistence.js";

describe("persisted assistant total time", () => {
	it("does not reject a completed turn when optional timing storage fails", async () => {
		const error = new Error("storage unavailable");
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const timing = new AssistantTurnTimingPersistence();
			timing.initialize(createEmptyConversationDocument({ sessionId: "s", createdAt: 0 }), {
				appendCustomEntry: async () => {
					throw error;
				},
			});
			await timing.onSessionEvent({
				type: "turn.started",
				sessionId: "s",
				turnId: "t",
				timestamp: 1000,
				snapshotId: "snapshot",
			});
			await expect(
				timing.onSessionEvent({
					type: "turn.completed",
					sessionId: "s",
					turnId: "t",
					timestamp: 2000,
					stopReason: "stop",
				}),
			).resolves.toBeUndefined();
			expect(log).toHaveBeenCalledWith("[assistant-turn-timing] Could not persist total time", error);
		} finally {
			log.mockRestore();
		}
	});

	it.each(["turn.completed", "turn.cancelled", "turn.failed"] as const)(
		"keeps the full duration after reopening a %s turn without sending it to the model",
		async (type) => {
			let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 1000 });
			const timing = new AssistantTurnTimingPersistence();
			timing.initialize(document, {
				appendCustomEntry: async (entry) => {
					document = applyConversationDocumentCommand(document, { type: "custom.append", ...entry }).document;
				},
			});
			const started = {
				type: "turn.started",
				sessionId: "session-1",
				turnId: "turn-1",
				snapshotId: "s",
				timestamp: 1000,
			} as const;
			await timing.onSessionEvent(started);
			document = applyStoredEventToConversationDocument(
				document,
				{
					type: "message.appended",
					sessionId: "session-1",
					turnId: "turn-1",
					timestamp: 1000,
					message: { role: "user", content: "work with tools", timestamp: 1000 },
				},
				1,
			);
			const terminal = {
				type,
				sessionId: "session-1",
				turnId: "turn-1",
				timestamp: 129_400,
				...(type === "turn.failed" ? { error: { code: "FAILED", message: "failed" } } : {}),
				...(type === "turn.completed" ? { stopReason: "stop" } : {}),
			} as StoredSessionEvent;
			await timing.onSessionEvent(terminal);
			await timing.onSessionEvent(terminal);
			const reopened = JSON.parse(JSON.stringify(document));
			expect(
				projectConversationDocumentHistory(reopened).filter((entry) => entry.type === "assistant_turn_timing"),
			).toEqual([
				{
					type: "assistant_turn_timing",
					timing: { startedAt: 1000, endedAt: 129_400, durationMs: 128_400 },
					timestamp: new Date(129_400).toISOString(),
				},
			]);
			expect(selectConversationDocumentMessages(reopened)).toEqual([
				{ role: "user", content: "work with tools", timestamp: 1000 },
			]);
		},
	);

	it("does not carry a previous timer into the next turn or persist a terminal event without a start", async () => {
		const entries: unknown[] = [];
		const timing = new AssistantTurnTimingPersistence();
		timing.initialize(createEmptyConversationDocument({ sessionId: "s", createdAt: 0 }), {
			appendCustomEntry: async (entry) => {
				entries.push(entry);
			},
		});
		await timing.onSessionEvent({
			type: "turn.completed",
			sessionId: "s",
			turnId: "old",
			timestamp: 4000,
			stopReason: "stop",
		});
		await timing.onSessionEvent({
			type: "turn.started",
			sessionId: "s",
			turnId: "new",
			snapshotId: "snapshot",
			timestamp: 10_000,
		});
		await timing.onSessionEvent({
			type: "turn.completed",
			sessionId: "s",
			turnId: "new",
			timestamp: 12_000,
			stopReason: "stop",
		});
		expect(entries).toEqual([
			expect.objectContaining({ data: { startedAt: 10_000, endedAt: 12_000, durationMs: 2000 } }),
		]);
	});
});
