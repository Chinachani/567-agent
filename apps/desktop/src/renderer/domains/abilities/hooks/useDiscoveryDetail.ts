import type { OpenMarketplaceAbility } from "@preload/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AbilityItem } from "../types";

/** Keep detail fetches local to the drawer; a late response cannot replace another row. */
export function useDiscoveryDetail(item: AbilityItem | null, open: boolean) {
	const origin = item?.origin;
	const slug = item?.slug;
	const sourceId = origin?.sourceId;
	const version = origin?.marketplaceVersion;
	const deferred = item?.market?.detailDeferred === true;
	const locator = item?.market?.discoveryReference;
	const revision = locator?.revision;
	const category = locator?.category;
	const searchPath = locator?.searchPath;
	const reference = useMemo(
		() =>
			revision !== undefined && category !== undefined && searchPath !== undefined
				? { revision, category, searchPath }
				: undefined,
		[revision, category, searchPath],
	);
	const key = `${sourceId}:${version}:${slug}:${reference?.revision}:${reference?.searchPath}`;
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<{
		key: string;
		attempt: number;
		detail?: OpenMarketplaceAbility;
		error?: boolean;
	}>({ key: "", attempt: 0 });
	const retry = useCallback(() => setAttempt((value) => value + 1), []);
	useEffect(() => {
		if (!open || !deferred || !sourceId || !slug || !version) return;
		let active = true;
		setState({ key, attempt });
		void window.agent567.abilities.getDiscoveryDetail(sourceId, slug, version, reference).then(
			(detail) => {
				if (active) setState({ key, attempt, detail });
			},
			() => {
				if (active) setState({ key, attempt, error: true });
			},
		);
		return () => {
			active = false;
		};
	}, [open, deferred, sourceId, slug, version, key, attempt, reference]);
	const detail = state.key === key && state.attempt === attempt ? state.detail : undefined;
	const error = state.key === key && state.attempt === attempt && state.error === true;
	const resolved =
		item && detail
			? {
					...item,
					description: detail.description,
					author: detail.author,
					license: detail.license,
					detail: detail.detail,
				}
			: item;
	return { item: resolved, loading: open && deferred && !detail && !error, error, retry };
}
