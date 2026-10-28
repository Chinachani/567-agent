import type { CodingAgentGoalState } from "@567agent/coding-agent/session-extensions";
import type { ChatConversationItem, ErrorBlock, RetryProgress, ToolCallBlock } from "@shared/store/atoms";

export type TaskPhase =
	| "preparing"
	| "question"
	| "approval"
	| "permission"
	| "retrying"
	| "compacting"
	| "connecting"
	| "tool"
	| "thinking"
	| "responding"
	| "waiting"
	| "failed"
	| "queuePaused"
	| "stopped"
	| "paused"
	| "blocked"
	| "limited"
	| "goalComplete"
	| "replyComplete";

export interface TaskProgress {
	readonly phase: TaskPhase;
	readonly running: boolean;
	readonly canContinue: boolean;
	readonly error?: ErrorBlock;
	readonly tool?: ToolCallBlock;
}

export interface TaskProgressInput {
	readonly messages: readonly ChatConversationItem[];
	readonly busy: boolean;
	readonly preparing?: boolean;
	readonly question?: boolean;
	readonly approval?: boolean;
	readonly permission?: boolean;
	readonly compacting?: boolean;
	readonly connecting?: boolean;
	readonly retry?: RetryProgress | null;
	readonly goal?: CodingAgentGoalState | null;
	readonly queuePaused?: boolean;
}

export function lastConversationMessage(messages: readonly ChatConversationItem[]) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const item = messages[index];
		if (item.kind !== "event") return item;
	}
	return undefined;
}

/** A read-only view of existing runtime/history facts, never a second task state machine. */
export function projectTaskProgress(input: TaskProgressInput): TaskProgress | null {
	const tail = lastConversationMessage(input.messages);
	const answer = tail?.kind === "agent" ? tail : undefined;
	const error = answer?.blocks
		.slice()
		.reverse()
		.find((block): block is ErrorBlock => block.type === "error");
	const state = (phase: TaskPhase, running = false, canContinue = false): TaskProgress => ({
		phase,
		running,
		canContinue,
		...(error && !input.busy && !input.preparing ? { error } : {}),
	});
	if (input.preparing) return state("preparing", true);
	if (input.question) return state("question", true);
	if (input.permission) return state("permission", true);
	if (input.approval) return state("approval", true);
	if (input.busy) {
		if (input.compacting) return state("compacting", true);
		if (input.retry) return state("retrying", true);
		if (input.connecting) return state("connecting", true);
		const tool = answer?.blocks
			.slice()
			.reverse()
			.find((block): block is ToolCallBlock => block.type === "tool_call" && block.status === "pending");
		if (tool) return { ...state("tool", true), tool };
		const last = answer?.blocks.at(-1);
		return state(
			last?.type === "thinking" ? "thinking" : last?.type === "text" && last.text.trim() ? "responding" : "waiting",
			true,
		);
	}
	const canContinue = Boolean(
		answer && !input.queuePaused && error?.details?.code?.toLowerCase() !== "turn_persistence",
	);
	if (input.queuePaused) return state("queuePaused");
	if (input.goal && input.goal.status !== "active") {
		const phases = {
			paused: "paused",
			blocked: "blocked",
			usage_limited: "limited",
			complete: "goalComplete",
		} as const;
		return state(phases[input.goal.status], false, canContinue && input.goal.status !== "complete");
	}
	if (answer?.phase === "failed" || error) return state("failed", false, canContinue);
	if (answer?.phase === "aborted") return state("stopped", false, canContinue);
	const lastBlock = answer?.blocks.at(-1);
	if (lastBlock?.type === "tool_call" && lastBlock.status === "error")
		return { ...state("failed", false, canContinue), tool: lastBlock };
	if (lastBlock?.type === "tool_call" && lastBlock.status === "cancelled") return state("stopped", false, canContinue);
	// A stale pending reply after restore is interrupted, never reported as still running.
	if (answer && ["pending", "streaming", "waiting"].includes(answer.phase))
		return state("stopped", false, canContinue);
	if (answer) return state("replyComplete", false, canContinue);
	return null;
}
