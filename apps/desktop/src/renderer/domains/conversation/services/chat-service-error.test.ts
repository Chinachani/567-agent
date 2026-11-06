import type { AssistantMessage } from "@567agent/ai";
import { createConversationUserMessage } from "@shared/conversation";
import type { ErrorBlock } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { appendError, fullHistoryToChat, historyToChat } from "./chat-service";
import { reconcileHistoryWithLiveTerminalErrors } from "./terminal-error-reconciliation";

/** 会话文件里一条失败的 assistant message。 */
function failed(errorMessage: string) {
	return { role: "assistant", content: [], stopReason: "error", errorMessage };
}

/** 持久化历史里完整的 assistant message。 */
function durableAssistant(overrides: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "qwen",
		model: "qwen3.8-flash-next",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
		...overrides,
	};
}

function errorBlocksOf(messages: ReturnType<typeof historyToChat>): ErrorBlock[] {
	return messages.flatMap((message) =>
		message.kind === "agent" ? message.blocks.filter((block): block is ErrorBlock => block.type === "error") : [],
	);
}

describe("历史回放的错误折叠", () => {
	it("连续同类错误合成一条并计数", () => {
		const messages = historyToChat([
			{ role: "user", content: "hi" },
			failed("429 rate limit"),
			failed("429 rate limit"),
			failed("429 rate limit"),
		]);

		const errors = errorBlocksOf(messages);
		expect(errors).toHaveLength(1);
		expect(errors[0].kind).toBe("rate_limit");
		expect(errors[0].repeated).toBe(3);
	});

	it("不同类的错误不合并", () => {
		const errors = errorBlocksOf(historyToChat([failed("429 rate limit"), failed("401 Unauthorized")]));

		expect(errors.map((e) => e.kind)).toEqual(["rate_limit", "auth"]);
		expect(errors.every((e) => e.repeated === undefined)).toBe(true);
	});

	it("合并后保留末次原文（配额类末次才带重置时间）", () => {
		const errors = errorBlocksOf(
			historyToChat([failed("429 窗口额度已用尽"), failed("429 窗口额度已用尽，将于 18:00 重置")]),
		);

		expect(errors).toHaveLength(1);
		expect(errors[0].text).toBe("429 窗口额度已用尽，将于 18:00 重置");
	});

	it("被用户消息隔开的同类错误不合并", () => {
		const errors = errorBlocksOf(
			historyToChat([failed("500 server error"), { role: "user", content: "again" }, failed("500 server error")]),
		);

		expect(errors).toHaveLength(2);
	});

	it("同一轮里随后成功的失败尝试不再显示错误", () => {
		const messages = historyToChat([
			{ role: "user", content: "hi" },
			failed("429 rate limit"),
			{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
		]);

		expect(errorBlocksOf(messages)).toEqual([]);
		expect(messages.at(-1)).toMatchObject({ kind: "agent", text: "done" });
	});

	it("失败后被用户中断的尝试仍显示错误", () => {
		const errors = errorBlocksOf(
			historyToChat([
				{ role: "user", content: "hi" },
				failed("500 server error"),
				{ role: "assistant", content: [], stopReason: "aborted" },
			]),
		);

		expect(errors).toHaveLength(1);
	});
});

describe("appendError", () => {
	it("写入时归类，并记下自动重试次数", () => {
		const messages = appendError([], "429 rate limit", 3);
		const block = errorBlocksOf(messages).at(-1) as ErrorBlock;

		expect(block.kind).toBe("rate_limit");
		expect(block.attempts).toBe(3);
	});

	it("没重试过时不写 attempts", () => {
		const messages = appendError([], "401 Unauthorized");
		const block = errorBlocksOf(messages).at(-1) as ErrorBlock;

		expect(block.kind).toBe("auth");
		expect(block.attempts).toBeUndefined();
	});

	it("同一 turn 重放错误事件时保持单个错误块", () => {
		const once = appendError([], "503 unavailable", undefined, "turn-1");
		const twice = appendError(once, "503 unavailable", 1, "turn-1", {
			code: "TRANSPORT_FAILED",
			origin: "provider",
			statusCode: 503,
			provider: "deepseek",
		});
		expect(errorBlocksOf(twice)).toHaveLength(1);
		expect(errorBlocksOf(twice)[0]).toMatchObject({
			turnId: "turn-1",
			attempts: 1,
			details: { code: "TRANSPORT_FAILED", origin: "provider", statusCode: 503, provider: "deepseek" },
		});
	});
});

describe("fullHistoryToChat error entries", () => {
	it("restoring a recovered retry hides durable intermediate failures without changing history", () => {
		const entries = [
			{ type: "message" as const, message: { role: "user" as const, content: "hello", timestamp: 1 } },
			...retryAttempt("attempt-1"),
			...retryAttempt("attempt-2"),
			{ type: "message" as const, message: durableAssistant({ content: [{ type: "text", text: "recovered" }] }) },
		];
		const original = JSON.stringify(entries);
		expect(errorBlocksOf(fullHistoryToChat(entries))).toEqual([]);
		expect(fullHistoryToChat(entries).at(-1)).toMatchObject({ text: "recovered" });
		expect(JSON.stringify(entries)).toBe(original);
	});

	it("keeps one card per failed attempt when retries are exhausted and preserves the last turn identity", () => {
		const errors = errorBlocksOf(fullHistoryToChat([...retryAttempt("attempt-1"), ...retryAttempt("attempt-2")]));
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ repeated: 2, turnId: "attempt-2", details: { statusCode: 502 } });
	});

	it("a new user prompt and non-retryable errors remain visible after a later success", () => {
		const entries = [
			...retryAttempt("attempt-1"),
			{ type: "message" as const, message: { role: "user" as const, content: "again", timestamp: 3 } },
			...retryAttempt("attempt-2", false),
			{ type: "message" as const, message: durableAssistant({ content: [{ type: "text", text: "done" }] }) },
		];
		expect(errorBlocksOf(fullHistoryToChat(entries)).map(({ turnId }) => turnId)).toEqual(["attempt-1", "attempt-2"]);
	});

	it("an aborted attempt ends retry recovery even if a later assistant succeeds", () => {
		const aborted = durableAssistant({ stopReason: "aborted", timestamp: 3 });
		const recovered = durableAssistant({ content: [{ type: "text", text: "later" }], timestamp: 4 });
		expect(
			errorBlocksOf(
				fullHistoryToChat([
					...retryAttempt("attempt-1"),
					{ type: "message", message: aborted },
					{ type: "message", message: recovered },
				]),
			),
		).toHaveLength(1);
		expect(errorBlocksOf(historyToChat([failed("502 service unavailable"), aborted, recovered]))).toHaveLength(1);
	});

	it("hides a context overflow that auto compaction recovered within the turn", () => {
		const overflow = "400 This model's maximum context length is 200000 tokens.";
		const messages = fullHistoryToChat([
			{ type: "message", message: { role: "user", content: "read everything", timestamp: 1 } },
			{ type: "message", message: durableAssistant({ stopReason: "error", errorMessage: overflow }) },
			{ type: "compaction", entryId: "compaction-1", summary: "summary", tokensBefore: 193_000, timestamp: "2" },
			{ type: "message", message: durableAssistant({ content: [{ type: "text", text: "done" }] }) },
		]);

		expect(errorBlocksOf(messages)).toEqual([]);
		expect(messages.map((message) => message.kind)).toEqual(["user", "agent", "event", "agent"]);
	});

	it("keeps an overflow that ended the turn", () => {
		const overflow = "400 This model's maximum context length is 200000 tokens.";
		const messages = fullHistoryToChat([
			{ type: "message", message: { role: "user", content: "read everything", timestamp: 1 } },
			{ type: "message", message: durableAssistant({ stopReason: "error", errorMessage: overflow }) },
			{ type: "message", message: { role: "user", content: "next", timestamp: 3 } },
		]);

		expect(errorBlocksOf(messages)).toEqual([expect.objectContaining({ text: overflow })]);
	});

	it("renders a durable turn failure as an error card", () => {
		const messages = fullHistoryToChat([
			{ type: "message", message: { role: "user", content: "hello", timestamp: 1 } },
			{
				type: "error",
				entryId: "error-1",
				turnId: "turn-1",
				code: "TRANSPORT_FAILED",
				retryable: false,
				origin: "provider",
				details: { statusCode: 503, provider: "deepseek", modelId: "deepseek-chat", phase: "response" },
				message: "503 service unavailable",
				timestamp: "2026-08-13T00:00:00.000Z",
			},
		]);

		expect(errorBlocksOf(messages)).toEqual([
			expect.objectContaining({
				type: "error",
				kind: "server",
				text: "503 service unavailable",
				turnId: "turn-1",
				details: {
					code: "TRANSPORT_FAILED",
					origin: "provider",
					retryable: false,
					statusCode: 503,
					provider: "deepseek",
					modelId: "deepseek-chat",
					phase: "response",
				},
			}),
		]);
	});

	it("deduplicates the assistant error message and durable turn failure", () => {
		const messages = fullHistoryToChat([
			{ type: "message", message: { role: "user", content: "hello", timestamp: 1 } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [],
					api: "openai-responses",
					provider: "deepseek",
					model: "deepseek-chat",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "error",
					errorMessage: "provider quota exhausted",
					timestamp: 2,
				} satisfies AssistantMessage,
			},
			{
				type: "error",
				entryId: "error-1",
				turnId: "turn-1",
				code: "AI_BILLING_REQUIRED",
				message: "provider quota exhausted",
				timestamp: "2026-08-13T00:00:00.000Z",
			},
		]);

		const errors = errorBlocksOf(messages);
		expect(errors).toEqual([
			expect.objectContaining({
				type: "error",
				text: "provider quota exhausted",
				turnId: "turn-1",
			}),
		]);
		expect(errors[0]).not.toHaveProperty("repeated");
	});
});

