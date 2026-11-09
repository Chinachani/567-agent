import { AIStreamProtocolError } from "../../protocol/index.js";
import type { Api, Model } from "../../types.js";

interface ReasoningItemState {
	readonly kind: "reasoning";
	readonly blockIndex: number;
	readonly outputIndex: number;
	readonly itemId?: string;
}

interface MessageItemState {
	readonly kind: "message";
	readonly blockIndex: number;
	readonly outputIndex: number;
	readonly itemId?: string;
}

interface ToolItemState {
	readonly kind: "function_call";
	readonly blockIndex: number;
	readonly outputIndex: number;
	readonly itemId?: string;
	partialJson: string;
}

export type ItemState = ReasoningItemState | MessageItemState | ToolItemState;

type PendingItemState =
	| Omit<ReasoningItemState, "outputIndex" | "itemId">
	| Omit<MessageItemState, "outputIndex" | "itemId">
	| Omit<ToolItemState, "outputIndex" | "itemId">;

interface ResponsesItemEvent {
	readonly type: string;
	readonly output_index?: number;
	readonly item_id?: string;
	readonly item?: { readonly id?: string };
}

export class ResponsesItemTracker<TApi extends Api> {
	private readonly byOutputIndex = new Map<number, Set<ItemState>>();
	private readonly active = new Set<ItemState>();
	private readonly seenIds = new Set<string>();
	private readonly byItemId = new Map<string, ItemState>();
	private nextFallbackOutputIndex = -1;

	constructor(private readonly model: Model<TApi>) {}

	get size(): number {
		return this.active.size;
	}

	get items(): readonly ItemState[] {
		return [...this.active];
	}

	get outputIndexes(): readonly number[] {
		return [...this.byOutputIndex.keys()];
	}

	add(event: ResponsesItemEvent, pending: PendingItemState): void {
		const outputIndex = this.allocateOutputIndex(event.output_index);
		const itemId = readItemId(event);
		const existing = this.byOutputIndex.get(outputIndex);
		// Ollama 0.40.2 can reuse the text index for a tool before closing text.
		// Only distinct, explicit IDs make that collision safe to disambiguate.
		const ollama = this.model.provider === "ollama";
		if (
			(existing && (!ollama || !itemId || [...existing].some((state) => !state.itemId))) ||
			(itemId !== undefined && (ollama ? this.seenIds.has(itemId) : this.byItemId.has(itemId)))
		) {
			throw protocolError(this.model, "Provider added the same output item more than once", { outputIndex, itemId });
		}
		const state = { ...pending, outputIndex, ...(itemId === undefined ? {} : { itemId }) } as ItemState;
		const indexed = existing ?? new Set<ItemState>();
		indexed.add(state);
		this.byOutputIndex.set(outputIndex, indexed);
		this.active.add(state);
		if (itemId !== undefined) {
			this.byItemId.set(itemId, state);
			this.seenIds.add(itemId);
		}
	}

	require<TKind extends ItemState["kind"]>(
		event: ResponsesItemEvent,
		kind: TKind,
	): Extract<ItemState, { kind: TKind }> {
		const state = this.resolve(event, kind);
		if (state.kind !== kind) {
			throw protocolError(this.model, `${event.type} targeted the wrong output item`, {
				outputIndex: state.outputIndex,
				itemId: state.itemId,
				expected: kind,
				actual: state.kind,
			});
		}
		return state as Extract<ItemState, { kind: TKind }>;
	}

	take(event: ResponsesItemEvent): ItemState {
		const state = this.resolve(event);
		const indexed = this.byOutputIndex.get(state.outputIndex);
		indexed?.delete(state);
		if (indexed?.size === 0) this.byOutputIndex.delete(state.outputIndex);
		this.active.delete(state);
		if (state.itemId !== undefined) this.byItemId.delete(state.itemId);
		return state;
	}

	private resolve(event: ResponsesItemEvent, expectedKind?: ItemState["kind"]): ItemState {
		const itemId = readItemId(event);
		const byId = itemId === undefined ? undefined : this.byItemId.get(itemId);
		if (this.model.provider === "ollama" && itemId !== undefined) {
			if (byId) return byId;
			throw protocolError(this.model, `${event.type} targeted an unknown or closed output item`, { itemId });
		}
		const indexed = typeof event.output_index === "number" ? this.byOutputIndex.get(event.output_index) : undefined;
		if (indexed && indexed.size > 1) {
			throw protocolError(this.model, `${event.type} did not unambiguously identify an output item`, {
				outputIndex: event.output_index,
			});
		}
		const byIndex = indexed?.values().next().value;
		if (byId && byIndex && byId !== byIndex) {
			throw protocolError(this.model, `${event.type} identified conflicting output items`, {
				outputIndex: event.output_index,
				itemId,
			});
		}
		const identified = byId ?? byIndex;
		if (identified) return identified;
		if (itemId !== undefined || typeof event.output_index === "number") {
			throw protocolError(this.model, `${event.type} arrived before response.output_item.added`, {
				outputIndex: event.output_index,
				itemId,
			});
		}

		const candidates = [...this.active].filter((state) => expectedKind === undefined || state.kind === expectedKind);
		if (candidates.length === 1) return candidates[0]!;
		throw protocolError(
			this.model,
			candidates.length === 0
				? `${event.type} arrived before response.output_item.added`
				: `${event.type} did not unambiguously identify an output item`,
			{ expected: expectedKind, activeOutputIndexes: this.outputIndexes },
		);
	}

	private allocateOutputIndex(explicit: number | undefined): number {
		if (explicit !== undefined) return explicit;
		return this.nextFallbackOutputIndex--;
	}
}

function readItemId(event: ResponsesItemEvent): string | undefined {
	if (typeof event.item_id === "string" && event.item_id.length > 0) return event.item_id;
	return typeof event.item?.id === "string" && event.item.id.length > 0 ? event.item.id : undefined;
}

export function protocolError<TApi extends Api>(
	model: Model<TApi>,
	message: string,
	metadata?: Readonly<Record<string, unknown>>,
): AIStreamProtocolError {
	return new AIStreamProtocolError(message, {
		provider: model.provider,
		modelId: model.id,
		metadata,
	});
}
