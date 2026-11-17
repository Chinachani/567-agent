import { Button } from "@vetta-org/ui";
import type { JSX } from "react";

export interface ListPaginationLabels {
	readonly previous: string;
	readonly next: string;
	readonly summary: (page: number, pages: number, total: number) => string;
}

/** A controlled paging leaf; filtering and list contents belong to its caller. */
export function ListPagination({
	page,
	pageCount,
	total,
	labels,
	onPageChange,
}: {
	readonly page: number;
	readonly pageCount: number;
	readonly total: number;
	readonly labels: ListPaginationLabels;
	readonly onPageChange: (page: number) => void;
}): JSX.Element {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
			<p role="status" aria-live="polite" className="tabular-nums">
				{labels.summary(page, pageCount, total)}
			</p>
			<div className="flex items-center gap-1">
				<Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
					{labels.previous}
				</Button>
				<Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
					{labels.next}
				</Button>
			</div>
		</div>
	);
}
