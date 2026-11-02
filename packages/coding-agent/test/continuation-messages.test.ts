import type { AssistantMessage, Message } from "@567agent/ai";
import { describe, expect, it } from "vitest";
import { projectContinuationMessages } from "../src/model-context/continuation-messages.js";

function assistant(
	stopReason: AssistantMessage["stopReason"],
	content: AssistantMessage["content"] = [],
): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-completions",
		provider: "fixture",
		model: "fixture",
		content,
		stopReason,
		timestamp: 2,
		usage: {
			input: 2,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}
const user: Message = { role: "user", content: "Do the task", timestamp: 1 };

describe("request-only continuation projection", () => {
	it("replays the original user request after thinking-only length and multiple failed continuations without rewriting usage or history", () => {
		const messages = [
			user,
			assistant("length", [{ type: "thinking", thinking: "hidden" }]),
			assistant("error"),
			assistant("error"),
		];
		const before = structuredClone(messages);
		expect(projectContinuationMessages(messages)).toEqual([user]);
		expect(messages).toEqual(before);
	});
	it("gives completed and partially truncated answers an explicit transient continuation request", () => {
		for (const stop of ["stop", "length"] as const) {
			const messages = [user, assistant(stop, [{ type: "text", text: "Partial answer" }])];
			const projected = projectContinuationMessages(messages);
			expect(projected.slice(0, -1)).toEqual(messages);
			expect(projected.at(-1)).toMatchObject({ role: "user" });
			expect(messages).toHaveLength(2);
		}
	});
	it("does not place a continuation instruction between a pending tool call and its result", () => {
		const call = assistant("toolUse", [{ type: "toolCall", id: "call", name: "read", arguments: {} }]);
		const messages: Message[] = [user, call];
		expect(projectContinuationMessages(messages)).toBe(messages);
		messages.push({
			role: "toolResult",
			toolCallId: "call",
			toolName: "read",
			content: [{ type: "text", text: "result" }],
			isError: false,
			timestamp: 3,
		});
		expect(projectContinuationMessages(messages)).toBe(messages);
	});
	it("leaves an ordinary new user turn unchanged", () => {
		const messages = [
			user,
			assistant("stop", [{ type: "text", text: "Done" }]),
			{ ...user, content: "Next question" },
		];
		expect(projectContinuationMessages(messages)).toBe(messages);
	});
});
