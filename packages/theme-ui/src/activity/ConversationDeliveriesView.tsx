import { Button } from "@vetta-org/ui";
import { useEffect, useRef, useState } from "react";
import { FadingScrollArea } from "../chat/FadingScrollArea";
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
	readonly onCopy: (id: string) => void | Promise<void>;
	readonly onRetry: () => void;
}) {
	const [filter, setFilter] = useState<"all" | DeliveryViewItem["kind"]>("all");
	const filtered = filter === "all" ? items : items.filter((item) => item.kind === filter);
	return (
		<section className="flex h-full min-h-0 flex-col" aria-label={labels.title}>
			<header className="shrink-0 border-b border-border/50 px-4 pb-3 pt-4">
				<h2 className="text-[14px] font-semibold">{labels.title}</h2>
				<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{labels.description}</p>
				<fieldset className="mt-3 flex min-w-0 flex-wrap gap-1 border-0 p-0" aria-label={labels.title}>
					{(["all", "file", "url", "image"] as const).map((kind) => {
						const count = kind === "all" ? items.length : items.filter((item) => item.kind === kind).length;
						return (
							<Button
								key={kind}
								size="xs"
								variant={filter === kind ? "secondary" : "ghost"}
								aria-pressed={filter === kind}
								className={count === 0 && filter !== kind ? "text-muted-foreground/50" : undefined}
								onClick={() => setFilter(kind)}
							>
								{labels.filters[kind]} · {count}
							</Button>
						);
					})}
				</fieldset>
			</header>
			<FadingScrollArea className="px-3 py-3" aria-label={labels.filters[filter]}>
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
					<ul className="space-y-2">
						{filtered.map((item) => (
							<li
								key={item.id}
								className="min-w-0 rounded-xl border border-border/40 bg-card/40 p-2 transition-colors hover:border-border/80 hover:bg-card/60 focus-within:border-border/80"
							>
								<ResourceMenu
									kind={item.kind === "url" || /^https?:\/\//i.test(item.target) ? "url" : "file"}
									target={item.target}
									open={() => onOpen(item.id)}
									labels={labels.resources}
								>
									<Button
										variant="ghost"
										className="h-auto min-h-8 w-full min-w-0 justify-start gap-2 px-2 py-1 text-left"
										onClick={() => onOpen(item.id)}
										title={item.target}
									>
										<span
											aria-hidden
											className={`${item.kind === "url" ? "icon-[solar--global-linear]" : item.kind === "image" ? "icon-[solar--gallery-linear]" : "icon-[solar--document-linear]"} h-4 w-4 shrink-0 text-muted-foreground`}
										/>
										<span className="line-clamp-2 min-w-0 break-all text-[13px] font-medium">
											{item.label}
										</span>
										<span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">
											{labels.open} <span aria-hidden>↗</span>
										</span>
									</Button>
								</ResourceMenu>
								<p
									className="mt-0.5 truncate pl-8 pr-2 font-mono text-[11px] text-muted-foreground"
									title={item.target}
								>
									{item.target}
								</p>
								<div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pl-8 pr-2">
									<span className="text-[11px] text-muted-foreground">{item.evidenceLabel}</span>
									<div className="flex items-center gap-1">
										<DeliveryCopyButton item={item} labels={labels.resources} onCopy={onCopy} />
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
			</FadingScrollArea>
		</section>
	);
}

function DeliveryCopyButton({
	item,
	labels,
	onCopy,
}: {
	readonly item: DeliveryViewItem;
	readonly labels: MarkdownLabels;
	readonly onCopy: (id: string) => void | Promise<void>;
}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const version = useRef(0);
	useEffect(() => {
		version.current++;
		setCopied(false);
		return () => {
			version.current++;
			clearTimeout(timer.current);
		};
	}, [item.id, item.target]);
	const copy = () => {
		const attempt = ++version.current;
		clearTimeout(timer.current);
		setCopied(false);
		void Promise.resolve()
			.then(() => onCopy(item.id))
			.then(() => {
				if (version.current !== attempt) return;
				setCopied(true);
				timer.current = setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {
				if (version.current === attempt) setCopied(false);
			});
	};
	const label =
		item.kind === "url" || /^https?:\/\//i.test(item.target) ? labels.resources?.copyUrl : labels.resources?.copyFile;
	return (
		<Button variant="ghost" size="xs" className="min-w-16" onClick={copy}>
			<span aria-live="polite">{copied ? labels.copied : (label ?? labels.copy)}</span>
		</Button>
	);
}
