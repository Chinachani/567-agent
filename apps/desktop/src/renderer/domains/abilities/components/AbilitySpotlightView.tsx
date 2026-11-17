import { Button } from "@vetta-org/ui";
import type { AbilityItem } from "../types";
import { AbilityIcon } from "./AbilityIcon";

interface AbilitySpotlightViewProps {
	readonly item: Pick<AbilityItem, "title" | "description" | "icon" | "type">;
	readonly labels: { title: string; detail: string; previous: string; next: string; position: string };
	readonly canSwitch: boolean;
	readonly onPrevious: () => void;
	readonly onNext: () => void;
	readonly onDetail: () => void;
}

/** User-operated catalog preview; opening a detail never installs or grants a capability. */
export function AbilitySpotlightView({
	item,
	labels,
	canSwitch,
	onPrevious,
	onNext,
	onDetail,
}: AbilitySpotlightViewProps): JSX.Element {
	return (
		<section aria-label={labels.title} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
			<div className="mb-3 flex items-center justify-between gap-2">
				<h2 className="text-[12px] font-medium text-[var(--muted-foreground)]">{labels.title}</h2>
				{canSwitch && (
					<div className="flex items-center gap-2">
						<Button size="icon-xs" variant="ghost" aria-label={labels.previous} onClick={onPrevious}>
							<span aria-hidden className="icon-[solar--alt-arrow-left-linear] h-4 w-4" />
						</Button>
						<span className="text-[11px] text-[var(--muted-foreground)]" aria-live="polite">
							{labels.position}
						</span>
						<Button size="icon-xs" variant="ghost" aria-label={labels.next} onClick={onNext}>
							<span aria-hidden className="icon-[solar--alt-arrow-right-linear] h-4 w-4" />
						</Button>
					</div>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<AbilityIcon icon={item.icon} type={item.type} />
				<div className="min-w-0 flex-1 basis-40">
					<h3 className="truncate text-[14px] font-medium text-[var(--foreground)]">{item.title}</h3>
					<p className="mt-1 line-clamp-2 text-[12px] text-[var(--muted-foreground)]">{item.description}</p>
				</div>
				<Button size="sm" variant="field" onClick={onDetail}>
					{labels.detail}
				</Button>
			</div>
		</section>
	);
}
