import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { formatTokenCount } from "@vetta-org/theme-ui/settings";
import { Cpu, Layers, MessageSquare, PieChart } from "lucide-react";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UNASSIGNED_GROUP_KEY } from "../hooks/useUsageLogData";
import type {
	GroupUsageSummary,
	ModelUsageSummary,
	SessionUsageSummary,
	TokenCompositionSummary,
} from "../types";
import {
	USAGE_DISTRIBUTION_SERIES,
	USAGE_TOKEN_SEGMENT_COLORS,
	usageAccentTextStyle,
	usageBadgeStyle,
} from "../usage-palette";

interface DistributionRowItem {
	key: string;
	label: string;
	totalTokens: number;
	percentage: number;
}

const DISTRIBUTION_TABS = [
	{ value: "model", icon: Cpu, label: "usageLog.breakdown.modelDistributionTitle" },
	{ value: "group", icon: Layers, label: "usageLog.breakdown.groupDistributionTitle" },
	{ value: "session", icon: MessageSquare, label: "usageLog.breakdown.sessionDistributionTitle" },
] as const;

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
	const [distributionTab, setDistributionTab] = useState("model");

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
			color: USAGE_TOKEN_SEGMENT_COLORS.prompt,
			reported: reported.input,
		},
		{
			label: t("usageLog.breakdown.completion"),
			count: completionTokens,
			pct: completionPercentage,
			color: USAGE_TOKEN_SEGMENT_COLORS.completion,
			reported: reported.output,
		},
		{
			label: t("usageLog.breakdown.cacheRead"),
			count: cacheReadTokens,
			pct: cacheReadPercentage,
			color: USAGE_TOKEN_SEGMENT_COLORS.cacheRead,
			reported: reported.cacheRead,
		},
		{
			label: t("usageLog.breakdown.cacheWrite"),
			count: cacheWriteTokens,
			pct: cacheWritePercentage,
			color: USAGE_TOKEN_SEGMENT_COLORS.cacheWrite,
			reported: reported.cacheWrite,
		},
	];

	const distributionItems: DistributionRowItem[] =
		distributionTab === "model"
			? modelBreakdown.map((m) => ({
					key: m.model,
					label: m.model,
					totalTokens: m.totalTokens,
					percentage: m.percentage,
				}))
			: distributionTab === "group"
				? groupBreakdown.map((g) => ({
						key: g.group,
						label:
							g.group === UNASSIGNED_GROUP_KEY
								? t("usageLog.filters.unassignedGroup")
								: g.group,
						totalTokens: g.totalTokens,
						percentage: g.percentage,
					}))
				: sessionBreakdown.map((s) => ({
						key: s.sessionId,
						label: s.sessionName,
						totalTokens: s.totalTokens,
						percentage: s.percentage,
					}));

	const emptyIconClass =
		distributionTab === "model"
			? "icon-[solar--chart-square-linear]"
			: distributionTab === "group"
				? "icon-[solar--layers-minimalistic-linear]"
				: "icon-[solar--chat-line-linear]";
	const emptyLabel =
		distributionTab === "model"
			? t("usageLog.breakdown.noModels")
			: distributionTab === "group"
				? t("usageLog.breakdown.noGroups")
				: t("usageLog.breakdown.noSessions");

	return (
		<div className={cn("grid grid-cols-1 gap-3 @3xl:grid-cols-2", className)}>
			{/* 消耗构成及百分比 */}
			<div className="flex min-w-0 flex-col justify-between rounded-xl border border-border/60 bg-card/70 p-4">
				<div>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2">
							<span
								className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
								style={usageBadgeStyle(USAGE_TOKEN_SEGMENT_COLORS.cacheWrite)}
								aria-hidden="true"
							>
								<PieChart className="h-3.5 w-3.5" />
							</span>
							<h2 className="min-w-0 whitespace-nowrap text-sm font-semibold text-foreground">
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
					<div className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted/60">
						{totalTokens > 0 ? (
							items.map((item) =>
								item.reported && item.pct > 0 ? (
									<div
										key={item.label}
										className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-300"
										style={{ width: `${item.pct}%`, backgroundColor: item.color }}
										title={`${item.label}: ${item.pct.toFixed(1)}%`}
									/>
								) : null,
							)
						) : (
							<div className="h-full w-full bg-muted/40" />
						)}
					</div>

					{/* 构成指标列表 */}
					<div className="mt-4 flex flex-col gap-2">
						{items.map((item) => (
							<div
								key={item.label}
								className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/35 px-3 py-2 text-xs"
							>
								<div className="flex min-w-0 items-center gap-2">
									<span
										className="h-2.5 w-2.5 shrink-0 rounded-full"
										style={{ backgroundColor: item.color }}
										aria-hidden="true"
									/>
									<span className="truncate font-medium text-foreground">
										{item.label}
									</span>
								</div>
								<div className="flex shrink-0 items-center gap-2.5 font-mono">
									<span className="text-muted-foreground tabular-nums">
										{item.reported
											? formatTokenCount(item.count)
											: "—"}
									</span>
									<span
										className="rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
										style={usageBadgeStyle(item.color)}
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
			<Tabs.Root
				value={distributionTab}
				onValueChange={setDistributionTab}
				className="flex min-w-0 flex-col justify-between rounded-xl border border-border/60 bg-card/70 p-4"
			>
				<div>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<Tabs.List
							aria-label={t("usageLog.breakdown.distributionTitle")}
							className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-border/50 bg-muted/45 p-0.5"
						>
							{DISTRIBUTION_TABS.map(({ value, icon: Icon, label }) => (
								<Tabs.Trigger key={value} value={value} asChild>
									<Button
										variant="ghost"
										size="xs"
										className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-border/75"
									>
										<Icon aria-hidden="true" className="h-3.5 w-3.5" />
										{t(label)}
									</Button>
								</Tabs.Trigger>
							))}
						</Tabs.List>
						<span className="text-[11px] text-muted-foreground font-mono tabular-nums">
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
					<Tabs.Content value={distributionTab} className="rounded-sm focus-visible:outline-1 focus-visible:outline-ring">
						<p className="mt-1.5 text-[11px] text-muted-foreground">
							{distributionTab === "model"
								? t("usageLog.breakdown.modelDistributionSubtitle")
								: distributionTab === "group"
									? t("usageLog.breakdown.groupDistributionSubtitle")
									: t("usageLog.breakdown.sessionDistributionSubtitle")}
						</p>

						{distributionItems.length === 0 ? (
							<div className="mt-8 flex flex-col items-center justify-center text-center text-muted-foreground">
								<span className={cn(emptyIconClass, "mb-2 h-8 w-8 opacity-30")} />
								<p className="text-xs">{emptyLabel}</p>
							</div>
						) : (
							<div className="mt-4 flex max-h-[220px] flex-col gap-2.5 overflow-y-auto pr-0.5">
								{distributionItems.map((entry, index) => {
									const barColor =
										USAGE_DISTRIBUTION_SERIES[index % USAGE_DISTRIBUTION_SERIES.length];
									return (
										<div
											key={entry.key}
											className="flex flex-col gap-1.5 rounded-lg border border-border/40 bg-muted/35 p-2.5"
										>
											<div className="flex items-center justify-between gap-3 text-xs">
												<span
													className="min-w-0 flex-1 truncate font-medium text-foreground"
													title={entry.label}
												>
													{entry.label}
												</span>
												<div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
													<span className="text-muted-foreground tabular-nums">
														{entry.totalTokens > 0
															? formatTokenCount(entry.totalTokens)
															: "—"}
													</span>
													<span
														className={cn(
															"font-semibold tabular-nums",
															entry.totalTokens === 0 && "text-muted-foreground",
														)}
														style={
															entry.totalTokens > 0
																? usageAccentTextStyle(barColor)
																: undefined
														}
													>
														{entry.totalTokens > 0
															? `${entry.percentage.toFixed(1)}%`
															: "—"}
													</span>
												</div>
											</div>
											<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
												<div
													className="h-full rounded-full transition-[width] duration-300"
													style={{
														width: `${entry.percentage}%`,
														backgroundColor: barColor,
													}}
												/>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</Tabs.Content>
				</div>
			</Tabs.Root>
		</div>
	);
}
