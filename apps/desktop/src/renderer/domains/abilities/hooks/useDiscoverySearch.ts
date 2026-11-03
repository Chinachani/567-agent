import type { OpenMarketplaceDiscoverySearch, OpenMarketplaceSourceSnapshot } from "@preload/api";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { useEffect, useMemo, useRef, useState } from "react";
import type { McpDiscoveryQuery } from "../../../../shared/mcp-discovery";

const PAGE_SIZE = 60;
type ResultState = { key: string; results: Record<string, OpenMarketplaceDiscoverySearch>; cancelled: boolean };

/** The page holds at most one result window per source, while Main scans the entire matching range. */
export function useDiscoverySearch(
	snapshots: OpenMarketplaceSourceSnapshot[],
	query: Omit<McpDiscoveryQuery, "offset" | "limit">,
	enabled: boolean,
) {
	const sources = useMemo(
		() => snapshots.filter((snapshot) => snapshot.source.enabled && snapshot.discovery?.protocol === 2),
		[snapshots],
	);
	const sourceKey = JSON.stringify(sources.map(({ sourceId, discovery }) => [sourceId, discovery?.revision]));
	const queryKey = JSON.stringify([sourceKey, enabled, query]);
	const [page, setPage] = useState({ queryKey, offset: 0 });
	const offset = page.queryKey === queryKey ? page.offset : 0;
	const [attempt, setAttempt] = useState(0);
	const key = `${queryKey}:${offset}:${attempt}`;
	const [state, setState] = useState<ResultState>({ key: "", results: {}, cancelled: false });
	const cancelRef = useRef<() => void>(() => undefined);
	const sourceRef = useRef(sources);
	sourceRef.current = sources;
	const queryRef = useRef(query);
	queryRef.current = query;
	useEffect(() => {
		if (!enabled || !sourceRef.current.length) return;
		let active = true;
		const targets = sourceRef.current;
		const requestQuery = queryRef.current;
		const requests = targets.map((snapshot) => ({ snapshot, id: crypto.randomUUID() }));
		const initial: Record<string, OpenMarketplaceDiscoverySearch> = {};
		for (const { snapshot, id } of requests)
			initial[snapshot.sourceId] = {
				requestId: id,
				sourceId: snapshot.sourceId,
				abilities: [],
				progress: {
					revision: snapshot.discovery?.revision ?? "",
					version: snapshot.discovery?.version ?? "",
					matched: 0,
					scanned: 0,
					total: snapshot.discovery?.total ?? 0,
					running: true,
					complete: false,
					failures: [],
				},
			};
		setState({ key, results: initial, cancelled: false });
		const accept = (result: OpenMarketplaceDiscoverySearch) => {
			if (
				!active ||
				!requests.some(({ id, snapshot }) => id === result.requestId && snapshot.sourceId === result.sourceId)
			)
				return;
			setState((old) =>
				old.key === key ? { ...old, results: { ...old.results, [result.sourceId]: result } } : old,
			);
		};
		const unsubscribe = window.agent567.abilities.onDiscoverySearchUpdated(accept);
		const cancel = () => {
			active = false;
			for (const { id } of requests) void window.agent567.abilities.cancelDiscoverySearch(id).catch(() => undefined);
		};
		cancelRef.current = () => {
			cancel();
			setState((old) =>
				old.key === key
					? {
							...old,
							cancelled: true,
							results: Object.fromEntries(
								Object.entries(old.results).map(([source, result]) => [
									source,
									{ ...result, progress: { ...result.progress, running: false, complete: false } },
								]),
							),
						}
					: old,
			);
		};
		void (async () => {
			await waitForCommittedPaint();
			if (!active) return;
			await Promise.all(
				requests.map(async ({ snapshot, id }) => {
					try {
						accept(
							await window.agent567.abilities.searchDiscovery(id, snapshot.sourceId, {
								...requestQuery,
								offset,
								limit: PAGE_SIZE,
							}),
						);
					} catch {
						if (!active) return;
						setState((old) => {
							if (old.key !== key) return old;
							const previous = old.results[snapshot.sourceId];
							return {
								...old,
								results: {
									...old.results,
									[snapshot.sourceId]: {
										...previous,
										progress: {
											...previous.progress,
											running: false,
											complete: false,
											failures: [...previous.progress.failures, { path: "query", code: "network" }],
										},
									},
								},
							};
						});
					}
				}),
			);
		})();
		return () => {
			cancel();
			unsubscribe();
		};
	}, [key, enabled, offset]);
	const results = useMemo(
		() => (state.key === key && enabled ? Object.values(state.results) : []),
		[state, key, enabled],
	);
	const running =
		enabled && sources.length > 0 && (state.key !== key || results.some((result) => result.progress.running));
	return {
		sources,
		results,
		offset,
		running,
		complete: results.length > 0 && results.every((result) => result.progress.complete),
		cancelled: state.key === key && state.cancelled,
		matched: results.reduce((sum, result) => sum + result.progress.matched, 0),
		scanned: results.reduce((sum, result) => sum + result.progress.scanned, 0),
		total: results.reduce((sum, result) => sum + result.progress.total, 0),
		failed: results.reduce((sum, result) => sum + result.progress.failures.length, 0),
		hasNext: results.some((result) => result.progress.matched > offset + PAGE_SIZE),
		previous: () => setPage({ queryKey, offset: Math.max(0, offset - PAGE_SIZE) }),
		next: () => setPage({ queryKey, offset: offset + PAGE_SIZE }),
		cancel: () => cancelRef.current(),
		retry: () => setAttempt((value) => value + 1),
	};
}
