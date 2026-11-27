import { cn } from "@shared/lib/utils";
import { formatTokenCount } from "@vetta-org/theme-ui/settings";
import { BarChart2 } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { UsageTimeBucket } from "../types";
import {
	USAGE_PRIMARY_ACCENT,
	usageAccentTextStyle,
	usageBadgeStyle,
} from "../usage-palette";

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
	const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
	const [rovingIndex, setRovingIndex] = useState(0);
	const barRefs = useRef<Array<HTMLDivElement | null>>([]);

	const safeHovered = hoveredIndex !== null && hoveredIndex < buckets.length ? hoveredIndex : null;
	const safeFocused = focusedIndex !== null && focusedIndex < buckets.length ? focusedIndex : null;
	const activeIndex = safeHovered ?? safeFocused;
	const entryTabIndex = buckets.length > 0 ? Math.min(rovingIndex, buckets.length - 1) : 0;

	const handleBarKeyDown = (idx: number, event: KeyboardEvent<HTMLDivElement>) => {
		if (buckets.length === 0) return;
		let nextIndex: number | null = null;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") {
			nextIndex = Math.min(buckets.length - 1, idx + 1);
		} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			nextIndex = Math.max(0, idx - 1);
		} else if (event.key === "Home") {
			nextIndex = 0;
		} else if (event.key === "End") {
			nextIndex = buckets.length - 1;
		} else if (event.key === "Escape") {
			setHoveredIndex(null);
			setFocusedIndex(null);
			return;
		}
		if (nextIndex === null) return;
		event.preventDefault();
		setRovingIndex(nextIndex);
		setFocusedIndex(nextIndex);
		barRefs.current[nextIndex]?.focus();
	};

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
	const compactSinglePoint = buckets.length === 1;
	const denseSeries = buckets.length > 14;

	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border border-border/60 bg-card/70 p-4",
				className,
			)}
		>
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
							style={usageBadgeStyle(USAGE_PRIMARY_ACCENT)}
							aria-hidden="true"
						>
							<BarChart2 className="h-3.5 w-3.5" />
						</span>
						<h2 className="text-sm font-semibold text-foreground">
							{t("usageLog.chart.title")}
						</h2>
					</div>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						{t("usageLog.chart.subtitle")}
					</p>
				</div>

				{buckets.length > 0 && (
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono">
						{/* 图例仅标注实际绘制在柱状图上的 Token 系列；调用频次作为汇总指标展示 */}
						<div className="flex items-center gap-1.5">
							<span
								className="h-2.5 w-2.5 shrink-0 rounded-sm"
								style={{ backgroundColor: USAGE_PRIMARY_ACCENT }}
								aria-hidden="true"
							/>
							<span className="text-muted-foreground">
								{t("usageLog.chart.tokens")}:
							</span>
							<span className="font-semibold text-foreground tabular-nums">
								{formatTokenCount(totalTokensInBuckets)}
							</span>
						</div>
						<div className="flex items-center gap-1.5 border-l border-border/50 pl-3">
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
					{activeIndex !== null && buckets[activeIndex] && (
						<div
							aria-hidden="true"
							className="pointer-events-none absolute right-2 top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/80 bg-popover px-2.5 py-1 text-[11px] text-popover-foreground shadow-md"
						>
							<span className="font-semibold text-foreground">
								{buckets[activeIndex].label}
							</span>
							<span
								className="inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums"
								style={usageAccentTextStyle(USAGE_PRIMARY_ACCENT)}
							>
								<span
									className="h-2 w-2 rounded-sm"
									style={{ backgroundColor: USAGE_PRIMARY_ACCENT }}
									aria-hidden="true"
								/>
								{t("tokenActivity.tokens", { count: formatTokenCount(buckets[activeIndex].tokens) })}
							</span>
							<span className="text-muted-foreground font-mono tabular-nums">
								{buckets[activeIndex].calls} {t("usageLog.chart.calls")}
							</span>
						</div>
					)}

					{/* 柱状图容器与参考基线 */}
					<div className="relative overflow-x-auto pb-0.5">
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-x-0 top-0 bottom-5 flex flex-col justify-between"
						>
							<span className="border-t border-dashed border-border/35" />
							<span className="border-t border-dashed border-border/30" />
							<span className="border-t border-dashed border-border/30" />
							<span className="border-t border-border/50" />
						</div>
						<div
							role="list"
							aria-label={t("usageLog.chart.title")}
							className={cn(
								"relative flex h-40 items-end gap-1.5 sm:gap-2",
								compactSinglePoint && "justify-center",
							)}
						>
							{buckets.map((b, idx) => {
								const tokensLabel = t("tokenActivity.tokens", { count: formatTokenCount(b.tokens) });
								const heightPct = Math.max(
									4,
									Math.round((b.tokens / maxTokens) * 100),
								);
								const isActive = activeIndex === idx;
								const isDimmed = activeIndex !== null && !isActive;

								return (
									<div
										key={b.timestamp}
										ref={(el) => {
											barRefs.current[idx] = el;
										}}
										role="listitem"
										tabIndex={entryTabIndex === idx ? 0 : -1}
										aria-label={`${b.label}: ${tokensLabel}, ${b.calls} ${t("usageLog.chart.calls")}`}
										className={cn(
											"group relative flex h-full flex-col items-center justify-end rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
											compactSinglePoint
												? "w-40 flex-none"
												: denseSeries
													? "min-w-[24px] flex-1"
													: "min-w-0 flex-1",
										)}
										onMouseEnter={() => setHoveredIndex(idx)}
										onMouseLeave={() =>
											setHoveredIndex((prev) => (prev === idx ? null : prev))
										}
										onFocus={() => {
											setRovingIndex(idx);
											setFocusedIndex(idx);
										}}
										onBlur={() =>
											setFocusedIndex((prev) => (prev === idx ? null : prev))
										}
										onKeyDown={(event) => handleBarKeyDown(idx, event)}
									>
										<div className="flex w-full flex-1 items-end justify-center">
											<div
												className={cn(
													"rounded-t border-t border-chart-2/90 transition-[opacity,background-color] duration-150",
													compactSinglePoint ? "w-20" : "w-full",
													isDimmed && "opacity-55",
												)}
												style={{
													height: `${heightPct}%`,
													background: isActive
														? USAGE_PRIMARY_ACCENT
														: `linear-gradient(to top, color-mix(in srgb, ${USAGE_PRIMARY_ACCENT} 50%, transparent), color-mix(in srgb, ${USAGE_PRIMARY_ACCENT} 86%, transparent))`,
												}}
											/>
										</div>
										<span className="mt-1.5 block h-3.5 w-full truncate text-center text-[10px] text-muted-foreground font-mono">
											{b.label}
										</span>
									</div>
								);
							})}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
