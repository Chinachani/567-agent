import { useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalUsageRow, LocalUsageSnapshot } from "@/shared/local-usage-log";
import type {
	GroupUsageSummary,
	ModelUsageSummary,
	SessionUsageSummary,
	TokenCompositionSummary,
	UsageCallRecord,
	UsageMetricsSummary,
	UsageTimeBucket,
	UsageTimeRange,
} from "../types";

const RANGE_DAYS: Record<Exclude<UsageTimeRange, "today">, number | null> = {
	"24h": 1,
	"7d": 7,
	"30d": 30,
	all: null,
};

export const UNASSIGNED_GROUP_KEY = "unassigned";
const PAGE_SIZE = 15;

function normalizeGroupParam(g?: string): string {
	if (!g) return "all";
	const trimmed = g.trim();
	if (trimmed === "all") return "all";
	if (trimmed === "unassigned" || trimmed === "__unassigned__" || trimmed === "未分组") {
		return UNASSIGNED_GROUP_KEY;
	}
	return trimmed;
}

function tokensIn(r: LocalUsageRow): number {
	return r.total ?? (r.input ?? 0) + (r.output ?? 0) + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0);
}

export function useUsageLogData() {
	const { t } = useTranslation("settings");
	const search = useSearch({ strict: false }) as { sessionId?: string; group?: string; model?: string } | undefined;

	const [rawRows, setRawRows] = useState<LocalUsageRow[]>([]);
	const rows = useMemo(
		() =>
			rawRows.map((row) => {
				if (row.sessionName.trim()) return row;
				const suffix = row.sessionId
					.split(/[/\\]/)
					.pop()
					?.replace(/\.[^.]+$/, "")
					.slice(-8);
				return { ...row, sessionName: t("usageLog.unnamedSession", { id: suffix ?? "" }) };
			}),
		[rawRows, t],
	);
	const [isPartial, setIsPartial] = useState(false);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	const [timeRange, setTimeRange] = useState<UsageTimeRange>("today");
	const [selectedSessionId, setSelectedSessionId] = useState<string>(search?.sessionId?.trim() || "all");
	const [selectedGroup, setSelectedGroup] = useState<string>(normalizeGroupParam(search?.group));
	const [selectedModel, setSelectedModel] = useState<string>(search?.model?.trim() || "all");
	const [selectedStatus, setSelectedStatus] = useState<"all" | "success" | "error" | "aborted">("all");
	const [searchQuery, setSearchQuery] = useState<string>("");
	const [currentPage, setCurrentPage] = useState<number>(1);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset page when filters change
	useEffect(() => {
		setCurrentPage(1);
	}, [timeRange, selectedSessionId, selectedGroup, selectedModel, selectedStatus, searchQuery]);

	// 同步路由参数（当用户通过新参数进入或侧边切换时更新初始筛选）
	useEffect(() => {
		setSelectedSessionId(search?.sessionId?.trim() || "all");
		setSelectedGroup(normalizeGroupParam(search?.group));
		setSelectedModel(search?.model?.trim() || "all");
	}, [search?.sessionId, search?.group, search?.model]);

	// 从真实单一数据源加载日志
	const loadLogs = useCallback(async () => {
		try {
			setLoadError(null);
			const getLog = window.agent567?.api567?.getLocalUsageLog;
			if (typeof getLog === "function") {
				const snapshot: LocalUsageSnapshot = await getLog();
				setRawRows(snapshot?.rows || []);
				setIsPartial(Boolean(snapshot?.partial));
			} else {
				throw new Error("Usage log reader unavailable");
			}
		} catch (error) {
			console.error("[useUsageLogData] Failed to load local usage log:", error);
			setLoadError(error instanceof Error ? error.message : "load_failed");
			setRawRows([]);
			setIsPartial(false);
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void loadLogs();
	}, [loadLogs]);

	const handleRefresh = useCallback(async () => {
		setRefreshing(true);
		await loadLogs();
	}, [loadLogs]);

	// 可选会话列表（真实从 rows 提取）
	const availableSessions = useMemo<{ id: string; name: string }[]>(() => {
		const map = new Map<string, string>();
		for (const row of rows) {
			if (row.sessionId) {
				map.set(row.sessionId, row.sessionName || row.sessionId);
			}
		}
		return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
	}, [rows]);

	// 可选分组列表（真实从 rows 提取，缺失的明确归为未分组）
	const availableGroups = useMemo<{ key: string; name: string }[]>(() => {
		const groups = new Set<string>();
		let hasUnassigned = false;
		for (const row of rows) {
			if (row.group?.trim()) {
				groups.add(row.group);
			} else {
				hasUnassigned = true;
			}
		}
		const list = Array.from(groups).map((g) => ({ key: g, name: g }));
		if (hasUnassigned) {
			list.push({ key: UNASSIGNED_GROUP_KEY, name: UNASSIGNED_GROUP_KEY });
		}
		return list;
	}, [rows]);

	// 可选模型列表
	const availableModels = useMemo<string[]>(() => {
		const set = new Set<string>();
		for (const row of rows) {
			if (row.model?.trim()) set.add(row.model.trim());
		}
		return Array.from(set);
	}, [rows]);

	// 统一筛选逻辑：会话、分组、模型、时间、状态、搜索关键字
	const [dayStart, setDayStart] = useState(() => new Date().setHours(0, 0, 0, 0));
	useEffect(() => {
		const updateDay = () => setDayStart(new Date().setHours(0, 0, 0, 0));
		const timer = setTimeout(updateDay, Math.max(0, new Date(dayStart).setHours(24, 0, 0, 0) - Date.now()));
		window.addEventListener("focus", updateDay);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("focus", updateDay);
		};
	}, [dayStart]);

	const periodRows = useMemo(() => {
		const now = Date.now();
		const days = timeRange === "today" ? null : RANGE_DAYS[timeRange];
		const minTime = timeRange === "today" ? dayStart : days !== null ? now - days * 86_400_000 : 0;
		return rows.filter((r) => r.timestamp >= minTime);
	}, [dayStart, timeRange, rows]);
	const periodTokens = useMemo(() => periodRows.reduce((sum, row) => sum + tokensIn(row), 0), [periodRows]);
	const filteredRecords = useMemo<UsageCallRecord[]>(() => {
		const query = searchQuery.trim().toLowerCase();

		return periodRows.filter((r) => {
			// 会话过滤
			if (selectedSessionId !== "all" && r.sessionId !== selectedSessionId) {
				return false;
			}

			// 分组过滤（缺失独立归类）
			if (selectedGroup !== "all") {
				if (selectedGroup === UNASSIGNED_GROUP_KEY) {
					if (r.group?.trim()) return false;
				} else if (r.group !== selectedGroup) {
					return false;
				}
			}

			// 模型过滤
			if (selectedModel !== "all" && r.model !== selectedModel) {
				return false;
			}

			// 状态过滤
			if (selectedStatus !== "all" && r.status !== selectedStatus) {
				return false;
			}

			// 搜索关键词（匹配会话名、模型名、分组名、提供商、ID）
			if (query) {
				const matchName = r.sessionName?.toLowerCase().includes(query);
				const matchSessionId = r.sessionId?.toLowerCase().includes(query);
				const matchModel = r.model?.toLowerCase().includes(query);
				const matchGroup = r.group?.toLowerCase().includes(query);
				const matchProvider = r.provider?.toLowerCase().includes(query);
				const matchId = r.id?.toLowerCase().includes(query);
				if (!matchName && !matchSessionId && !matchModel && !matchGroup && !matchProvider && !matchId) {
					return false;
				}
			}

			return true;
		});
	}, [periodRows, selectedSessionId, selectedGroup, selectedModel, selectedStatus, searchQuery]);

	// 汇总核心指标（完全由 filteredRecords 聚合，分母范围准确）
	const metrics = useMemo<UsageMetricsSummary>(() => {
		let totalTokens = 0;
		let successCalls = 0;
		let errorCalls = 0;
		let abortedCalls = 0;
		let durationSum = 0;
		let durationCount = 0;
		let firstTextSum = 0;
		let firstTextCount = 0;

		// 缓存命中率统计：分母仅有 cacheRead 报告的行 input + cacheRead + cacheWrite
		let cacheReadSum = 0;
		let cacheDenominator = 0;
		let cacheReportedCount = 0;

		for (const r of filteredRecords) {
			const tokens = tokensIn(r);
			totalTokens += tokens;

			if (typeof r.cacheRead === "number" && !Number.isNaN(r.cacheRead)) {
				cacheReportedCount++;
				cacheReadSum += r.cacheRead;
				const rowInput = r.input ?? 0;
				const rowCacheRead = r.cacheRead ?? 0;
				const rowCacheWrite = r.cacheWrite ?? 0;
				cacheDenominator += rowInput + rowCacheRead + rowCacheWrite;
			}

			if (r.status === "success") successCalls++;
			else if (r.status === "error") errorCalls++;
			else if (r.status === "aborted") abortedCalls++;

			if (typeof r.durationMs === "number" && !Number.isNaN(r.durationMs)) {
				durationSum += r.durationMs;
				durationCount++;
			}
			if (typeof r.firstTextMs === "number" && !Number.isNaN(r.firstTextMs)) {
				firstTextSum += r.firstTextMs;
				firstTextCount++;
			}
		}

		const totalCalls = filteredRecords.length;
		const cacheHitRate = cacheReportedCount > 0 && cacheDenominator > 0 ? cacheReadSum / cacheDenominator : null;
		const successRate = totalCalls > 0 ? successCalls / totalCalls : 0;
		const averageDurationMs = durationCount > 0 ? durationSum / durationCount : null;
		const averageFirstTextMs = firstTextCount > 0 ? firstTextSum / firstTextCount : null;

		return {
			totalTokens,
			totalCalls,
			successCalls,
			errorCalls,
			abortedCalls,
			cacheHitRate,
			averageDurationMs,
			averageFirstTextMs,
			successRate,
		};
	}, [filteredRecords]);

	// Token 构成及百分比（范围分母严格基于当前筛选总量）
	const tokenComposition = useMemo<TokenCompositionSummary>(() => {
		let promptTokens = 0;
		let completionTokens = 0;
		let cacheReadTokens = 0;
		let cacheWriteTokens = 0;
		const reported = { input: false, output: false, cacheRead: false, cacheWrite: false };

		for (const r of filteredRecords) {
			promptTokens += r.input ?? 0;
			completionTokens += r.output ?? 0;
			cacheReadTokens += r.cacheRead ?? 0;
			cacheWriteTokens += r.cacheWrite ?? 0;

			reported.input ||= r.input != null;
			reported.output ||= r.output != null;
			reported.cacheRead ||= r.cacheRead != null;
			reported.cacheWrite ||= r.cacheWrite != null;
		}

		const total = promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens;
		const promptPercentage = total > 0 ? (promptTokens / total) * 100 : 0;
		const completionPercentage = total > 0 ? (completionTokens / total) * 100 : 0;
		const cacheReadPercentage = total > 0 ? (cacheReadTokens / total) * 100 : 0;
		const cacheWritePercentage = total > 0 ? (cacheWriteTokens / total) * 100 : 0;

		return {
			promptTokens,
			completionTokens,
			cacheReadTokens,
			cacheWriteTokens,
			totalTokens: total,
			promptPercentage,
			completionPercentage,
			cacheReadPercentage,
			cacheWritePercentage,
			reported,
		};
	}, [filteredRecords]);

	// 模型分布统计（分母为当前 filteredRecords 的总 Tokens）
	const modelBreakdown = useMemo<ModelUsageSummary[]>(() => {
		if (filteredRecords.length === 0) return [];
		const map = new Map<
			string,
			{
				total: number;
				prompt: number;
				completion: number;
				cacheRead: number;
				cacheWrite: number;
				calls: number;
			}
		>();
		let grandTotal = 0;

		for (const r of filteredRecords) {
			const modelName = r.model || "—";
			const tokens = tokensIn(r);
			const current = map.get(modelName) ?? {
				total: 0,
				prompt: 0,
				completion: 0,
				cacheRead: 0,
				cacheWrite: 0,
				calls: 0,
			};
			current.total += tokens;
			current.prompt += r.input ?? 0;
			current.completion += r.output ?? 0;
			current.cacheRead += r.cacheRead ?? 0;
			current.cacheWrite += r.cacheWrite ?? 0;
			current.calls += 1;
			map.set(modelName, current);
			grandTotal += tokens;
		}

		return Array.from(map.entries())
			.map(([model, data]) => ({
				model,
				totalTokens: data.total,
				promptTokens: data.prompt,
				completionTokens: data.completion,
				cacheReadTokens: data.cacheRead,
				cacheWriteTokens: data.cacheWrite,
				calls: data.calls,
				percentage: grandTotal > 0 ? (data.total / grandTotal) * 100 : 0,
			}))
			.sort((a, b) => b.totalTokens - a.totalTokens);
	}, [filteredRecords]);

	// 分组分布统计（缺失归为独立分类）
	const groupBreakdown = useMemo<GroupUsageSummary[]>(() => {
		if (filteredRecords.length === 0) return [];
		const map = new Map<string, { total: number; calls: number }>();
		let grandTotal = 0;

		for (const r of filteredRecords) {
			const groupKey = r.group?.trim() ? r.group : UNASSIGNED_GROUP_KEY;
			const tokens = tokensIn(r);
			const current = map.get(groupKey) ?? { total: 0, calls: 0 };
			current.total += tokens;
			current.calls += 1;
			map.set(groupKey, current);
			grandTotal += tokens;
		}

		return Array.from(map.entries())
			.map(([group, data]) => ({
				group,
				displayName: group === UNASSIGNED_GROUP_KEY ? "未分组" : group,
				totalTokens: data.total,
				calls: data.calls,
				percentage: grandTotal > 0 ? (data.total / grandTotal) * 100 : 0,
			}))
			.sort((a, b) => b.totalTokens - a.totalTokens);
	}, [filteredRecords]);

	// 会话分布统计（基于持久 sessionPath）
	const sessionBreakdown = useMemo<SessionUsageSummary[]>(() => {
		if (filteredRecords.length === 0) return [];
		const map = new Map<string, { sessionName: string; total: number; calls: number }>();
		let grandTotal = 0;

		for (const r of filteredRecords) {
			const sId = r.sessionId || "—";
			const tokens = tokensIn(r);
			const current = map.get(sId) ?? {
				sessionName: r.sessionName || sId,
				total: 0,
				calls: 0,
			};
			current.total += tokens;
			current.calls += 1;
			if (r.sessionName && current.sessionName === sId) {
				current.sessionName = r.sessionName;
			}
			map.set(sId, current);
			grandTotal += tokens;
		}

		return Array.from(map.entries())
			.map(([sessionId, data]) => ({
				sessionId,
				sessionName: data.sessionName,
				totalTokens: data.total,
				calls: data.calls,
				percentage: grandTotal > 0 ? (data.total / grandTotal) * 100 : 0,
			}))
			.sort((a, b) => b.totalTokens - a.totalTokens);
	}, [filteredRecords]);

	// 时间趋势桶（由当前真实 filteredRecords 构建，分桶计算绝对一致）
	const timeBuckets = useMemo<UsageTimeBucket[]>(() => {
		if (filteredRecords.length === 0) return [];

		const bucketMap = new Map<string, { timestamp: number; label: string; tokens: number; calls: number }>();
		const isHourBucket = timeRange === "24h" || timeRange === "today";

		for (const r of filteredRecords) {
			const d = new Date(r.timestamp);
			const tokens = tokensIn(r);

			let key: string;
			let label: string;
			let bucketTimestamp: number;

			if (isHourBucket) {
				key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:00`;
				label = `${d.getHours()}:00`;
				bucketTimestamp = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
			} else {
				key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
				label = `${d.getMonth() + 1}/${d.getDate()}`;
				bucketTimestamp = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
			}

			const entry = bucketMap.get(key) ?? {
				timestamp: bucketTimestamp,
				label,
				tokens: 0,
				calls: 0,
			};
			entry.tokens += tokens;
			entry.calls += 1;
			bucketMap.set(key, entry);
		}

		return Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
	}, [filteredRecords, timeRange]);

	// 排序明细（时间降序，最新在前）并分页
	const sortedRecords = useMemo(() => {
		return [...filteredRecords].sort((a, b) => b.timestamp - a.timestamp);
	}, [filteredRecords]);

	const totalRecordsCount = sortedRecords.length;
	const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
	const safePage = Math.min(currentPage, totalPages);
	const paginatedRecords = useMemo(() => {
		const start = (safePage - 1) * PAGE_SIZE;
		return sortedRecords.slice(start, start + PAGE_SIZE);
	}, [safePage, sortedRecords]);

	const resetFilters = useCallback(() => {
		setTimeRange("today");
		setSelectedSessionId("all");
		setSelectedGroup("all");
		setSelectedModel("all");
		setSelectedStatus("all");
		setSearchQuery("");
		setCurrentPage(1);
	}, []);

	return {
		loading,
		refreshing,
		loadError,
		refresh: handleRefresh,
		isPartial,
		rawRowsCount: rawRows.length,
		metrics,
		periodTokens,
		periodCount: periodRows.length,
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
		currentPage: safePage,
		setCurrentPage,
		totalPages,
		totalRecordsCount,
		filteredRecords,
		paginatedRecords,
	};
}
