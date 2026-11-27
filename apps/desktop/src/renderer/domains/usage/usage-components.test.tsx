// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const labels: Record<string, string> = {
	"usageLog.metrics.totalTokens": "总消耗 Token",
	"usageLog.metrics.totalCalls": "调用总次数",
	"usageLog.metrics.cacheHitRate": "缓存命中率",
	"usageLog.metrics.averageDuration": "平均耗时",
	"usageLog.metrics.firstTextDelay": "平均首字延迟",
	"usageLog.metrics.successRate": "调用成功率",
	"usageLog.metrics.contextReused": "前缀缓存复用率",
	"usageLog.chart.title": "调用与 Token 活动趋势",
	"usageLog.chart.subtitle": "基于当前筛选范围的时间分布活动曲线",
	"usageLog.chart.tokens": "Token 消耗",
	"usageLog.chart.calls": "调用频次",
	"usageLog.chart.noData": "当前筛选范围内无活动记录",
	"usageLog.breakdown.compositionTitle": "Token 消耗构成及百分比",
	"usageLog.breakdown.distributionTitle": "用量分布",
	"usageLog.breakdown.compositionSubtitle": "说明",
	"usageLog.breakdown.total": "总计",
	"usageLog.breakdown.prompt": "提示词输入",
	"usageLog.breakdown.completion": "生成输出",
	"usageLog.breakdown.cacheRead": "缓存命中读取",
	"usageLog.breakdown.cacheWrite": "缓存写入",
	"usageLog.breakdown.modelDistributionTitle": "模型用量分布",
	"usageLog.breakdown.modelDistributionSubtitle": "模型分布说明",
	"usageLog.breakdown.groupDistributionTitle": "分组用量分布",
	"usageLog.breakdown.groupDistributionSubtitle": "分组分布说明",
	"usageLog.breakdown.sessionDistributionTitle": "会话用量分布",
	"usageLog.breakdown.sessionDistributionSubtitle": "会话分布说明",
	"usageLog.breakdown.noModels": "暂无模型分布数据",
	"usageLog.breakdown.noGroups": "暂无分组分布数据",
	"usageLog.breakdown.noSessions": "暂无会话分布数据",
	"usageLog.filters.unassignedGroup": "未分组",
	"usageLog.filters.resetFilters": "重置筛选",
	"usageLog.filters.searchPlaceholder": "搜索",
	"usageLog.filters.allSessions": "全部会话",
	"usageLog.filters.allGroups": "全部分组",
	"usageLog.filters.allModels": "全部模型",
	"usageLog.filters.allStatus": "全部状态",
	"usageLog.filters.statusSuccess": "仅成功",
	"usageLog.filters.statusError": "仅失败",
	"usageLog.filters.statusAborted": "仅中断",
	"usageLog.table.title": "调用明细日志",
	"usageLog.table.subtitle": "明细说明",
	"usageLog.table.colTime": "时间",
	"usageLog.table.colSession": "会话",
	"usageLog.table.colGroup": "分组",
	"usageLog.table.colModel": "模型",
	"usageLog.table.colTotal": "总 Tokens",
	"usageLog.table.colInput": "提示词",
	"usageLog.table.colOutput": "补全",
	"usageLog.table.colCacheRead": "缓存读取",
	"usageLog.table.colDuration": "耗时",
	"usageLog.table.colFirstText": "首字",
	"usageLog.table.colStatus": "状态",
	"usageLog.table.statusSuccess": "成功",
	"usageLog.table.statusError": "失败",
	"usageLog.table.statusAborted": "已中断",
	"usageLog.table.noRecords": "没有找到匹配的调用明细",
};

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, string | number>) => {
			if (key === "tokenActivity.tokens") return `${values?.count} tokens`;
			if (key === "usageLog.metrics.successCalls") return `${values?.count} 成功`;
			if (key === "usageLog.breakdown.modelsCount") return `${values?.count} 个模型`;
			if (key === "usageLog.breakdown.groupsCount") return `${values?.count} 个分组`;
			if (key === "usageLog.breakdown.sessionsCount") return `${values?.count} 个会话`;
			if (key === "usageLog.filters.filteredCount") return `${values?.filtered} / ${values?.total}`;
			if (key === "usageLog.table.pagination") return `第 ${values?.page} 页，共 ${values?.total} 页`;
			return labels[key] ?? key;
		},
	}),
}));

