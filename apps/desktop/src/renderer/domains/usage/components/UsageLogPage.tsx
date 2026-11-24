import { WorkspacePageHeader } from "@vetta-org/theme-ui/shared";
import { Button } from "@shared/components/ui/button";
import { pageHeaderLeftSlotAtom, pageHeaderTitleHiddenAtom, settingsReturnHrefAtom } from "@shared/store/atoms";
import { useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUsageLogData } from "../hooks/useUsageLogData";
import { UsageCallDetailsTable } from "./UsageCallDetailsTable";
import { UsageMetricsCards } from "./UsageMetricsCards";
import { UsageTimeChart } from "./UsageTimeChart";
import { UsageTokenBreakdown } from "./UsageTokenBreakdown";

export function UsageLogPage(): JSX.Element {
	const { t } = useTranslation("settings");
	const router = useRouter();
	const returnHref = useAtomValue(settingsReturnHrefAtom) || "/";
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
		const back = t("backToWorkspace");
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
		<div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
				<WorkspacePageHeader
					title={t("usageLog.title")}
					description={t("usageLog.subtitle")}
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
					<div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-500">
						<AlertCircle className="h-4 w-4 shrink-0" />
						<span>{t("usageLog.partialNotice")}</span>
					</div>
				)}

				{/* 1. 顶部指标卡片组（包含 567 API 独立实扣卡片） */}
				<div
					role="group"
					aria-label={t("usageLog.localTimeRange")}
					className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1.5"
				>
					<span className="px-2 text-xs font-medium text-muted-foreground">{t("usageLog.localTimeRange")}</span>
					{(["today", "24h", "7d", "30d", "all"] as const).map((range) => (
						<Button
							key={range}
							size="sm"
							variant={timeRange === range ? "default" : "ghost"}
							aria-pressed={timeRange === range}
							onClick={() => setTimeRange(range)}
						>
							{t(`usageLog.timeRange.${range}`)}
						</Button>
					))}
				</div>
				<UsageMetricsCards metrics={metrics} />

				{(selectedSessionId !== "all" || selectedGroup !== "all") && (
					<section className="space-y-2 rounded-lg border border-border p-4">
						<h2 className="text-sm font-semibold">{t("usageLog.scopeShare")}</h2>
						<p className="text-lg font-semibold tabular-nums">
							{periodTokens > 0
								? new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(
										metrics.totalTokens / periodTokens,
									)
								: "—"}
						</p>
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
