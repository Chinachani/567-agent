import type { DesktopConversationRemoteHistoryMessage } from "../conversations/desktop-conversation-service.js";

// Keep the complete response below the 1 MiB transport ceiling, including its RPC envelope.
const HISTORY_PAGE_BYTES = 900_000;
type HistoryMessage = DesktopConversationRemoteHistoryMessage & { readonly truncated?: boolean };

function bytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function fitMessage(message: HistoryMessage, budget: number): HistoryMessage {
	if (bytes(message) <= budget) return message;
	let low = 0;
	let high = message.text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (bytes({ ...message, text: message.text.slice(0, mid), truncated: true }) <= budget) low = mid;
		else high = mid - 1;
	}
	return { ...message, text: message.text.slice(0, low).replace(/[\uD800-\uDBFF]$/, ""), truncated: true };
}

/** New phones follow the cursor; old phones retain their count-based pagination contract. */
export function buildRemoteHistoryPage(
	input: readonly HistoryMessage[],
	offset: number,
	limit: number,
	boundedPages: boolean,
) {
	let messages: HistoryMessage[];
	if (!boundedPages) {
		const perMessage = Math.floor((HISTORY_PAGE_BYTES - 1024) / Math.max(1, input.length));
		messages = input.map((message) => fitMessage(message, perMessage));
	} else {
		messages = [];
		let used = 1024;
		for (const message of input) {
			const size = bytes(message) + 1;
			if (used + size > HISTORY_PAGE_BYTES) {
				if (messages.length === 0) messages.push(fitMessage(message, HISTORY_PAGE_BYTES - 1024));
				break;
			}
			messages.push(message);
			used += size;
		}
	}
	const page = {
		messages,
		nextOffset: offset + messages.length,
		hasMore: messages.length < input.length || input.length === limit,
	};
	if (bytes(page) > HISTORY_PAGE_BYTES) throw new Error("Remote history metadata exceeds the response budget");
	return page;
}