import { UsageCallDetailsTable } from "./components/UsageCallDetailsTable";
import { UsageMetricsCards } from "./components/UsageMetricsCards";
import { UsageTimeChart } from "./components/UsageTimeChart";
import { UsageTokenBreakdown } from "./components/UsageTokenBreakdown";
import { UNASSIGNED_GROUP_KEY } from "./hooks/useUsageLogData";
import { USAGE_PRIMARY_ACCENT, USAGE_TOKEN_SEGMENT_COLORS } from "./usage-palette";

describe("UsageMetricsCards", () => {
	it("visually anchors total tokens differently from secondary metric cards", () => {
		render(
			<UsageMetricsCards
				metrics={{
					totalTokens: 386_500_000,
					totalCalls: 1501,
					successCalls: 1459,
					errorCalls: 40,
					abortedCalls: 2,
					cacheHitRate: 0.9,
					averageDurationMs: 18_160,
					averageFirstTextMs: 12_572,
					successRate: 0.972,
				}}
			/>,
		);

		const totalCard = screen.getByText("总消耗 Token").closest("div.rounded-xl") as HTMLElement;
		const durationCard = screen.getByText("平均耗时").closest("div.rounded-xl") as HTMLElement;
		expect(totalCard.getAttribute("style")).toContain("--chart-2");
		expect(durationCard.getAttribute("style")).toBeNull();
		expect(screen.getByText("386.5M")).toBeTruthy();
		expect(screen.getByText("90.0%")).toBeTruthy();
	});
});

describe("UsageTimeChart", () => {
	it("matches legend swatch to actual bar series style and preserves focused tooltip across mouseleave", () => {
		const buckets = [
			{ timestamp: 1, label: "11/2", tokens: 120_000, calls: 12 },
			{ timestamp: 2, label: "11/3", tokens: 240_000, calls: 18 },
		];
		render(<UsageTimeChart buckets={buckets} />);

		const tokensLegendLabel = screen.getByText("Token 消耗:");
		const tokensLegendSwatch = tokensLegendLabel.previousElementSibling as HTMLElement;
		expect(tokensLegendSwatch.getAttribute("style")).toContain(USAGE_PRIMARY_ACCENT);

		// Calls summary does not carry a misleading series swatch
		const callsLegendLabel = screen.getByText("调用频次:");
		expect(callsLegendLabel.previousElementSibling).toBeNull();

		const bars = within(screen.getByRole("list", { name: "调用与 Token 活动趋势" })).getAllByRole("listitem");
		expect(bars).toHaveLength(2);

		// Actual bar fill references the exact same series token as the legend swatch
		const barFill = bars[0].querySelector("[style*='height']") as HTMLElement;
		expect(barFill.getAttribute("style")).toContain(USAGE_PRIMARY_ACCENT);

		fireEvent.focus(bars[1]);
		expect(screen.getByText("18 调用频次")).toBeTruthy();

		// Hovering another bar and leaving must not erase the keyboard-focused tooltip
		fireEvent.mouseEnter(bars[0]);
		expect(screen.getByText("12 调用频次")).toBeTruthy();
		fireEvent.mouseLeave(bars[0]);
		expect(screen.getByText("18 调用频次")).toBeTruthy();

		fireEvent.blur(bars[1]);
		expect(screen.queryByText("18 调用频次")).toBeNull();
	});

	it("uses a single roving tabIndex entry across dense multi-bucket series", () => {
		const buckets = Array.from({ length: 20 }, (_, i) => ({
			timestamp: i + 1,
			label: `11/${i + 1}`,
			tokens: (i + 1) * 1000,
			calls: i + 1,
		}));
		render(<UsageTimeChart buckets={buckets} />);
		const bars = screen.getAllByRole("listitem");
		expect(bars.filter((bar) => bar.tabIndex === 0)).toHaveLength(1);
		expect(bars.filter((bar) => bar.tabIndex === -1)).toHaveLength(19);

		fireEvent.focus(bars[0]);
		fireEvent.keyDown(bars[0], { key: "ArrowRight" });
		expect(document.activeElement).toBe(bars[1]);
		expect(bars[1].tabIndex).toBe(0);
		expect(bars[0].tabIndex).toBe(-1);
		expect(screen.getByText("2 调用频次")).toBeTruthy();

		fireEvent.keyDown(bars[1], { key: "ArrowLeft" });
		expect(document.activeElement).toBe(bars[0]);
		expect(screen.getByText("1 调用频次")).toBeTruthy();
	});
});

