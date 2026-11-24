import { cn } from "@shared/lib/utils";
import { formatTokenCount } from "@vetta-org/theme-ui/settings";
import { Cpu, Layers, MessageSquare, PieChart } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UNASSIGNED_GROUP_KEY } from "../hooks/useUsageLogData";
import type {
	GroupUsageSummary,
	ModelUsageSummary,
	SessionUsageSummary,
	TokenCompositionSummary,
} from "../types";

export interface UsageTokenBreakdownProps {
	tokenComposition: TokenCompositionSummary;
	modelBreakdown: ModelUsageSummary[];
	groupBreakdown: GroupUsageSummary[];
	sessionBreakdown: SessionUsageSummary[];
	className?: string;
}

export function UsageTokenBreakdown({
	tokenComposition,
	modelBreakdown,
	groupBreakdown,
	sessionBreakdown,
	className,
}: UsageTokenBreakdownProps): JSX.Element {
	const { t } = useTranslation("settings");
	const [distributionTab, setDistributionTab] = useState<
		"model" | "group" | "session"
	>("model");

	const {
		promptTokens,
		completionTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalTokens,
		promptPercentage,
		completionPercentage,
		cacheReadPercentage,
		cacheWritePercentage,
		reported,
	} = tokenComposition;

	const items = [
		{
			label: t("usageLog.breakdown.prompt"),
			count: promptTokens,
			pct: promptPercentage,
			color: "bg-primary",
			badgeColor: "bg-primary/10 text-primary",
			reported: reported.input,
		},
		{
			label: t("usageLog.breakdown.completion"),
			count: completionTokens,
			pct: completionPercentage,
			color: "bg-emerald-500",
			badgeColor: "bg-emerald-500/10 text-emerald-400",
			reported: reported.output,
		},
		{
			label: t("usageLog.breakdown.cacheRead"),
			count: cacheReadTokens,
			pct: cacheReadPercentage,
			color: "bg-amber-500",
			badgeColor: "bg-amber-500/10 text-amber-400",
			reported: reported.cacheRead,
		},
		{
			label: t("usageLog.breakdown.cacheWrite"),
			count: cacheWriteTokens,
			pct: cacheWritePercentage,
			color: "bg-chat-accent",
			badgeColor: "bg-chat-accent/15 text-chat-accent",
			reported: reported.cacheWrite,
		},
	];

	return (
		<div className={cn("grid grid-cols-1 gap-3 md:grid-cols-2", className)}>
			{/* 消耗构成及百分比 */}
			<div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm">
				<div>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-1.5">
							<PieChart className="h-4 w-4 text-primary" />
							<h2 className="text-sm font-semibold text-foreground">
								{t("usageLog.breakdown.compositionTitle")}
							</h2>
						</div>
						<span className="text-[11px] font-mono text-muted-foreground tabular-nums">
							{t("usageLog.breakdown.total")}{" "}
							{totalTokens > 0 ? formatTokenCount(totalTokens) : "—"}
						</span>
					</div>
					<p className="mt-1 text-[11px] text-muted-foreground">
						{t("usageLog.breakdown.compositionSubtitle")}
					</p>

					{/* 复合比例进度条 */}
					<div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
						{totalTokens > 0 ? (
							items.map((item) =>
								item.reported && item.pct > 0 ? (
									<div
										key={item.label}
										className={cn(
											"h-full transition-all duration-300",
											item.color,
										)}
										style={{ width: `${item.pct}%` }}
										title={`${item.label}: ${item.pct.toFixed(1)}%`}
									/>
								) : null,
							)
						) : (
							<div className="h-full w-full bg-muted/30" />
						)}
					</div>

					{/* 构成指标列表 */}
					<div className="mt-4 flex flex-col gap-2">
						{items.map((item) => (
							<div
								key={item.label}
								className="flex items-center justify-between rounded-lg border border-border/30 bg-card/30 px-3 py-2 text-xs"
							>
								<div className="flex items-center gap-2">
									<span className={cn("h-2 w-2 rounded-full", item.color)} />
									<span className="font-medium text-foreground">
										{item.label}
									</span>
								</div>
								<div className="flex items-center gap-2.5 font-mono">
									<span className="text-muted-foreground tabular-nums">
										{item.reported
											? formatTokenCount(item.count)
											: "—"}
									</span>
									<span
										className={cn(
											"rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
											item.badgeColor,
										)}
									>
										{item.reported && totalTokens > 0
											? `${item.pct.toFixed(1)}%`
											: "—"}
									</span>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>

			{/* 模型、分组与会话用量分布 */}
			<div className="flex flex-col justify-between rounded-xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm">
				<div>
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								onClick={() => setDistributionTab("model")}
								className={cn(
									"flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors",
									distributionTab === "model"
										? "bg-primary/15 text-primary"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<Cpu className="h-3.5 w-3.5" />
								<span>{t("usageLog.breakdown.modelDistributionTitle")}</span>
							</button>
							<button
								type="button"
								onClick={() => setDistributionTab("group")}
								className={cn(
									"flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors",
									distributionTab === "group"
										? "bg-primary/15 text-primary"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<Layers className="h-3.5 w-3.5" />
								<span>{t("usageLog.breakdown.groupDistributionTitle")}</span>
							</button>
							<button
								type="button"
								onClick={() => setDistributionTab("session")}
								className={cn(
									"flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors",
									distributionTab === "session"
										? "bg-primary/15 text-primary"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<MessageSquare className="h-3.5 w-3.5" />
								<span>{t("usageLog.breakdown.sessionDistributionTitle")}</span>
							</button>
						</div>
						<span className="text-[11px] text-muted-foreground font-mono">
							{distributionTab === "model"
								? t("usageLog.breakdown.modelsCount", {
										count: modelBreakdown.length,
									})
								: distributionTab === "group"
									? t("usageLog.breakdown.groupsCount", {
											count: groupBreakdown.length,
										})
									: t("usageLog.breakdown.sessionsCount", {
											count: sessionBreakdown.length,
										})}
						</span>
					</div>
					<p className="mt-1.5 text-[11px] text-muted-foreground">
						{distributionTab === "model"
							? t("usageLog.breakdown.modelDistributionSubtitle")
							: distributionTab === "group"
								? t("usageLog.breakdown.groupDistributionSubtitle")
								: t("usageLog.breakdown.sessionDistributionSubtitle")}
					</p>

					{distributionTab === "model" ? (
						modelBreakdown.length === 0 ? (
							<div className="mt-8 flex flex-col items-center justify-center text-center text-muted-foreground">
								<span className="icon-[solar--chart-square-linear] h-8 w-8 opacity-30 mb-2" />
								<p className="text-xs">{t("usageLog.breakdown.noModels")}</p>
							</div>
						) : (
							<div className="mt-4 flex flex-col gap-2.5 overflow-y-auto max-h-[220px] pr-0.5">
								{modelBreakdown.map((m) => (
									<div
										key={m.model}
										className="flex flex-col gap-1 rounded-lg border border-border/30 bg-card/30 p-2.5"
									>
										<div className="flex items-center justify-between text-xs">
											<span
												className="font-medium text-foreground truncate max-w-[200px]"
												title={m.model}
											>
												{m.model}
											</span>
											<div className="flex items-center gap-2 font-mono text-[11px]">
												<span className="text-muted-foreground tabular-nums">
													{m.totalTokens > 0
														? formatTokenCount(m.totalTokens)
														: "—"}
												</span>
												<span className="font-semibold text-primary tabular-nums">
													{m.totalTokens > 0
														? `${m.percentage.toFixed(1)}%`
														: "—"}
												</span>
											</div>
										</div>
										<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
											<div
												className="h-full rounded-full bg-primary transition-all duration-300"
												style={{
													width: `${m.percentage}%`,
												}}
											/>
										</div>
									</div>
								))}
							</div>
						)
					) : distributionTab === "group" ? (
						groupBreakdown.length === 0 ? (
							<div className="mt-8 flex flex-col items-center justify-center text-center text-muted-foreground">
								<span className="icon-[solar--layers-minimalistic-linear] h-8 w-8 opacity-30 mb-2" />
								<p className="text-xs">{t("usageLog.breakdown.noGroups")}</p>
							</div>
						) : (
							<div className="mt-4 flex flex-col gap-2.5 overflow-y-auto max-h-[220px] pr-0.5">
								{groupBreakdown.map((g) => {
									const isUnassigned = g.group === UNASSIGNED_GROUP_KEY;
									const label = isUnassigned
										? t("usageLog.filters.unassignedGroup")
										: g.group;
									return (
										<div
											key={g.group}
											className="flex flex-col gap-1 rounded-lg border border-border/30 bg-card/30 p-2.5"
										>
											<div className="flex items-center justify-between text-xs">
												<div className="flex items-center gap-1.5 truncate max-w-[200px]">
													<span
														className="font-medium text-foreground truncate"
														title={label}
													>
														{label}
													</span>
												</div>
												<div className="flex items-center gap-2 font-mono text-[11px]">
													<span className="text-muted-foreground tabular-nums">
														{g.totalTokens > 0
															? formatTokenCount(g.totalTokens)
															: "—"}
													</span>
													<span className="font-semibold text-primary tabular-nums">
														{g.totalTokens > 0
															? `${g.percentage.toFixed(1)}%`
															: "—"}
													</span>
												</div>
											</div>
											<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
												<div
													className="h-full rounded-full bg-primary transition-all duration-300"
													style={{
														width: `${g.percentage}%`,
													}}
												/>
											</div>
										</div>
									);
								})}
							</div>
						)
					) : sessionBreakdown.length === 0 ? (
						<div className="mt-8 flex flex-col items-center justify-center text-center text-muted-foreground">
							<span className="icon-[solar--chat-line-linear] h-8 w-8 opacity-30 mb-2" />
							<p className="text-xs">{t("usageLog.breakdown.noSessions")}</p>
						</div>
					) : (
						<div className="mt-4 flex flex-col gap-2.5 overflow-y-auto max-h-[220px] pr-0.5">
							{sessionBreakdown.map((s) => {
								return (
									<div
										key={s.sessionId}
										className="flex flex-col gap-1 rounded-lg border border-border/30 bg-card/30 p-2.5"
									>
										<div className="flex items-center justify-between text-xs">
											<div className="flex items-center gap-1.5 truncate max-w-[200px]">
												<span
													className="font-medium text-foreground truncate"
													title={s.sessionName}
												>
													{s.sessionName}
												</span>
											</div>
											<div className="flex items-center gap-2 font-mono text-[11px]">
												<span className="text-muted-foreground tabular-nums">
													{s.totalTokens > 0
														? formatTokenCount(s.totalTokens)
														: "—"}
												</span>
												<span className="font-semibold text-primary tabular-nums">
													{s.totalTokens > 0
														? `${s.percentage.toFixed(1)}%`
														: "—"}
												</span>
											</div>
										</div>
										<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
											<div
												className="h-full rounded-full bg-primary transition-all duration-300"
												style={{
														width: `${s.percentage}%`,
												}}
											/>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
