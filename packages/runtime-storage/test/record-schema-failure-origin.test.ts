import { describe, expect, it } from "vitest";
import {
	CONVERSATION_SCHEMA_VERSION,
	getStoredSessionEventValidationIssue,
	isStoredSessionEvent,
	readConversationEventRecord,
} from "../src/conversation/index.js";

const baseFailureEvent = {
	type: "turn.failed" as const,
	sessionId: "session-1",
	turnId: "turn-1",
	error: { code: "EXTENSION_FAILED", message: "failed", retryable: false },
	timestamp: 1,
};

describe("conversation failure origin schema", () => {
	it("accepts the generic extension origin for new writes", () => {
		expect(
			isStoredSessionEvent({
				...baseFailureEvent,
				error: { ...baseFailureEvent.error, origin: "extension" },
			}),
		).toBe(true);
	});

	it("normalizes a historical product-owned origin while reading", () => {
		const record = readConversationEventRecord({
			recordType: "conversation.event",
			schemaVersion: CONVERSATION_SCHEMA_VERSION,
			sequence: 1,
			event: {
				...baseFailureEvent,
				error: { ...baseFailureEvent.error, origin: "mcp" },
			},
			documentEntry: null,
		});

		expect(record?.event).toMatchObject({ type: "turn.failed", error: { origin: "extension" } });
		expect(isStoredSessionEvent(record?.event)).toBe(true);
	});

	it("accepts assistant failures with response validation diagnostics", () => {
		const event = {
			type: "message.appended" as const,
			sessionId: "session-1",
			turnId: "turn-1",
			message: {
				role: "assistant" as const,
				content: [],
				api: "openai-responses",
				provider: "openai",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error" as const,
				errorMessage: "Model returned an invalid response",
				failure: {
					code: "AI_RESPONSE_VALIDATION_FAILED",
					message: "Model returned an invalid response",
					retryable: false,
					phase: "decode" as const,
					responseValidation: {
						payloadType: "OpenAI chunk",
						errors: [{ path: "/choices", message: "Expected array", received: '"invalid"' }],
					},
				},
				timestamp: 1,
			},
			timestamp: 1,
		};

		expect(isStoredSessionEvent(event)).toBe(true);
	});

	it("accepts turn failures with lockHolder and responseValidation details", () => {
		const event = {
			type: "turn.failed" as const,
			sessionId: "session-1",
			turnId: "turn-1",
			error: {
				code: "SESSION_LOCKED",
				message: "session is locked",
				retryable: false,
				origin: "runtime" as const,
				details: {
					lockHolder: {
						pid: 1234,
						hostname: "localhost",
						openedAt: "2026-09-22T00:00:00Z",
					},
					responseValidation: {
						payloadType: "OpenAI chunk",
						errors: [{ path: "/choices", message: "Expected array" }],
					},
				},
			},
			timestamp: 1,
		};

		expect(isStoredSessionEvent(event)).toBe(true);
	});

	it("accepts assistant toolCall with streaming partialArgs", () => {
		const event = {
			type: "message.appended" as const,
			sessionId: "session-1",
			turnId: "turn-1",
			message: {
				role: "assistant" as const,
				content: [
					{
						type: "toolCall" as const,
						id: "call_1",
						name: "edit",
						arguments: {},
						partialArgs: '{"path": "foo"}',
					},
				],
				api: "openai-completions",
				provider: "openai",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error" as const,
				timestamp: 1,
			},
			timestamp: 1,
		};

		expect(isStoredSessionEvent(event)).toBe(true);
	});

	it("unpacks specific validation path when assistant message fails schema", () => {
		const invalidEvent = {
			type: "message.appended" as const,
			sessionId: "session-1",
			turnId: "turn-1",
			message: {
				role: "assistant" as const,
				content: [],
				api: "openai-completions",
				provider: "openai",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error" as const,
				failure: {
					code: "ERR",
					message: "failed",
					retryable: false,
					unknownField: "bad",
				},
				timestamp: 1,
			},
			timestamp: 1,
		};

		const issue = getStoredSessionEventValidationIssue(invalidEvent);
		expect(issue).toBeDefined();
		expect(issue?.path).toBe("/message/failure/unknownField");
		expect(issue?.message).toBe("Unexpected property");
	});
});
