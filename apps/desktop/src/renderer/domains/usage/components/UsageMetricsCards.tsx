import { Api567BilledUsage } from "@domains/api567/components/Api567BilledUsage";
import { cn } from "@shared/lib/utils";
import { formatTokenCount } from "@vetta-org/theme-ui/settings";
import { Activity, Clock, Sparkles, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UsageMetricsSummary } from "../types";

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

	const formattedTotalTokens = metrics.totalTokens > 0 ? formatTokenCount(metrics.totalTokens) : "—";

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{/* 567 API 账户实扣卡片（独立核算卡） */}
			<Api567BilledUsage />

			{/* 统一核心指标卡片网格 */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{/* 总消耗 Token */}
				<div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-3.5">
					<div className="flex items-center justify-between text-muted-foreground">
						<span className="text-xs font-medium">{t("usageLog.metrics.totalTokens")}</span>
						<Zap className="h-3.5 w-3.5 text-primary" />
					</div>
					<div className="mt-2">
						<div className="text-[20px] font-bold tracking-tight text-foreground tabular-nums">
							{formattedTotalTokens}
						</div>
					</div>
				</div>

				{/* 总调用次数与成功率 */}
				<div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-3.5">
					<div className="flex items-center justify-between text-muted-foreground">
						<span className="text-xs font-medium">{t("usageLog.metrics.totalCalls")}</span>
						<Activity className="h-3.5 w-3.5 text-primary" />
					</div>
					<div className="mt-2">
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
						<div className="mt-2 flex items-center justify-between border-t border-border/30 pt-1.5 text-[10px] text-muted-foreground">
							<span>{t("usageLog.metrics.successRate")}</span>
							<span className="font-semibold text-foreground font-mono tabular-nums">
								{formattedSuccessRate}
							</span>
						</div>
					</div>
				</div>

				{/* 缓存命中率 */}
				<div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-3.5">
					<div className="flex items-center justify-between text-muted-foreground">
						<span className="text-xs font-medium">{t("usageLog.metrics.cacheHitRate")}</span>
						<Sparkles className="h-3.5 w-3.5 text-chat-accent" />
					</div>
					<div className="mt-2">
						<div className="text-[20px] font-bold tracking-tight text-foreground tabular-nums">
							{formattedHitRate}
						</div>
						<p className="mt-2 border-t border-border/30 pt-1.5 text-[10px] text-muted-foreground truncate">
							{t("usageLog.metrics.contextReused")}
						</p>
					</div>
				</div>

				{/* 平均响应耗时与首字延迟 */}
				<div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-3.5">
					<div className="flex items-center justify-between text-muted-foreground">
						<span className="text-xs font-medium">{t("usageLog.metrics.averageDuration")}</span>
						<Clock className="h-3.5 w-3.5 text-muted-foreground" />
					</div>
					<div className="mt-2">
						<div className="text-[20px] font-bold tracking-tight text-foreground tabular-nums">
							{formattedDuration}
						</div>
						<div className="mt-2 flex items-center justify-between border-t border-border/30 pt-1.5 text-[10px] text-muted-foreground">
							<span>{t("usageLog.metrics.firstTextDelay")}</span>
							<span className="font-semibold text-foreground font-mono tabular-nums">{formattedFirstText}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
