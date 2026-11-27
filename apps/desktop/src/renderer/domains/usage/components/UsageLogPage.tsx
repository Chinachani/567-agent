import { WorkspacePageHeader } from "@vetta-org/theme-ui/shared";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/components/ui/button";
import { pageHeaderLeftSlotAtom, pageHeaderTitleHiddenAtom, usageReturnHrefAtom } from "@shared/store/atoms";
import { useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUsageLogData } from "../hooks/useUsageLogData";
import { USAGE_PRIMARY_ACCENT, USAGE_WARM_ACCENT, usageAccentTextStyle } from "../usage-palette";
import { UsageCallDetailsTable } from "./UsageCallDetailsTable";
import { UsageMetricsCards } from "./UsageMetricsCards";
import { UsageTimeChart } from "./UsageTimeChart";
import { UsageTokenBreakdown } from "./UsageTokenBreakdown";

export function UsageLogPage(): JSX.Element {
	const { t } = useTranslation("settings");
	const router = useRouter();
	const returnHref = useAtomValue(usageReturnHrefAtom) || "/";
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);

	const {
		loading,
		refreshing,
		loadError,
		refresh,
		isPartial,
		metrics,
		periodTokens,
		periodCount,
		tokenComposition,
		modelBreakdown,
		groupBreakdown,
		sessionBreakdown,
		timeBuckets,
		availableSessions,
		availableGroups,
		availableModels,
		timeRange,
		setTimeRange,
		selectedSessionId,
		setSelectedSessionId,
		selectedGroup,
		setSelectedGroup,
		selectedModel,
		setSelectedModel,
		selectedStatus,
		setSelectedStatus,
		searchQuery,
		setSearchQuery,
		resetFilters,
		currentPage,
		setCurrentPage,
		totalPages,
		totalRecordsCount,
		paginatedRecords,
	} = useUsageLogData();

	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	useEffect(() => {
		const back = t(returnHref.split("?")[0].startsWith("/settings") ? "usageLog.backToSettings" : "backToWorkspace");
		setHeaderLeftSlot(
			<Button
				variant="ghost"
				size="sm"
				className="gap-2"
				title={back}
				aria-label={back}
				onClick={() => router.history.push(returnHref)}
			>
				<span aria-hidden="true" className="icon-[solar--arrow-left-linear] h-4 w-4" />
				{back}
			</Button>,
		);
		return () => setHeaderLeftSlot(null);
	}, [setHeaderLeftSlot, router, returnHref, t]);

	return (
		<div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto bg-background text-foreground">
			<div className="@container mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-5 px-4 py-5 @md:px-6 @2xl:px-8">
				<WorkspacePageHeader
					title={t("usageLog.title")}
					description={selectedSessionId === "all" ? t("usageLog.subtitle") : t("usageLog.sessionScope", {
						name: availableSessions.find((entry) => entry.id === selectedSessionId)?.name ?? t("usageLog.currentSession"),
					})}
					actions={
						<Button
							variant="outline"
							size="sm"
							disabled={loading || refreshing}
							onClick={() => void refresh()}
							className="min-h-9 gap-2"
						>
							<RefreshCw aria-hidden className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
							{refreshing ? t("usageLog.refreshing") : t("usageLog.refresh")}
						</Button>
					}
				/>

				{/* 加载失败明确错误提示（区别于无数据的真空态） */}
				{loadError && (
					<div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
						<div className="flex items-center gap-2">
							<AlertCircle className="h-4 w-4 shrink-0" />
							<span>{t("usageLog.loadError")}</span>
						</div>
						<Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => void refresh()}>
							{t("usageLog.refresh")}
						</Button>
					</div>
				)}

				{/* 部分历史日志未同步提示 */}
				{isPartial && (
					<div
						className="flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3.5 py-2 text-xs"
						style={usageAccentTextStyle(USAGE_WARM_ACCENT)}
					>
						<AlertCircle className="h-4 w-4 shrink-0" />
						<span>{t("usageLog.partialNotice")}</span>
					</div>
				)}

				{/* 本机记录范围与指标 */}
				<div
					role="group"
					aria-label={t("usageLog.localTimeRange")}
					className="flex flex-wrap items-center gap-1 rounded-xl border border-border/50 bg-muted/45 p-1"
				>
					<span className="px-2 text-xs font-medium text-muted-foreground">{t("usageLog.localTimeRange")}</span>
					{(["today", "24h", "7d", "30d", "all"] as const).map((range) => {
						const active = timeRange === range;
						return (
							<Button
								key={range}
								size="sm"
								variant="ghost"
								aria-pressed={active}
								className={cn(
									active
										? "bg-card text-foreground font-semibold ring-1 ring-inset ring-border/80 hover:bg-card"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => setTimeRange(range)}
							>
								{t(`usageLog.timeRange.${range}`)}
							</Button>
						);
					})}
				</div>
				<UsageMetricsCards metrics={metrics} />

				{(selectedSessionId !== "all" || selectedGroup !== "all") && (
					<section className="space-y-2.5 rounded-xl border border-border/60 bg-card/75 p-4">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<h2 className="text-sm font-semibold text-foreground">{t("usageLog.scopeShare")}</h2>
							<p className="text-lg font-semibold tabular-nums" style={usageAccentTextStyle(USAGE_PRIMARY_ACCENT)}>
								{formatUsageShare(metrics.totalTokens, periodTokens)}
							</p>
						</div>
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
							<div
								className="h-full rounded-full transition-[width] duration-300"
								style={{
									width: `${periodTokens > 0 ? Math.min(100, Math.max(0, (metrics.totalTokens / periodTokens) * 100)) : 0}%`,
									backgroundColor: USAGE_PRIMARY_ACCENT,
								}}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							{t("usageLog.scopeShareDetail", {
								used: metrics.totalTokens.toLocaleString(),
								total: periodTokens.toLocaleString(),
							})}
						</p>
					</section>
				)}

				{/* 2. 真实时间趋势活动图 */}
				<UsageTimeChart buckets={timeBuckets} />

				{/* 3. Token 消耗构成及百分比 + 模型/分组用量分布 */}
				<UsageTokenBreakdown
					tokenComposition={tokenComposition}
					modelBreakdown={modelBreakdown}
					groupBreakdown={groupBreakdown}
					sessionBreakdown={sessionBreakdown}
				/>

				{/* 4. 可多维筛选调用明细日志 */}
				<UsageCallDetailsTable
					records={paginatedRecords}
					availableSessions={availableSessions}
					selectedSessionId={selectedSessionId}
					onSelectSession={setSelectedSessionId}
					availableGroups={availableGroups}
					selectedGroup={selectedGroup}
					onSelectGroup={setSelectedGroup}
					availableModels={availableModels}
					selectedModel={selectedModel}
					onSelectModel={setSelectedModel}
					selectedStatus={selectedStatus}
					onSelectStatus={setSelectedStatus}
					searchQuery={searchQuery}
					onSearchChange={setSearchQuery}
					onResetFilters={resetFilters}
					totalRecordsCount={totalRecordsCount}
					periodCount={periodCount}
					currentPage={currentPage}
					totalPages={totalPages}
					onPageChange={setCurrentPage}
				/>
			</div>
		</div>
	);
}

function formatUsageShare(used: number, total: number): string {
	const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
	if (total === 0 || used === 0) return percent.format(0);
	const share = used / total;
	return share < 0.001 ? `<${percent.format(0.001)}` : percent.format(share);
}
