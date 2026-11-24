import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { cn } from "@shared/lib/utils";
import { formatTokenCount } from "@vetta-org/theme-ui/settings";
import {
	ChevronLeft,
	ChevronRight,
	Filter,
	RotateCcw,
	Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { UNASSIGNED_GROUP_KEY } from "../hooks/useUsageLogData";
import type { UsageCallRecord } from "../types";

export interface UsageCallDetailsTableProps {
	records: UsageCallRecord[];
	availableSessions: { id: string; name: string }[];
	selectedSessionId: string;
	onSelectSession: (id: string) => void;
	availableGroups: { key: string; name: string }[];
	selectedGroup: string;
	onSelectGroup: (group: string) => void;
	availableModels: string[];
	selectedModel: string;
	onSelectModel: (model: string) => void;
	selectedStatus: "all" | "success" | "error" | "aborted";
	onSelectStatus: (status: "all" | "success" | "error" | "aborted") => void;
	searchQuery: string;
	onSearchChange: (query: string) => void;
	onResetFilters: () => void;
	totalRecordsCount: number;
	periodCount: number;
	currentPage: number;
	totalPages: number;
	onPageChange: (page: number) => void;
	className?: string;
}

export function UsageCallDetailsTable({
	records,
	availableSessions,
	selectedSessionId,
	onSelectSession,
	availableGroups,
	selectedGroup,
	onSelectGroup,
	availableModels,
	selectedModel,
	onSelectModel,
	selectedStatus,
	onSelectStatus,
	searchQuery,
	onSearchChange,
	onResetFilters,
	totalRecordsCount,
	periodCount,
	currentPage,
	totalPages,
	onPageChange,
	className,
}: UsageCallDetailsTableProps): JSX.Element {
	const { t } = useTranslation("settings");

	const isFiltered =
		selectedSessionId !== "all" ||
		selectedGroup !== "all" ||
		selectedModel !== "all" ||
		selectedStatus !== "all" ||
		searchQuery.trim().length > 0;

	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm",
				className,
			)}
		>
			{/* 头部与复合多维筛选栏 */}
			<div className="flex flex-col gap-3 border-b border-border/40 p-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<div className="flex items-center gap-1.5">
							<Filter className="h-4 w-4 text-primary" />
							<h2 className="text-sm font-semibold text-foreground">
								{t("usageLog.table.title")}
							</h2>
						</div>
						<p className="mt-0.5 text-[11px] text-muted-foreground">
							{t("usageLog.table.subtitle")}
						</p>
					</div>

					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span>
							{t("usageLog.filters.filteredCount", {
								filtered: totalRecordsCount,
								total: periodCount,
							})}
						</span>
						{isFiltered && (
							<Button
								variant="ghost"
								size="sm"
								onClick={onResetFilters}
								className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
								title={t("usageLog.filters.resetFilters")}
							>
								<RotateCcw className="h-3 w-3" />
								<span>{t("usageLog.filters.resetFilters")}</span>
							</Button>
						)}
					</div>
				</div>

				{/* 多维筛选行：会话、分组、模型、状态、搜索 */}
				<div className="flex flex-wrap items-center gap-2 pt-1">
					{/* 搜索框 */}
					<div className="relative min-w-[160px] flex-1 sm:max-w-[220px]">
						<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							type="search"
							placeholder={t("usageLog.filters.searchPlaceholder")}
							value={searchQuery}
							onChange={(e) => onSearchChange(e.target.value)}
							className="h-7 pl-8 text-xs bg-background/50 border-border/50"
						/>
					</div>

					{/* 会话筛选 */}
					{availableSessions.length > 0 && (
						<select
							value={selectedSessionId}
							onChange={(e) => onSelectSession(e.target.value)}
							className="h-7 max-w-[150px] truncate rounded-md border border-border/50 bg-background/50 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
						>
							<option value="all">{t("usageLog.filters.allSessions")}</option>
							{availableSessions.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</select>
					)}

					{/* 分组筛选 */}
					{availableGroups.length > 0 && (
						<select
							value={selectedGroup}
							onChange={(e) => onSelectGroup(e.target.value)}
							className="h-7 max-w-[140px] truncate rounded-md border border-border/50 bg-background/50 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
						>
							<option value="all">{t("usageLog.filters.allGroups")}</option>
							{availableGroups.map((g) => (
								<option key={g.key} value={g.key}>
									{g.key === UNASSIGNED_GROUP_KEY
										? t("usageLog.filters.unassignedGroup")
										: g.name}
								</option>
							))}
						</select>
					)}

					{/* 模型筛选 */}
					{availableModels.length > 0 && (
						<select
							value={selectedModel}
							onChange={(e) => onSelectModel(e.target.value)}
							className="h-7 max-w-[140px] truncate rounded-md border border-border/50 bg-background/50 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
						>
							<option value="all">{t("usageLog.filters.allModels")}</option>
							{availableModels.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</select>
					)}

					{/* 状态筛选 */}
					<select
						value={selectedStatus}
						onChange={(e) =>
							onSelectStatus(
								e.target.value as "all" | "success" | "error" | "aborted",
							)
						}
						className="h-7 rounded-md border border-border/50 bg-background/50 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					>
						<option value="all">{t("usageLog.filters.allStatus")}</option>
						<option value="success">
							{t("usageLog.filters.statusSuccess")}
						</option>
						<option value="error">{t("usageLog.filters.statusError")}</option>
						<option value="aborted">
							{t("usageLog.filters.statusAborted")}
						</option>
					</select>
				</div>
			</div>

			{/* 表格内容 */}
			<div className="overflow-x-auto">
				<table className="w-full text-left text-xs">
					<thead className="border-b border-border/30 bg-muted/20 text-[11px] font-medium text-muted-foreground">
						<tr>
							<th className="px-3.5 py-2.5">{t("usageLog.table.colTime")}</th>
							<th className="px-3 py-2.5">{t("usageLog.table.colSession")}</th>
							<th className="px-3 py-2.5">{t("usageLog.table.colGroup")}</th>
							<th className="px-3 py-2.5">{t("usageLog.table.colModel")}</th>
							<th className="px-3 py-2.5 text-right">
								{t("usageLog.table.colTotal")}
							</th>
							<th className="px-3 py-2.5 text-right">
								{t("usageLog.table.colInput")}
							</th>
							<th className="px-3 py-2.5 text-right">
								{t("usageLog.table.colOutput")}
							</th>
							<th className="px-3 py-2.5 text-right">
								{t("usageLog.table.colCacheRead")}
							</th>
							<th className="px-3 py-2.5 text-right">
								{t("usageLog.table.colDuration")}
							</th>
							<th className="px-3 py-2.5 text-right">
								{t("usageLog.table.colFirstText")}
							</th>
							<th className="px-3.5 py-2.5 text-center">
								{t("usageLog.table.colStatus")}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-border/20">
						{records.length === 0 ? (
							<tr>
								<td
									colSpan={11}
									className="py-12 text-center text-muted-foreground"
								>
									<div className="flex flex-col items-center justify-center gap-1.5">
										<span className="icon-[solar--document-text-linear] h-7 w-7 opacity-40" />
										<span className="text-xs">
											{t("usageLog.table.noRecords")}
										</span>
									</div>
								</td>
							</tr>
						) : (
							records.map((r) => {
								const hasTokens =
									r.total != null ||
									r.input != null ||
									r.output != null ||
									r.cacheRead != null ||
									r.cacheWrite != null;
								const totalTokens = hasTokens
									? (r.total ??
										(r.input ?? 0) +
											(r.output ?? 0) +
											(r.cacheRead ?? 0) +
											(r.cacheWrite ?? 0))
									: null;
								const isSuccess = r.status === "success";
								const isAborted = r.status === "aborted";

								return (
									<tr
										key={r.id}
										className="transition-colors hover:bg-muted/10 font-mono"
									>
										{/* 时间 */}
										<td className="px-3.5 py-2 text-muted-foreground font-sans text-[11px] whitespace-nowrap">
											{new Date(r.timestamp).toLocaleString(undefined, {
												month: "2-digit",
												day: "2-digit",
												hour: "2-digit",
												minute: "2-digit",
												second: "2-digit",
											})}
										</td>

										{/* 会话 */}
										<td
											className="px-3 py-2 font-sans text-foreground max-w-[120px] truncate"
											title={r.sessionName || r.sessionId || "—"}
										>
											{r.sessionName || r.sessionId || "—"}
										</td>

										{/* 分组 */}
										<td className="px-3 py-2 font-sans">
											{r.group?.trim() ? (
												<span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
													{r.group}
												</span>
											) : (
												<span className="text-muted-foreground/60">—</span>
											)}
										</td>

										{/* 模型 */}
										<td
											className="px-3 py-2 font-sans font-medium text-foreground max-w-[130px] truncate"
											title={r.model}
										>
											{r.model || "—"}
										</td>

										{/* 总 Tokens */}
										<td className="px-3 py-2 text-right font-semibold text-foreground tabular-nums">
											{totalTokens != null && totalTokens > 0 ? formatTokenCount(totalTokens) : "—"}
										</td>

										{/* 提示词 */}
										<td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
											{r.input != null ? formatTokenCount(r.input) : "—"}
										</td>

										{/* 补全 */}
										<td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
											{r.output != null ? formatTokenCount(r.output) : "—"}
										</td>

										{/* 缓存读取 */}
										<td className="px-3 py-2 text-right text-amber-500 tabular-nums">
											{r.cacheRead != null ? formatTokenCount(r.cacheRead) : "—"}
										</td>

										{/* 耗时 */}
										<td className="px-3 py-2 text-right text-muted-foreground tabular-nums whitespace-nowrap">
											{r.durationMs != null
												? `${(r.durationMs / 1000).toFixed(2)}s`
												: "—"}
										</td>

										{/* 首字延迟 */}
										<td className="px-3 py-2 text-right text-muted-foreground tabular-nums whitespace-nowrap">
											{r.firstTextMs != null
												? `${Math.round(r.firstTextMs)}ms`
												: "—"}
										</td>

										{/* 状态 */}
										<td className="px-3.5 py-2 text-center whitespace-nowrap">
											<span
												className={cn(
													"inline-block rounded px-1.5 py-0.2 text-[10px] font-medium font-sans",
													isSuccess
														? "bg-emerald-500/15 text-emerald-400"
														: isAborted
															? "bg-amber-500/15 text-amber-400"
															: "bg-destructive/15 text-destructive",
												)}
											>
												{isSuccess
													? t("usageLog.table.statusSuccess")
													: isAborted
														? t("usageLog.table.statusAborted")
														: t("usageLog.table.statusError")}
											</span>
										</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>

			{/* 分页控制栏 */}
			{totalPages > 1 && (
				<div className="flex items-center justify-between border-t border-border/30 px-4 py-2 text-xs">
					<span className="text-[11px] text-muted-foreground">
						{t("usageLog.table.pagination", {
							page: currentPage,
							total: totalPages,
						})}
					</span>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="icon-xs"
							disabled={currentPage <= 1}
							onClick={() => onPageChange(currentPage - 1)}
						>
							<ChevronLeft className="h-3.5 w-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							disabled={currentPage >= totalPages}
							onClick={() => onPageChange(currentPage + 1)}
						>
							<ChevronRight className="h-3.5 w-3.5" />
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
