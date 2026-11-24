import type { LocalUsageRow } from "@/shared/local-usage-log";

export type UsageTimeRange = "today" | "24h" | "7d" | "30d" | "all";

export type UsageCallRecord = LocalUsageRow;

export interface ModelUsageSummary {
	model: string;
	totalTokens: number;
	promptTokens: number;
	completionTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	calls: number;
	percentage: number;
}

export interface GroupUsageSummary {
	group: string;
	displayName: string;
	totalTokens: number;
	calls: number;
	percentage: number;
}

export interface SessionUsageSummary {
	sessionId: string;
	sessionName: string;
	totalTokens: number;
	calls: number;
	percentage: number;
}

export interface TokenCompositionSummary {
	promptTokens: number;
	completionTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	promptPercentage: number;
	completionPercentage: number;
	cacheReadPercentage: number;
	cacheWritePercentage: number;
	reported: Record<"input" | "output" | "cacheRead" | "cacheWrite", boolean>;
}

export interface UsageMetricsSummary {
	totalTokens: number;
	totalCalls: number;
	successCalls: number;
	errorCalls: number;
	abortedCalls: number;
	cacheHitRate: number | null;
	averageDurationMs: number | null;
	averageFirstTextMs: number | null;
	successRate: number;
}

export interface UsageTimeBucket {
	timestamp: number;
	label: string;
	tokens: number;
	calls: number;
}
