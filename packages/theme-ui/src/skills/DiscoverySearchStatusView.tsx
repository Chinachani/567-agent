import { Button } from "@vetta-org/ui";

export interface DiscoverySearchStatusViewProps {
	label: string;
	description: string;
	pageLabel: string;
	running: boolean;
	canRetry: boolean;
	canPrevious: boolean;
	canNext: boolean;
	labels: { cancel: string; retry: string; previous: string; next: string };
	onCancel: () => void;
	onRetry: () => void;
	onPrevious: () => void;
	onNext: () => void;
}

/** Progress and paging remain explicit even when an incomplete scan has zero results. */
export function DiscoverySearchStatusView(props: DiscoverySearchStatusViewProps) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
			<div role="status" aria-live="polite" className="min-w-0 text-[12px]">
				<p className="font-medium text-foreground">{props.label}</p>
				<p className="mt-1 text-muted-foreground tabular-nums">{props.description}</p>
			</div>
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				{props.running && (
					<Button variant="ghost" size="sm" onClick={props.onCancel}>
						{props.labels.cancel}
					</Button>
				)}
				{props.canRetry && (
					<Button variant="outline" size="sm" onClick={props.onRetry}>
						{props.labels.retry}
					</Button>
				)}
				<span className="tabular-nums">{props.pageLabel}</span>
				<Button variant="ghost" size="sm" disabled={!props.canPrevious || props.running} onClick={props.onPrevious}>
					{props.labels.previous}
				</Button>
				<Button variant="ghost" size="sm" disabled={!props.canNext || props.running} onClick={props.onNext}>
					{props.labels.next}
				</Button>
			</div>
		</div>
	);
}
