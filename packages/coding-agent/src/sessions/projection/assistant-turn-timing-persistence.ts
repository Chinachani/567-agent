import type {
	ConversationDocument,
	RuntimeDocumentParticipant,
	RuntimeDocumentParticipantContext,
} from "@567agent/runtime-core";
import type { StoredSessionEvent } from "@567agent/runtime-core/kernel";

/** Persist turn wall time separately from model-visible messages and tool timings. */
export class AssistantTurnTimingPersistence implements RuntimeDocumentParticipant {
	private context: RuntimeDocumentParticipantContext | undefined;
	private readonly starts = new Map<string, number>();

	initialize(_document: ConversationDocument, context: RuntimeDocumentParticipantContext): void {
		this.context = context;
	}

	onDocumentChanged(_document: ConversationDocument): void {}

	async onSessionEvent(event: StoredSessionEvent): Promise<void> {
		if (event.type === "turn.started" || event.type === "turn.continued") {
			if (!this.starts.has(event.turnId)) this.starts.set(event.turnId, event.timestamp);
			return;
		}
		if (event.type !== "turn.completed" && event.type !== "turn.failed" && event.type !== "turn.cancelled") return;
		const startedAt = this.starts.get(event.turnId);
		if (startedAt === undefined || !this.context) return;
		this.starts.delete(event.turnId);
		const endedAt = Math.max(startedAt, event.timestamp);
		try {
			await this.context.appendCustomEntry({
				entryId: `turn-timing-${event.turnId}`,
				customType: "assistant_turn_timing",
				data: { startedAt, endedAt, durationMs: endedAt - startedAt },
				timestamp: new Date(endedAt).toISOString(),
			});
		} catch (error) {
			// Optional timing metadata must not invalidate a finished response.
			console.error("[assistant-turn-timing] Could not persist total time", error);
		}
	}

	dispose(): void {
		this.starts.clear();
		this.context = undefined;
	}
}