describe("UsageTokenBreakdown", () => {
	it("uses four distinct segment tokens and switches distribution tabs accessibly", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<UsageTokenBreakdown
				tokenComposition={{
					promptTokens: 400,
					completionTokens: 200,
					cacheReadTokens: 300,
					cacheWriteTokens: 100,
					totalTokens: 1000,
					promptPercentage: 40,
					completionPercentage: 20,
					cacheReadPercentage: 30,
					cacheWritePercentage: 10,
					reported: { input: true, output: true, cacheRead: true, cacheWrite: true },
				}}
				modelBreakdown={[
					{
						model: "gpt-5",
						totalTokens: 1000,
						promptTokens: 400,
						completionTokens: 200,
						cacheReadTokens: 300,
						cacheWriteTokens: 100,
						calls: 3,
						percentage: 100,
					},
				]}
				groupBreakdown={[
					{
						group: UNASSIGNED_GROUP_KEY,
						displayName: UNASSIGNED_GROUP_KEY,
						totalTokens: 1000,
						calls: 3,
						percentage: 100,
					},
				]}
				sessionBreakdown={[
					{
						sessionId: "s1",
						sessionName: "调试会话",
						totalTokens: 1000,
						calls: 3,
						percentage: 100,
					},
				]}
			/>,
		);

		const html = container.innerHTML;
		expect(html).toContain(USAGE_TOKEN_SEGMENT_COLORS.prompt);
		expect(html).toContain(USAGE_TOKEN_SEGMENT_COLORS.completion);
		expect(html).toContain(USAGE_TOKEN_SEGMENT_COLORS.cacheRead);
		expect(html).toContain(USAGE_TOKEN_SEGMENT_COLORS.cacheWrite);
		expect(screen.getByText("gpt-5")).toBeTruthy();

		const groupTab = screen.getByRole("tab", { name: "分组用量分布" });
		await user.click(screen.getByRole("tab", { name: "模型用量分布" }));
		await user.keyboard("{ArrowRight}");
		expect(groupTab.getAttribute("aria-selected")).toBe("true");
		expect(within(screen.getByRole("tabpanel", { name: "分组用量分布" })).getByText("未分组")).toBeTruthy();

		const sessionTab = screen.getByRole("tab", { name: "会话用量分布" });
		await user.click(sessionTab);
		expect(sessionTab.getAttribute("aria-selected")).toBe("true");
		expect(screen.getByText("调试会话")).toBeTruthy();
	});
});

describe("UsageCallDetailsTable", () => {
	it("renders distinct status badges and accessible pagination controls", () => {
		render(
			<UsageCallDetailsTable
				records={[
					{
						id: "r1",
						timestamp: Date.now(),
						sessionId: "s1",
						sessionName: "测试会话",
						provider: "anthropic",
						group: "主力",
						model: "claude-sonnet",
						input: 100,
						output: 50,
						cacheRead: 200,
						total: 350,
						durationMs: 1200,
						firstTextMs: 300,
						status: "success",
					},
					{
						id: "r2",
						timestamp: Date.now(),
						sessionId: "s1",
						sessionName: "测试会话",
						provider: "anthropic",
						group: "",
						model: "claude-sonnet",
						input: 50,
						output: 0,
						status: "aborted",
					},
				]}
				availableSessions={[{ id: "s1", name: "测试会话" }]}
				selectedSessionId="all"
				onSelectSession={vi.fn()}
				availableGroups={[{ key: "主力", name: "主力" }]}
				selectedGroup="all"
				onSelectGroup={vi.fn()}
				availableModels={["claude-sonnet"]}
				selectedModel="all"
				onSelectModel={vi.fn()}
				selectedStatus="all"
				onSelectStatus={vi.fn()}
				searchQuery=""
				onSearchChange={vi.fn()}
				onResetFilters={vi.fn()}
				totalRecordsCount={2}
				periodCount={2}
				currentPage={1}
				totalPages={3}
				onPageChange={vi.fn()}
			/>,
		);

		expect(screen.getByText("主力").getAttribute("style")).toContain("--context-segment-1");
		expect(screen.getByText("成功").getAttribute("style")).toContain("--context-segment-3");
		expect(screen.getByText("已中断").getAttribute("style")).toContain("--context-segment-4");
		expect(screen.getByRole("button", { name: "第 2 页，共 3 页" })).toBeTruthy();
	});
});
