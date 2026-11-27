import { type ConversationDelivery, collectConversationDeliveries } from "@shared/conversation/deliveries";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { type Atom, atom } from "jotai";
import { selectAtom, unwrap } from "jotai/utils";
import {
	activeSessionAtom,
	type ChatConversationItem,
	type ConversationFeedIdentity,
	chatMessageSessionAtom,
	chatMessagesAtom,
} from "./chat-atoms";

interface DeliverySource {
	scope: ConversationFeedIdentity;
	cwd: string | null;
	messages: readonly ChatConversationItem[];
}

interface IndexState {
	readonly scope: ConversationFeedIdentity | null;
	readonly state: "ready" | "loading" | "failed";
	readonly data: readonly ConversationDelivery[];
}

const EMPTY: readonly ConversationDelivery[] = [];
const emptyState: IndexState = { scope: null, state: "ready", data: EMPTY };

export function createConversationDeliveryIndex(source: Atom<DeliverySource | null>) {
	const settledSource = selectAtom(
		source,
		(snapshot) => {
			if (!snapshot) return null;
			const messages = snapshot.messages.flatMap((message) => {
				if (message.kind !== "agent") return [];
				const blocks = message.blocks.filter((block) =>
					block.type === "text"
						? !["streaming", "pending"].includes(message.phase)
						: block.type === "tool_call" && block.status === "success" && !block.isError,
				);
				return blocks.length ? [{ ...message, blocks }] : [];
			});
			return { ...snapshot, messages };
		},
		(left, right) => {
			if (!left || !right) return left === right;
			return (
				left.scope.runtimeId === right.scope.runtimeId &&
				left.scope.sessionPath === right.scope.sessionPath &&
				left.cwd === right.cwd &&
				left.messages.length === right.messages.length &&
				left.messages.every((item, index) => {
					const next = right.messages[index];
					return (
						item.id === next.id &&
						item.entryId === next.entryId &&
						item.renderKey === next.renderKey &&
						item.turnId === next.turnId &&
						item.blocks.length === next.blocks.length &&
						item.blocks.every((block, blockIndex) => block === next.blocks[blockIndex])
					);
				})
			);
		},
	);
	const refreshCount = atom(0);
	const indexAtom = atom(async (get, { signal }): Promise<IndexState> => {
		get(refreshCount);
		const snapshot = get(settledSource);
		if (!snapshot) return emptyState;
		const { scope, cwd, messages } = snapshot;
		try {
			if (messages.length === 0) return { scope, state: "ready", data: EMPTY };
			await waitForCommittedPaint();
			const items = new Map<string, ConversationDelivery>();
			for (let index = 0; index < messages.length; index += 20) {
				signal.throwIfAborted();
				for (const item of collectConversationDeliveries(messages.slice(index, index + 20), cwd)) {
					const previous = items.get(item.id);
					items.set(item.id, previous?.evidence === "written" && item.evidence === "reference" ? previous : item);
				}
				if (index + 20 < messages.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
			return { scope, state: "ready", data: [...items.values()] };
		} catch {
			return { scope, state: "failed", data: EMPTY };
		}
	});
	const unwrapped = unwrap(indexAtom);
	return {
		state: atom((get): IndexState => {
			const scope = get(settledSource)?.scope;
			if (!scope) return emptyState;
			return get(unwrapped) ?? { scope, state: "loading", data: EMPTY };
		}),
		refresh: atom(null, (_get, set) => set(refreshCount, (value) => value + 1)),
	};
}

export type ConversationDeliveryIndex = ReturnType<typeof createConversationDeliveryIndex>;

const activeSourceAtom = atom<DeliverySource | null>((get) => {
	const session = get(activeSessionAtom);
	const owner = get(chatMessageSessionAtom);
	if (!session || owner?.runtimeId !== session.runtimeId || owner.sessionPath !== session.sessionPath) return null;
	return { scope: owner, cwd: owner.cwd, messages: get(chatMessagesAtom) };
});

export const activeConversationDeliveryIndex = createConversationDeliveryIndex(activeSourceAtom);
export const emptyConversationDeliveryIndex = {
	state: atom(() => emptyState),
	refresh: atom(null, () => {}),
} satisfies ConversationDeliveryIndex;

export const conversationDeliveriesAtom = atom((get) => get(activeConversationDeliveryIndex.state).data);
