import { type ConversationDelivery, collectConversationDeliveries } from "@shared/conversation/deliveries";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { atom } from "jotai";
import { selectAtom, unwrap } from "jotai/utils";
import { activeSessionAtom, type ChatConversationItem, chatMessagesAtom } from "./chat-atoms";

const identityAtom = selectAtom(
	activeSessionAtom,
	(session) => (session ? { id: session.runtimeId, cwd: session.cwd } : null),
	(left, right) => left?.id === right?.id && left?.cwd === right?.cwd,
);
// Text deltas and pending tool phases cannot change this index. Keep their frames out of parsing.
const sourceAtom = selectAtom(
	chatMessagesAtom,
	(messages): readonly ChatConversationItem[] =>
		messages.flatMap((message) => {
			if (message.kind !== "agent") return [];
			const blocks = message.blocks.filter((block) =>
				block.type === "text"
					? !["streaming", "pending"].includes(message.phase)
					: block.type === "tool_call" && block.status === "success" && !block.isError,
			);
			return blocks.length ? [{ ...message, blocks }] : [];
		}),
	(left, right) =>
		left.length === right.length &&
		left.every((item, index) => {
			const next = right[index];
			return (
				item.kind === "agent" &&
				next.kind === "agent" &&
				item.id === next.id &&
				item.entryId === next.entryId &&
				item.renderKey === next.renderKey &&
				item.turnId === next.turnId &&
				item.blocks.length === next.blocks.length &&
				item.blocks.every((block, blockIndex) => block === next.blocks[blockIndex])
			);
		}),
);
const refreshAtom = atom(0);
const indexAtom = atom(async (get, { signal }) => {
	get(refreshAtom);
	const identity = get(identityAtom);
	const messages = get(sourceAtom);
	if (!identity || messages.length === 0) return [] as readonly ConversationDelivery[];
	await waitForCommittedPaint();
	const items = new Map<string, ConversationDelivery>();
	for (let index = 0; index < messages.length; index += 20) {
		signal.throwIfAborted();
		for (const item of collectConversationDeliveries(messages.slice(index, index + 20), identity.cwd)) {
			const previous = items.get(item.id);
			items.set(item.id, previous?.evidence === "written" && item.evidence === "reference" ? previous : item);
		}
		if (index + 20 < messages.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	signal.throwIfAborted();
	return [...items.values()];
});
const EMPTY: readonly ConversationDelivery[] = [];
interface IndexState {
	readonly state: "ready" | "loading" | "failed";
	readonly data: readonly ConversationDelivery[];
}
const pending: IndexState = { state: "loading", data: EMPTY };
const settledIndexAtom = atom(async (get): Promise<IndexState> => {
	try {
		return { state: "ready", data: await get(indexAtom) };
	} catch {
		return { state: "failed", data: EMPTY };
	}
});
const indexStateAtom = unwrap(settledIndexAtom, () => pending);

/** A cancellable, cached read projection; neither history nor a second persisted task store. */
export const conversationDeliveriesAtom = atom((get) => {
	const state = get(indexStateAtom);
	return state.state === "ready" ? state.data : EMPTY;
});
export const conversationDeliveriesStateAtom = atom((get) => {
	const state = get(indexStateAtom);
	return state.state;
});
export const refreshConversationDeliveriesAtom = atom(null, (_get, set) => set(refreshAtom, (value) => value + 1));
