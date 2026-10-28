import { Button } from "@vetta-org/ui";
import { useState } from "react";
import { ResourceMenu } from "../markdown/ResourceMenu";
import type { MarkdownLabels } from "../markdown/rich-labels";

export interface DeliveryViewItem {
	readonly id: string;
	readonly kind: "file" | "url" | "image";
	readonly target: string;
	readonly label: string;
	readonly evidenceLabel: string;
}

export function ConversationDeliveriesView({
	items,
	labels,
	onOpen,
	onSource,
	onCopy,
	onRetry,
	state,
}: {
	readonly items: readonly DeliveryViewItem[];
	readonly labels: {
		readonly title: string;
		readonly description: string;
		readonly empty: string;
		readonly source: string;
		readonly filters: Readonly<Record<"all" | "file" | "url" | "image", string>>;
		readonly noMatches: string;
		readonly resources: MarkdownLabels;
		readonly open: string;
		readonly loading: string;
		readonly failed: string;
		readonly retry: string;
	};
	readonly state: "ready" | "loading" | "failed";
	readonly onOpen: (id: string) => void;
	readonly onSource: (id: string) => void;
	readonly onCopy: (id: string) => void;
	readonly onRetry: () => void;
}) {
	const [filter, setFilter] = useState<"all" | DeliveryViewItem["kind"]>("all");
	const filtered = filter === "all" ? items : items.filter((item) => item.kind === filter);
	return (
		<section className="h-full overflow-y-auto p-4" aria-label={labels.title}>
			<h2 className="text-[14px] font-semibold">{labels.title}</h2>
			<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{labels.description}</p>
			<fieldset className="mt-3 flex min-w-0 flex-wrap gap-1 border-0 p-0" aria-label={labels.title}>
				{(["all", "file", "url", "image"] as const).map((kind) => (
					<Button
						key={kind}
						size="xs"
						variant={filter === kind ? "secondary" : "ghost"}
						aria-pressed={filter === kind}
						onClick={() => setFilter(kind)}
					>
						{labels.filters[kind]} ·{" "}
						{kind === "all" ? items.length : items.filter((item) => item.kind === kind).length}
					</Button>
				))}
			</fieldset>
			{state === "loading" ? (
				<p className="py-8 text-[13px] text-muted-foreground">{labels.loading}</p>
			) : state === "failed" ? (
				<div className="py-8">
					<p className="mb-2 text-[13px] text-destructive">{labels.failed}</p>
					<Button size="sm" variant="outline" onClick={onRetry}>
						{labels.retry}
					</Button>
				</div>
			) : items.length === 0 ? (
				<p className="py-8 text-[13px] text-muted-foreground">{labels.empty}</p>
			) : (
				<ul className="mt-4 divide-y divide-border/50">
					{filtered.map((item) => (
						<li key={item.id} className="min-w-0 py-3">
							<ResourceMenu
								kind={item.kind === "url" || /^https?:\/\//i.test(item.target) ? "url" : "file"}
								target={item.target}
								open={() => onOpen(item.id)}
								labels={labels.resources}
							>
								<Button
									variant="ghost"
									className="h-auto min-h-9 w-full min-w-0 justify-start gap-2 px-2 text-left"
									onClick={() => onOpen(item.id)}
									title={item.target}
								>
									<span
										aria-hidden
										className={`${item.kind === "url" ? "icon-[solar--global-linear]" : item.kind === "image" ? "icon-[solar--gallery-linear]" : "icon-[solar--document-linear]"} h-4 w-4 shrink-0 text-muted-foreground`}
									/>
									<span className="line-clamp-2 min-w-0 break-all text-[13px] font-medium">{item.label}</span>
									<span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">
										{labels.open} <span aria-hidden>↗</span>
									</span>
								</Button>
							</ResourceMenu>
							<p
								className="mt-1 line-clamp-2 break-all px-2 text-[11px] text-muted-foreground"
								title={item.target}
							>
								{item.target}
							</p>
							<div className="mt-1 flex flex-wrap items-center justify-between gap-2 px-2">
								<span className="text-[11px] text-muted-foreground">{item.evidenceLabel}</span>
								<div className="flex items-center gap-1">
									<Button variant="ghost" size="xs" onClick={() => onCopy(item.id)}>
										{item.kind === "url" || /^https?:\/\//i.test(item.target)
											? labels.resources.resources?.copyUrl
											: labels.resources.resources?.copyFile}
									</Button>
									<Button variant="ghost" size="xs" onClick={() => onSource(item.id)}>
										{labels.source}
									</Button>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
			{items.length > 0 && filtered.length === 0 ? (
				<p className="py-8 text-[13px] text-muted-foreground">{labels.noMatches}</p>
			) : null}
		</section>
	);
}
