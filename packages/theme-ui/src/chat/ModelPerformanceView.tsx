export interface ModelPerformanceViewProps {
	label: string;
	rows: readonly { label: string; value: string; hint: string }[];
	note: string;
}

/** Compact, read-only metrics; the host owns measurement and localization. */
export function ModelPerformanceView({ label, rows, note }: ModelPerformanceViewProps) {
	return (
		<section aria-label={label} className="mt-3 border-t border-border/50 pt-2">
			<dl className="space-y-1.5 text-[12px]">
				{rows.map((row) => (
					<div key={row.label} className="flex items-baseline justify-between gap-3">
						<dt className="text-muted-foreground" title={row.hint}>
							{row.label}
						</dt>
						<dd className="shrink-0 font-medium tabular-nums">{row.value}</dd>
					</div>
				))}
			</dl>
			<p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
		</section>
	);
}
