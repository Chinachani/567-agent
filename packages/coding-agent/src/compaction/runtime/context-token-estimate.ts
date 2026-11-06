import type { AgentMessage } from "@567agent/agent-core";
import type { AssistantMessage } from "@567agent/ai";
import { type ConversationDocument, selectConversationDocumentEntries } from "@567agent/runtime-core/conversation";
import { type ContextUsageEstimate, estimateContextTokens } from "../token-policy.js";

export type ContextTokenEstimator = (messages: readonly AgentMessage[]) => ContextUsageEstimate;

/** Retained replies keep their billing usage, but it measured the context before the summary replaced it. */
export function createContextTokenEstimator(document: ConversationDocument | undefined): ContextTokenEstimator {
	if (!document) return estimateContextTokens;
	const branch = selectConversationDocumentEntries(document);
	let boundary = -1;
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type === "compaction" && entry.summaryMessage !== undefined) {
			boundary = index;
			break;
		}
	}
	if (boundary < 0) return estimateContextTokens;
	const outdated = new Set<string>();
	for (const entry of branch.slice(0, boundary)) {
		if (entry.type === "message" && isAssistant(entry.message)) outdated.add(usageIdentity(entry.message));
	}
	return (messages) => estimateContextTokens(messages, (message) => !outdated.has(usageIdentity(message)));
}

function isAssistant(message: unknown): message is AssistantMessage {
	return typeof message === "object" && message !== null && "role" in message && message.role === "assistant";
}

function usageIdentity(message: AssistantMessage): string {
	// Timestamp/provider/model survive the non-mutating microcompact and pinned-context projections.
	return JSON.stringify([message.provider, message.model, message.timestamp]);
}
