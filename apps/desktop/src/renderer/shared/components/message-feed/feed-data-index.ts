const INITIAL_FEED_INDEX = 1_000_000_000;

export interface FeedDataIndex<T> {
	readonly scope: string | null | undefined;
	readonly items: readonly T[];
	readonly firstItemIndex: number;
}

/** Keep existing rows at the same logical indices when a tail preview gains earlier history. */
export function reconcileFeedDataIndex<T>(
	previous: FeedDataIndex<T> | undefined,
	scope: string | null | undefined,
	items: readonly T[],
	getKey: ((item: T) => string | null) | undefined,
	cachedIndex?: number,
): FeedDataIndex<T> {
	if (!previous || previous.scope !== scope || !previous.items.length || !items.length || !getKey) {
		return { scope, items, firstItemIndex: cachedIndex ?? INITIAL_FEED_INDEX };
	}
	const previousFirst = getKey(previous.items[0]);
	const first = getKey(items[0]);
	if (first === previousFirst) return { ...previous, items };
	const prepended = previousFirst === null ? -1 : items.findIndex((item) => getKey(item) === previousFirst);
	if (prepended > 0 && previous.firstItemIndex >= prepended) {
		return { scope, items, firstItemIndex: previous.firstItemIndex - prepended };
	}
	const removed = first === null ? -1 : previous.items.findIndex((item) => getKey(item) === first);
	return {
		scope,
		items,
		firstItemIndex: removed > 0 ? previous.firstItemIndex + removed : (cachedIndex ?? INITIAL_FEED_INDEX),
	};
}
