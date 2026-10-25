import type { SessionEvent } from "@567agent/runtime-core";

type CompactionEvent = Extract<SessionEvent, { type: "compaction.start" | "compaction.end" }>;
function lastIndex<T>(items: readonly T[], match: (item: T) => boolean): number {
	for (let index = items.length - 1; index >= 0; index--) if (match(items[index])) return index;
	return -1;
}

import { createConversationAgentMessage } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";

/** The transcript is the only display state. Replay updates a persisted step instead of duplicating it. */
export function applyCompactionStep(messages: ChatConversationItem[], event: CompactionEvent): ChatConversationItem[] {
	if (!event.turnId || event.reason === "manual") return messages;
	const next = [...messages];
	let index = lastIndex(
		next,
		(item) =>
			item.kind === "agent" &&
			item.blocks.some(
				(block) =>
					block.type === "compaction" &&
					block.turnId === event.turnId &&
					(block.status === "running" || block.timestamp >= event.timestamp),
			),
	);
	if (index < 0) {
		index = next.length - 1;
		if (next[index]?.kind !== "agent") {
			next.push(
				createConversationAgentMessage({
					id: `assistant:${event.sessionId}:${event.turnId}`,
					turnId: event.turnId,
					blocks: [],
					phase: "streaming",
				}),
			);
			index = next.length - 1;
		}
	}
	const message = next[index];
	if (message?.kind !== "agent") return messages;
	const existing = lastIndex(
		message.blocks,
		(block) =>
			block.type === "compaction" &&
			block.turnId === event.turnId &&
			(block.status === "running" || block.timestamp >= event.timestamp),
	);
	if (existing >= 0) {
		const block = message.blocks[existing];
		if (block?.type !== "compaction" || (event.type === "compaction.start" && block.status === "completed"))
			return messages;
		next[index] = {
			...message,
			blocks: message.blocks.map((item, i) =>
				i === existing
					? {
							...block,
							status: event.type === "compaction.start" ? "running" : event.success ? "completed" : "failed",
							timestamp: event.timestamp,
							errorMessage: event.type === "compaction.end" && !event.success ? event.errorMessage : undefined,
						}
					: item,
			),
		};
	} else {
		next[index] = {
			...message,
			blocks: [
				...message.blocks,
				{
					type: "compaction",
					id: `compaction:${event.eventId}`,
					turnId: event.turnId,
					status: event.type === "compaction.start" ? "running" : event.success ? "completed" : "failed",
					timestamp: event.timestamp,
					errorMessage: event.type === "compaction.end" && !event.success ? event.errorMessage : undefined,
				},
			],
		};
	}
	return next;
}
