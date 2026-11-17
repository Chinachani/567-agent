import { Button } from "@vetta-org/ui";
import type { JSX } from "react";

export interface TaskResultListViewProps {
	readonly hint: string;
	readonly refreshLabel: string;
	readonly onRefresh: () => void;
	readonly loading: boolean;
	readonly message?: string;
	readonly notice?: string;
	readonly openLabel: string;
	readonly rows: readonly { id: string; title: string; detail: string; unread: boolean; unreadLabel: string }[];
	readonly onOpen: (id: string) => void;
	readonly busy?: boolean;
}
export function TaskResultListView(props: TaskResultListViewProps): JSX.Element {
	return (
		<section className="space-y-3 p-4" aria-busy={props.loading}>
			<div className="flex items-start gap-2">
				<p className="flex-1 text-xs text-muted-foreground">{props.hint}</p>
				<Button size="sm" variant="ghost" disabled={props.loading} onClick={props.onRefresh}>
					{props.refreshLabel}
				</Button>
			</div>
			{props.message && (
				<p role="status" className="text-xs text-muted-foreground">
					{props.message}
				</p>
			)}
			{props.notice && <p className="text-xs text-muted-foreground">{props.notice}</p>}
			<ul className="space-y-2">
				{props.rows.map((row) => (
					<li key={row.id} className="flex items-center gap-2 rounded-lg border border-border p-3">
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">{row.title}</p>
							<p className="text-xs text-muted-foreground">
								{row.detail}
								{row.unread && ` · ${row.unreadLabel}`}
							</p>
						</div>
						<Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onOpen(row.id)}>
							{props.openLabel}
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}
