import { useState } from "react";

/** Reset on a new search/scope and clamp after removals without changing selection or drafts. */
export function useListPagination<T>(items: readonly T[], pageSize: number, scope: string) {
	const [state, setState] = useState({ scope, page: 1 });
	const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
	const page = state.scope === scope ? Math.min(state.page, pageCount) : 1;
	if (state.scope !== scope || state.page !== page) setState({ scope, page });
	return {
		page,
		pageCount,
		total: items.length,
		items: items.slice((page - 1) * pageSize, page * pageSize),
		onPageChange: (next: number) => setState({ scope, page: Math.max(1, Math.min(pageCount, next)) }),
	};
}
