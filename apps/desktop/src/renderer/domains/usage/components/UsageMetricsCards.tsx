import { cn } from "@shared/lib/utils";
import { formatTokenCount } from "@vetta-org/theme-ui/settings";
import { Activity, Clock, Sparkles, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UsageMetricsSummary } from "../types";
import {
	USAGE_PRIMARY_ACCENT,
	usageAccentTextStyle,
	usageBadgeStyle,
	usageCardTintStyle,
} from "../usage-palette";

export interface UsageMetricsCardsProps {
	metrics: UsageMetricsSummary;
	className?: string;
}

export function UsageMetricsCards({ metrics, className }: UsageMetricsCardsProps): JSX.Element {
	const { t } = useTranslation("settings");

	const formattedHitRate = metrics.cacheHitRate !== null ? `${(metrics.cacheHitRate * 100).toFixed(1)}%` : "—";

	const formattedSuccessRate = metrics.totalCalls > 0 ? `${(metrics.successRate * 100).toFixed(1)}%` : "—";

	const formattedDuration =
		metrics.averageDurationMs !== null ? `${(metrics.averageDurationMs / 1000).toFixed(2)}s` : "—";

	const formattedFirstText = metrics.averageFirstTextMs !== null ? `${Math.round(metrics.averageFirstTextMs)}ms` : "—";

	const formattedTotalTokens = formatTokenCount(metrics.totalTokens);

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{/* 统一核心指标卡片网格 */}
			<div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
				{/* 总消耗 Token（主视觉锚点卡） */}
				<div
					className="flex min-w-0 flex-col rounded-xl border p-3.5"
					style={usageCardTintStyle(USAGE_PRIMARY_ACCENT)}
				>
					<div className="flex items-center justify-between gap-2 text-muted-foreground">
						<span className="min-w-0 truncate whitespace-nowrap text-xs font-medium">{t("usageLog.metrics.totalTokens")}</span>
						<span
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
							style={usageBadgeStyle(USAGE_PRIMARY_ACCENT)}
							aria-hidden="true"
						>
							<Zap className="h-3.5 w-3.5" />
						</span>
					</div>
					<div className="mt-2.5">
						<div className="text-[22px] font-bold leading-tight tracking-tight text-foreground tabular-nums">
							{formattedTotalTokens}
						</div>
					</div>
				</div>

				{/* 总调用次数与成功率 */}
				<div className="flex min-w-0 flex-col rounded-xl border border-border/50 bg-card/70 p-3.5">
					<div className="flex items-center justify-between gap-2 text-muted-foreground">
						<span className="text-xs font-medium">{t("usageLog.metrics.totalCalls")}</span>
						<span
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
							style={usageBadgeStyle("var(--context-segment-2)")}
							aria-hidden="true"
						>
							<Activity className="h-3.5 w-3.5" />
						</span>
					</div>
					<div className="mt-2.5 flex flex-1 flex-col">
						<div className="flex items-baseline gap-2">
							<span className="text-[20px] font-bold tracking-tight text-foreground tabular-nums">
								{metrics.totalCalls.toLocaleString()}
							</span>
							{metrics.totalCalls > 0 && (
								<span className="text-[10px] text-muted-foreground tabular-nums">
									{t("usageLog.metrics.successCalls", {
										count: metrics.successCalls,
									})}
								</span>
							)}
						</div>
						<div className="mt-auto flex items-center justify-between border-t border-border/35 pt-2 text-[10px] text-muted-foreground">
							<span>{t("usageLog.metrics.successRate")}</span>
							<span
								className={cn(
									"font-semibold font-mono tabular-nums",
									metrics.totalCalls === 0 && "text-foreground",
								)}
								style={
									metrics.totalCalls > 0
										? usageAccentTextStyle("var(--context-segment-3)")
										: undefined
								}
							>
								{formattedSuccessRate}
							</span>
						</div>
					</div>
				</div>

				{/* 缓存命中率 */}
				<div className="flex min-w-0 flex-col rounded-xl border border-border/50 bg-card/70 p-3.5">
					<div className="flex items-center justify-between gap-2 text-muted-foreground">
						<span className="text-xs font-medium">{t("usageLog.metrics.cacheHitRate")}</span>
						<span
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-chat-accent/15 text-chat-accent"
							aria-hidden="true"
						>
							<Sparkles className="h-3.5 w-3.5" />
						</span>
					</div>
					<div className="mt-2.5 flex flex-1 flex-col">
						<div
							className={cn(
								"text-[20px] font-bold tracking-tight tabular-nums",
								metrics.cacheHitRate !== null ? "text-chat-accent" : "text-foreground",
							)}
						>
							{formattedHitRate}
						</div>
						<p className="mt-auto border-t border-border/35 pt-2 text-[10px] text-muted-foreground truncate">
							{t("usageLog.metrics.contextReused")}
						</p>
					</div>
				</div>

				{/* 平均响应耗时与首字延迟 */}
				<div className="flex min-w-0 flex-col rounded-xl border border-border/45 bg-card/45 p-3.5">
					<div className="flex items-center justify-between gap-2 text-muted-foreground">
						<span className="text-xs font-medium">{t("usageLog.metrics.averageDuration")}</span>
						<span
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground"
							aria-hidden="true"
						>
							<Clock className="h-3.5 w-3.5" />
						</span>
					</div>
					<div className="mt-2.5 flex flex-1 flex-col">
						<div className="text-[20px] font-bold tracking-tight text-foreground tabular-nums">
							{formattedDuration}
						</div>
						<div className="mt-auto flex items-center justify-between border-t border-border/35 pt-2 text-[10px] text-muted-foreground">
							<span>{t("usageLog.metrics.firstTextDelay")}</span>
							<span className="font-semibold text-foreground font-mono tabular-nums">{formattedFirstText}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
