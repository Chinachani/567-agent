import type { AssistantMessage, Message } from "@567agent/ai";

/** Thinking alone does not provide an answer or a tool result to continue. */
export function hasVisibleAssistantOutput(message: AssistantMessage): boolean {
	return message.content.some(
		(part) => part.type === "toolCall" || (part.type === "text" && part.text.trim().length > 0),
	);
}

/** Request-only projection: canonical history and reported usage remain untouched. */
export function projectContinuationMessages(messages: readonly Message[]): readonly Message[] {
	let end = messages.length;
	while (end > 0) {
		const message = messages[end - 1];
		if (message.role !== "assistant") break;
		if (
			message.stopReason === "error" ||
			message.stopReason === "aborted" ||
			(message.stopReason === "length" && !hasVisibleAssistantOutput(message))
		) {
			end--;
			continue;
		}
		break;
	}
	const projected = end === messages.length ? messages : messages.slice(0, end);
	const last = projected.at(-1);
	if (last?.role !== "assistant" || last.content.some((part) => part.type === "toolCall")) return projected;
	// Explicit continuation has no new user message. Providers that reject assistant
	// prefills still need a user turn; keep this control instruction out of history.
	return [
		...projected,
		{
			role: "user",
			content: [
				{ type: "text", text: "Continue working from the current conversation. Do not repeat completed work." },
			],
			timestamp: last.timestamp,
		},
	];
}