function retryAttempt(turnId: string, retryable = true) {
	return [
		{ type: "message" as const, message: durableAssistant({ stopReason: "error", errorMessage: "502 Bad Gateway" }) },
		{
			type: "error" as const,
			entryId: `error-${turnId}`,
			turnId,
			code: "AI_TRANSPORT_FAILED",
			retryable,
			origin: "provider" as const,
			details: { statusCode: 502 },
			message: "502 Bad Gateway",
			timestamp: "2026-11-06T09:00:00.000Z",
		},
	];
}

describe("reconcileHistoryWithLiveTerminalErrors", () => {
	it("preserves a live terminal error when the agent_end history snapshot is stale", () => {
		const live = appendError(
			[createConversationUserMessage({ id: "user-live", text: "hello" })],
			"provider quota exhausted",
			undefined,
			"turn-1",
			{ code: "AI_BILLING_REQUIRED", provider: "deepseek", retryable: false },
		);
		const staleHistory = fullHistoryToChat([
			{ type: "message", entryId: "user-1", message: { role: "user", content: "hello", timestamp: 1 } },
		]);

		const reconciled = reconcileHistoryWithLiveTerminalErrors(staleHistory, live);

		expect(errorBlocksOf(reconciled)).toEqual([
			expect.objectContaining({
				turnId: "turn-1",
				text: "provider quota exhausted",
				details: { code: "AI_BILLING_REQUIRED", provider: "deepseek", retryable: false },
			}),
		]);
	});

	it("deduplicates a terminal error already present in canonical history", () => {
		const live = appendError([], "provider quota exhausted", 2, "turn-1", {
			code: "AI_BILLING_REQUIRED",
			provider: "deepseek",
		});
		const history = fullHistoryToChat([
			{
				type: "error",
				entryId: "error-1",
				turnId: "turn-1",
				code: "AI_BILLING_REQUIRED",
				message: "provider quota exhausted",
				timestamp: "2026-08-13T00:00:00.000Z",
			},
		]);

		const reconciled = reconcileHistoryWithLiveTerminalErrors(history, live);

		expect(errorBlocksOf(reconciled)).toHaveLength(1);
		expect(errorBlocksOf(reconciled)[0]).toMatchObject({ turnId: "turn-1", attempts: 2 });
	});
});
