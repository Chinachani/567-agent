import { cn } from "@shared/lib/utils";
import { formatTokenCount } from "@vetta-org/theme-ui/settings";
import { BarChart2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UsageTimeBucket } from "../types";

export interface UsageTimeChartProps {
	buckets: UsageTimeBucket[];
	className?: string;
}

export function UsageTimeChart({
	buckets,
	className,
}: UsageTimeChartProps): JSX.Element {
	const { t } = useTranslation("settings");
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

	const maxTokens = useMemo(() => {
		let max = 0;
		for (const b of buckets) {
			if (b.tokens > max) max = b.tokens;
		}
		return Math.max(1, max);
	}, [buckets]);

	const totalTokensInBuckets = useMemo(() => {
		return buckets.reduce((acc, b) => acc + b.tokens, 0);
	}, [buckets]);

	const totalCallsInBuckets = useMemo(() => {
		return buckets.reduce((acc, b) => acc + b.calls, 0);
	}, [buckets]);

	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm",
				className,
			)}
		>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
				<div>
					<div className="flex items-center gap-1.5">
						<BarChart2 className="h-4 w-4 text-primary" />
						<h2 className="text-sm font-semibold text-foreground">
							{t("usageLog.chart.title")}
						</h2>
					</div>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						{t("usageLog.chart.subtitle")}
					</p>
				</div>

				{buckets.length > 0 && (
					<div className="flex items-center gap-4 text-xs font-mono">
						<div className="flex items-center gap-1.5">
							<span className="h-2 w-2 rounded-full bg-primary" />
							<span className="text-muted-foreground">
								{t("usageLog.chart.tokens")}:
							</span>
							<span className="font-semibold text-foreground tabular-nums">
								{formatTokenCount(totalTokensInBuckets)}
							</span>
						</div>
						<div className="flex items-center gap-1.5">
							<span className="h-2 w-2 rounded-full bg-muted-foreground/60" />
							<span className="text-muted-foreground">
								{t("usageLog.chart.calls")}:
							</span>
							<span className="font-semibold text-foreground tabular-nums">
								{totalCallsInBuckets}
							</span>
						</div>
					</div>
				)}
			</div>

			{buckets.length === 0 ? (
				<div className="flex h-36 flex-col items-center justify-center text-center text-muted-foreground">
					<span className="icon-[solar--chart-square-linear] h-8 w-8 opacity-30 mb-1" />
					<p className="text-xs">{t("usageLog.chart.noData")}</p>
				</div>
			) : (
				<div className="relative pt-2">
					{/* 悬停信息悬浮卡 */}
					{hoveredIndex !== null && buckets[hoveredIndex] && (
						<div className="absolute right-2 top-0 z-10 flex items-center gap-3 rounded-lg border border-border/80 bg-popover px-2.5 py-1 text-[11px] shadow-sm">
							<span className="font-semibold text-foreground">
								{buckets[hoveredIndex].label}
							</span>
							<span className="text-primary font-mono tabular-nums">
								{formatTokenCount(buckets[hoveredIndex].tokens)} tokens
							</span>
							<span className="text-muted-foreground font-mono tabular-nums">
								{buckets[hoveredIndex].calls} {t("usageLog.chart.calls")}
							</span>
						</div>
					)}

					{/* 柱状图容器 */}
					<div className="flex h-36 items-end gap-1.5 sm:gap-2">
						{buckets.map((b, idx) => {
							const heightPct = Math.max(
								4,
								Math.round((b.tokens / maxTokens) * 100),
							);
							const isHovered = hoveredIndex === idx;

							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: bar tooltip hover
								<div
									key={b.timestamp}
									className="group relative flex flex-1 flex-col items-center h-full justify-end"
									onMouseEnter={() => setHoveredIndex(idx)}
									onMouseLeave={() =>
										setHoveredIndex((prev) => (prev === idx ? null : prev))
									}
								>
									<div
										className={cn(
											"w-full rounded-t transition-all duration-200",
											isHovered
												? "bg-primary"
												: "bg-primary/70 group-hover:bg-primary/90",
										)}
										style={{ height: `${heightPct}%` }}
									/>
									<span className="mt-1.5 block w-full truncate text-center text-[10px] text-muted-foreground/80 font-mono">
										{b.label}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
