import type { ContextWorkspaceSnapshot } from "../../../../shared/context-workspace";

export type ContextTurnFilter = "all" | "included" | "excluded" | "summarized";
export type EffectiveTurnStatus = "included" | "excluded" | "summarized";

export interface EvaluatedContextTurn {
	readonly turn: ContextWorkspaceSnapshot["turns"][number];
	readonly effectiveStatus: EffectiveTurnStatus;
	readonly isExcluded: boolean;
	readonly isModified: boolean;
}

export interface ContextWorkspaceSummary {
	readonly evaluatedTurns: readonly EvaluatedContextTurn[];
	readonly includedCount: number;
	readonly summarizedCount: number;
	readonly excludedCount: number;
	readonly modifiedTurnCount: number;
	readonly pinnedChanged: boolean;
	readonly exclusionChanged: boolean;
	readonly changeCount: number;
	readonly summaryWillRebuild: boolean;
}

/** Derives next-send preview counts and per-turn draft status from snapshot and pending edits. */
export function summarizeContextWorkspace(
	snapshot: ContextWorkspaceSnapshot,
	pinned: string,
	excluded: readonly string[],
): ContextWorkspaceSummary {
	const excludedDraft = new Set(excluded);
	const excludedSaved = new Set(snapshot.excludedTurnIds);
	let includedCount = 0;
	let summarizedCount = 0;
	let excludedCount = 0;
	let modifiedTurnCount = 0;
	const evaluatedTurns: EvaluatedContextTurn[] = [...snapshot.turns].reverse().map((turn) => {
		const isExcluded = excludedDraft.has(turn.id);
		const wasExcluded = excludedSaved.has(turn.id);
		const isModified = isExcluded !== wasExcluded;
		if (isModified) modifiedTurnCount++;
		const effectiveStatus: EffectiveTurnStatus = isExcluded
			? "excluded"
			: turn.status === "summarized"
				? "summarized"
				: "included";
		if (effectiveStatus === "included") includedCount++;
		else if (effectiveStatus === "summarized") summarizedCount++;
		else excludedCount++;
		return { turn, effectiveStatus, isExcluded, isModified };
	});
	const pinnedChanged = pinned !== snapshot.pinnedText;
	const exclusionChanged =
		excluded.length !== snapshot.excludedTurnIds.length || excluded.some((id) => !excludedSaved.has(id));
	return {
		evaluatedTurns,
		includedCount,
		summarizedCount,
		excludedCount,
		modifiedTurnCount,
		pinnedChanged,
		exclusionChanged,
		changeCount: modifiedTurnCount + (pinnedChanged ? 1 : 0),
		summaryWillRebuild: exclusionChanged && Boolean(snapshot.summary || snapshot.previousSummary),
	};
}

/** Filters evaluated turns by status pill and search query across text and attachments. */
export function filterEvaluatedTurns(
	turns: readonly EvaluatedContextTurn[],
	filter: ContextTurnFilter,
	query: string,
): readonly EvaluatedContextTurn[] {
	const needle = query.trim().toLocaleLowerCase();
	return turns.filter(({ turn, effectiveStatus }) => {
		if (filter !== "all" && effectiveStatus !== filter) return false;
		if (!needle) return true;
		return `${turn.text}\n${turn.attachments.join("\n")}`.toLocaleLowerCase().includes(needle);
	});
}
