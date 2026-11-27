import type { ConverseStreamCommandInput, ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context, LanguageModelStreamEvent, Model, ModelStreamResponse } from "../src/index.js";
import { streamSimple } from "../src/index.js";
import { AI_ERROR_CODES, type AIError } from "../src/protocol/index.js";
import { createAssistantMessage } from "../src/protocol/message-factory.js";
import { type BedrockCommandSender, createBedrockAdapter } from "../src/providers/amazon-bedrock/adapter.js";
import { anthropicAdapter } from "../src/providers/anthropic/adapter.js";
import { streamAnthropic } from "../src/providers/anthropic/stream.js";
import { AdapterRegistry } from "../src/runtime/adapter-registry.js";
import { streamModel } from "../src/runtime/stream-model.js";
import {
	createControlledSseResponse,
	createProviderTestTransport,
	emptySseResponse,
	errorResponse,
	type SseRecord,
	sseResponse,
} from "../src/testing/provider-test-transport.js";

const context: Context = {
	systemPrompt: "Be concise.",
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
};

const anthropicModel: Model<"anthropic-messages"> = createModel("anthropic-messages", "anthropic");
const bedrockModel: Model<"bedrock-converse-stream"> = {
	...createModel("bedrock-converse-stream", "amazon-bedrock"),
	id: "global.anthropic.claude-sonnet-4-6-v1",
	reasoning: true,
};

const rejectedThinking =
	"messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.";
const signedAssistant: AssistantMessage = {
	...createAssistantMessage(
		{ api: anthropicModel.api, provider: anthropicModel.provider, model: anthropicModel.id },
		{ stopReason: "toolUse" },
	),
	content: [
		{ type: "thinking", thinking: "previous reasoning", thinkingSignature: "stale-signature" },
		{ type: "text", text: "previous answer" },
		{ type: "toolCall", id: "lookup-1", name: "lookup", arguments: { query: "test" } },
	],
};
const signedHistory: Context = {
	messages: [
		...context.messages,
		signedAssistant,
		{
			role: "toolResult",
			toolCallId: "lookup-1",
			toolName: "lookup",
			content: [{ type: "text", text: "lookup result" }],
			isError: false,
			timestamp: 3,
		},
	],
};

function thinkingError(message = rejectedThinking, status = 400): Response {
	return errorResponse(status, { type: "error", error: { type: "invalid_request_error", message } });
}

describe("Anthropic signed history through the chat stream", () => {
	it("repairs an explicit rejection and keeps the same repaired prefix in the next tool round", async () => {
		const transport = createProviderTestTransport([
			thinkingError(),
			anthropicSse(anthropicSuccessfulRecords()),
			anthropicSse(anthropicSuccessfulRecords()),
		]);
		const options = { apiKey: "test", fetch: transport.fetch, maxRetries: 0, cacheRetention: "none" as const };
		const original = structuredClone(signedHistory);
		const response = streamSimple(anthropicModel, signedHistory, options);
		const events: string[] = [];
		for await (const event of response) events.push(event.type);
		const recovered = await response.result();
		expect(events.filter((event) => ["start", "done", "error"].includes(event))).toEqual(["start", "done"]);
		expect(recovered).toMatchObject({ stopReason: "toolUse", signedReasoningReset: true });
		expect(signedHistory).toEqual(original);

		const next = await streamSimple(
			anthropicModel,
			{
				messages: [
					...signedHistory.messages,
					JSON.parse(JSON.stringify(recovered)),
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "lookup",
						content: [{ type: "text", text: "new result" }],
						isError: false,
						timestamp: 4,
					},
				],
			},
			options,
		).result();
		expect(next.stopReason).toBe("toolUse");
		expect(next).not.toHaveProperty("signedReasoningReset");

		const [originalWire, repairedWire, nextWire] = transport.requests.map(
			(request) => JSON.parse(request.body ?? "{}").messages,
		);
		expect(originalWire[1].content[0]).toMatchObject({ type: "thinking", signature: "stale-signature" });
		expect(repairedWire[1].content).toEqual(originalWire[1].content.slice(1));
		expect(repairedWire[2]).toEqual(originalWire[2]);
		expect(nextWire.slice(0, repairedWire.length)).toEqual(repairedWire);
		expect(nextWire[3].content[0]).toMatchObject({ type: "thinking", signature: "signature" });
	});

	it("reports a second explicit rejection after exactly one repair", async () => {
		const transport = createProviderTestTransport([
			thinkingError(),
			thinkingError("thinking block cannot be modified"),
		]);
		const message = await streamSimple(anthropicModel, signedHistory, {
			apiKey: "test",
			fetch: transport.fetch,
			maxRetries: 0,
		}).result();
		expect(message.failure).toMatchObject({
			statusCode: 400,
			message: "thinking block cannot be modified",
			retryable: false,
		});
		expect(message).not.toHaveProperty("signedReasoningReset");
		expect(transport.requests).toHaveLength(2);
	});

	it("cancels the repaired request without recording a reset", async () => {
		const controller = new AbortController();
		const transport = createProviderTestTransport([
			thinkingError(),
			() => {
				controller.abort();
				return emptySseResponse();
			},
		]);
		const message = await streamSimple(anthropicModel, signedHistory, {
			apiKey: "test",
			fetch: transport.fetch,
			maxRetries: 0,
			signal: controller.signal,
		}).result();
		expect(message).toMatchObject({ stopReason: "aborted", failure: { code: AI_ERROR_CODES.ABORTED } });
		expect(message).not.toHaveProperty("signedReasoningReset");
		expect(transport.requests).toHaveLength(2);
	});

	it("reports a transient error on the repaired request without allowing the turn to replay the repair", async () => {
		const transport = createProviderTestTransport([
			thinkingError(),
			errorResponse(503, {
				type: "error",
				error: { type: "overloaded_error", message: "Service unavailable" },
			}),
		]);
		const message = await streamSimple(anthropicModel, signedHistory, {
			apiKey: "test",
			fetch: transport.fetch,
			maxRetries: 0,
		}).result();
		expect(message.failure).toMatchObject({ statusCode: 503, retryable: false });
		expect(message).not.toHaveProperty("signedReasoningReset");
		expect(transport.requests).toHaveLength(2);
	});

	it.each([
		["a generic request signature error", anthropicModel, "Invalid request signature", 400],
		["an unrelated request error", anthropicModel, "`tool_use` ids must be unique", 400],
		["an authentication failure", anthropicModel, rejectedThinking, 401],
		["a different model", { ...anthropicModel, id: "another-claude" }, rejectedThinking, 400],
	] as const)("does not repair %s", async (_label, model, error, status) => {
		const transport = createProviderTestTransport([thinkingError(error, status)]);
		const message = await streamSimple(model, signedHistory, {
			apiKey: "test",
			fetch: transport.fetch,
			maxRetries: 0,
		}).result();
		expect(message.failure).toMatchObject({ statusCode: status, message: error });
		expect(transport.requests).toHaveLength(1);
		const wire = JSON.parse(transport.requests[0].body ?? "{}").messages;
		if (model.id !== anthropicModel.id) {
			expect(wire[1].content[0]).toEqual({ type: "text", text: "previous reasoning" });
			expect(wire[1].content.at(-1).id).toBe(wire[2].content[0].tool_use_id);
		}
	});

	it("continues to send a valid same-model signature on the first request", async () => {
		const transport = createProviderTestTransport([anthropicSse(anthropicSuccessfulRecords())]);
		const message = await streamSimple(anthropicModel, signedHistory, {
			apiKey: "test",
			fetch: transport.fetch,
			maxRetries: 0,
		}).result();
		expect(message.stopReason).toBe("toolUse");
		expect(message).not.toHaveProperty("signedReasoningReset");
		expect(transport.requests).toHaveLength(1);
		expect(transport.requests[0].body).toContain('"signature":"stale-signature"');
	});

	it("keeps the selected model's own signature when history contains a reset from another model", async () => {
		const model = { ...anthropicModel, id: "another-claude" };
		const transport = createProviderTestTransport([anthropicSse(anthropicSuccessfulRecords())]);
		const result = await streamSimple(
			model,
			{
				messages: [
					...signedHistory.messages.map((message) =>
						message === signedAssistant ? { ...signedAssistant, model: model.id } : message,
					),
					{
						...signedAssistant,
						content: [{ type: "text", text: "recovered on the other model" }],
						stopReason: "stop",
						signedReasoningReset: true,
					},
					{ role: "user", content: "Continue with the model I selected", timestamp: 4 },
				],
			},
			{ apiKey: "test", fetch: transport.fetch, maxRetries: 0 },
		).result();
		expect(result.stopReason).toBe("toolUse");
		expect(transport.requests).toHaveLength(1);
		expect(transport.requests[0].body).toContain('"signature":"stale-signature"');
	});
});

describe("Anthropic native adapter", () => {
	it("streams thinking, text, tools, signatures, cache usage, and a native terminal result", async () => {
		const transport = createProviderTestTransport([anthropicSse(anthropicSuccessfulRecords())]);
		const response = await anthropicAdapter.stream({
			model: anthropicModel,
			context,
			options: { apiKey: "test", fetch: transport.fetch },
		});

		const { events, result } = await collectNative(response);

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		expect(result.content).toEqual([
			{ type: "thinking", thinking: "reason", thinkingSignature: "signature" },
			{ type: "text", text: "hello" },
			{ type: "toolCall", id: "call-1", name: "lookup", arguments: { query: "test" } },
		]);
		expect(result.stopReason).toBe("toolUse");
		expect(result.usage).toMatchObject({
			input: 3,
			output: 2,
			cacheRead: 4,
			cacheWrite: 5,
			totalTokens: 14,
			cacheUsageReporting: "read-write",
		});
		expect(JSON.parse(transport.requests[0]?.body ?? "{}")).toMatchObject({ model: anthropicModel.id, stream: true });
	});

	it("reports the required fallback when an unknown model has no output limit", async () => {
		const transport = createProviderTestTransport([anthropicSse(anthropicSuccessfulRecords())]);
		const response = await anthropicAdapter.stream({
			model: { ...anthropicModel, id: "future-model", maxTokens: undefined },
			context,
			options: { apiKey: "test", fetch: transport.fetch },
		});

		await collectNative(response);
		expect(JSON.parse(transport.requests[0]?.body ?? "{}")).toMatchObject({ max_tokens: 4_096 });
		expect(await response.metadata).toMatchObject({
			warnings: [
				{
					code: "unknown-model-output-limit",
					provider: "anthropic",
				},
			],
		});
	});

	it("maps HTTP status failures on the native rejection channel", async () => {
		const rateLimitResponse = () =>
			errorResponse(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } });
		const transport = createProviderTestTransport([rateLimitResponse(), rateLimitResponse(), rateLimitResponse()]);

		await expectNativeFailure(
			anthropicAdapter.stream({
				model: anthropicModel,
				context,
				options: { apiKey: "test", fetch: transport.fetch },
			}),
			AI_ERROR_CODES.RATE_LIMITED,
			{ message: "slow down", providerCode: "rate_limit_error" },
		);
	});

	it.each([
		["empty stream", emptySseResponse(), AI_ERROR_CODES.STREAM_PROTOCOL_FAILED],
		[
			"missing message_stop",
			anthropicSse([anthropicMessageStart(), anthropicMessageDelta("end_turn")]),
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"open content block",
			anthropicSse([
				anthropicMessageStart(),
				anthropicTextStart(0),
				anthropicMessageDelta("end_turn"),
				{ event: "message_stop", data: { type: "message_stop" } },
			]),
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"delta before message_start",
			anthropicSse([
				{
					event: "content_block_delta",
					data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "bad" } },
				},
			]),
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"malformed wire event",
			anthropicSse([
				anthropicMessageStart(),
				{
					event: "content_block_start",
					data: { type: "content_block_start", index: "zero", content_block: { type: "text", text: "" } },
				},
			]),
			AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED,
		],
	] as const)("rejects %s", async (_name, providerResponse, code) => {
		const transport = createProviderTestTransport([providerResponse]);
		await expectNativeFailure(
			anthropicAdapter.stream({
				model: anthropicModel,
				context,
				options: { apiKey: "test", fetch: transport.fetch },
			}),
			code,
		);
	});

	it("settles a request aborted before transport starts", async () => {
		const controller = new AbortController();
		controller.abort();
		const transport = createProviderTestTransport([anthropicSse(anthropicSuccessfulRecords())]);

		await expectNativeFailure(
			anthropicAdapter.stream({
				model: anthropicModel,
				context,
				options: { apiKey: "test", fetch: transport.fetch, signal: controller.signal },
			}),
			AI_ERROR_CODES.ABORTED,
		);
		expect(transport.requests).toHaveLength(0);
	});

	it("settles a request aborted during streaming", async () => {
		const controller = new AbortController();
		const controlled = createControlledSseResponse();
		const transport = createProviderTestTransport([controlled.response]);
		const response = await anthropicAdapter.stream({
			model: anthropicModel,
			context,
			options: { apiKey: "test", fetch: transport.fetch, signal: controller.signal },
		});
		const settlement = settleNative(response);
		await waitFor(() => transport.requests.length === 1);
		controlled.emit(anthropicMessageStart());
		controller.abort();
		controlled.close();

		await expect(settlement).rejects.toMatchObject({ code: AI_ERROR_CODES.ABORTED });
	});

	it("keeps the legacy stream as a one-way error-event projection", async () => {
		const transport = createProviderTestTransport([anthropicSse([anthropicMessageStart()])]);
		const stream = streamAnthropic(anthropicModel, context, { apiKey: "test", fetch: transport.fetch });
		const events = [];
		for await (const event of stream) events.push(event);

		expect(events.at(-1)).toMatchObject({ type: "error", reason: "error" });
		expect((await stream.result()).errorMessage).toContain("message_stop");
	});
});

describe("Amazon Bedrock native adapter", () => {
	it.each(["AWS request error", "validation event"])(
		"recovers a Claude signature rejected as a %s",
		async (source) => {
			const registry = new AdapterRegistry();
			const sent: ConverseStreamCommandInput[] = [];
			registry.register(
				createBedrockAdapter({
					send: async (input) => {
						sent.push(input);
						if (sent.length === 1) {
							if (source === "AWS request error") {
								throw Object.assign(new Error(rejectedThinking), {
									name: "ValidationException",
									$metadata: { httpStatusCode: 400 },
								});
							}
							return { stream: wireEvents([{ validationException: { message: rejectedThinking } }]) };
						}
						return { stream: wireEvents(bedrockSuccessfulEvents()) };
					},
				}),
			);
			const history = {
				messages: signedHistory.messages.map((message) =>
					message.role === "assistant"
						? { ...message, api: bedrockModel.api, provider: bedrockModel.provider, model: bedrockModel.id }
						: message,
				),
			};
			const request = { model: bedrockModel, context: history, options: { cacheRetention: "none" as const } };
			const { result, events } = await collectNative(await streamModel(request, registry));
			expect(result).toMatchObject({ stopReason: "toolUse", signedReasoningReset: true });
			expect(
				events
					.filter((event) => event.type === "start" || event.type === "error" || event.type === "done")
					.map((event) => event.type),
			).toEqual(["start", "done"]);
			expect(sent[0].messages?.[1].content?.[0]).toMatchObject({
				reasoningContent: {
					reasoningText: { signature: "stale-signature" },
				},
			});
			expect(sent[1].messages?.[1].content).toEqual(sent[0].messages?.[1].content?.slice(1));
			expect(sent[1].messages?.[2]).toEqual(sent[0].messages?.[2]);

			await collectNative(
				await streamModel(
					{
						...request,
						context: {
							messages: [
								...history.messages,
								result,
								{
									role: "toolResult",
									toolCallId: "call-1",
									toolName: "lookup",
									isError: false,
									content: [{ type: "text", text: "new tool result" }],
									timestamp: 4,
								},
							],
						},
					},
					registry,
				),
			);
			expect(sent[2].messages?.slice(0, 3)).toEqual(sent[1].messages);
			expect(sent[2].messages?.[3].content?.[0]).toMatchObject({
				reasoningContent: {
					reasoningText: { signature: "signature" },
				},
			});
		},
	);

	it.each([
		[bedrockModel.id, "Invalid AWS request signature"],
		["us.amazon.nova-premier-v1:0", rejectedThinking],
	])("does not repair a non-replayable signature error for %s", async (id, message) => {
		const registry = new AdapterRegistry();
		const send = vi.fn(senderFor([{ validationException: { message } }]));
		registry.register(createBedrockAdapter({ send }));
		const model = { ...bedrockModel, id };
		const response = await streamModel(
			{
				model,
				context: {
					messages: [{ ...signedAssistant, api: model.api, provider: model.provider, model: model.id }],
				},
			},
			registry,
		);
		await expect(response.result).rejects.toMatchObject({ providerCode: "ValidationException", statusCode: 400 });
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("streams reasoning, text, tools, usage, and observes request options", async () => {
		let observedInput: ConverseStreamCommandInput | undefined;
		let observedSignal: AbortSignal | undefined;
		const controller = new AbortController();
		const send: BedrockCommandSender = async (input, options) => {
			observedInput = input;
			observedSignal = options.signal;
			return { stream: wireEvents(bedrockSuccessfulEvents()) };
		};
		const adapter = createBedrockAdapter({ send });

		const { events, result } = await collectNative(
			await adapter.stream({
				model: bedrockModel,
				context,
				options: { signal: controller.signal, region: "eu-west-1" },
			}),
		);

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		expect(result.content).toEqual([
			{ type: "thinking", thinking: "reason", thinkingSignature: "signature" },
			{ type: "text", text: "hello" },
			{ type: "toolCall", id: "call-1", name: "lookup", arguments: { query: "test" } },
		]);
		expect(result.stopReason).toBe("toolUse");
		expect(result.usage).toMatchObject({
			input: 3,
			output: 2,
			cacheRead: 4,
			cacheWrite: 5,
			totalTokens: 14,
			cacheUsageReporting: "read-write",
		});
		expect(observedInput).toMatchObject({ modelId: bedrockModel.id });
		expect(observedSignal).toBe(controller.signal);
	});

	it.each([
		["empty stream", [], AI_ERROR_CODES.STREAM_PROTOCOL_FAILED],
		["missing messageStop", [{ messageStart: { role: "assistant" } }], AI_ERROR_CODES.STREAM_PROTOCOL_FAILED],
		[
			"open content block",
			[
				{ messageStart: { role: "assistant" } },
				{ contentBlockDelta: { contentBlockIndex: 0, delta: { text: "open" } } },
				{ messageStop: { stopReason: "end_turn" } },
			],
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"delta before messageStart",
			[{ contentBlockDelta: { contentBlockIndex: 0, delta: { text: "bad" } } }],
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"malformed wire event",
			[
				{ messageStart: { role: "assistant" } },
				{ contentBlockDelta: { contentBlockIndex: "zero", delta: { text: "bad" } } },
			],
			AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED,
		],
	] as const)("rejects %s", async (_name, events, code) => {
		const adapter = createBedrockAdapter({ send: senderFor(events) });
		await expectNativeFailure(adapter.stream({ model: bedrockModel, context }), code);
	});

	it("maps streamed throttling exceptions to the stable rate-limit error", async () => {
		const adapter = createBedrockAdapter({
			send: senderFor([{ throttlingException: { message: "slow down" } }]),
		});

		await expectNativeFailure(adapter.stream({ model: bedrockModel, context }), AI_ERROR_CODES.RATE_LIMITED, {
			message: "Throttling error: slow down",
			providerCode: "ThrottlingException",
		});
	});

	it("maps AWS SDK response metadata to the stable permission error", async () => {
		const sdkError = Object.assign(new Error("denied"), {
			name: "AccessDeniedException",
			$metadata: { httpStatusCode: 403 },
		});
		const adapter = createBedrockAdapter({ send: vi.fn().mockRejectedValue(sdkError) });

		await expectNativeFailure(adapter.stream({ model: bedrockModel, context }), AI_ERROR_CODES.PERMISSION_DENIED, {
			message: "denied",
			providerCode: "AccessDeniedException",
		});
	});

	it("does not call the sender when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const send = vi.fn<BedrockCommandSender>();
		const adapter = createBedrockAdapter({ send });

		await expectNativeFailure(
			adapter.stream({ model: bedrockModel, context, options: { signal: controller.signal } }),
			AI_ERROR_CODES.ABORTED,
		);
		expect(send).not.toHaveBeenCalled();
	});

	it("settles a request aborted while consuming the event stream", async () => {
		const controller = new AbortController();
		const adapter = createBedrockAdapter({
			send: async () => ({
				stream: wireEvents(
					[{ messageStart: { role: "assistant" } }, { messageStop: { stopReason: "end_turn" } }],
					() => controller.abort(),
				),
			}),
		});

		await expectNativeFailure(
			adapter.stream({ model: bedrockModel, context, options: { signal: controller.signal } }),
			AI_ERROR_CODES.ABORTED,
		);
	});
});

async function collectNative(response: ModelStreamResponse): Promise<{
	events: LanguageModelStreamEvent[];
	result: AssistantMessage;
}> {
	const events: LanguageModelStreamEvent[] = [];
	for await (const event of response.events) events.push(event);
	return { events, result: await response.result };
}

async function settleNative(response: ModelStreamResponse): Promise<void> {
	await Promise.all([collectEvents(response.events), response.result]);
}

async function expectNativeFailure(
	responsePromise: Promise<ModelStreamResponse>,
	code: AIError["code"],
	details: Partial<AIError> = {},
): Promise<void> {
	const response = await responsePromise;
	const settlement = Promise.all([collectEvents(response.events), response.result]);
	await expect(settlement).rejects.toMatchObject({ code, ...details } satisfies Partial<AIError>);
}

async function collectEvents(events: AsyncIterable<LanguageModelStreamEvent>): Promise<LanguageModelStreamEvent[]> {
	const result: LanguageModelStreamEvent[] = [];
	for await (const event of events) result.push(event);
	return result;
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for test condition");
}

function anthropicSuccessfulRecords(): SseRecord[] {
	return [
		anthropicMessageStart(),
		{
			event: "content_block_start",
			data: {
				type: "content_block_start",
				index: 0,
				content_block: { type: "thinking", thinking: "", signature: "" },
			},
		},
		{
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reason" } },
		},
		{
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signature" } },
		},
		{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
		anthropicTextStart(1),
		{
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } },
		},
		{ event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
		{
			event: "content_block_start",
			data: {
				type: "content_block_start",
				index: 2,
				content_block: { type: "tool_use", id: "call-1", name: "lookup", input: {} },
			},
		},
		{
			event: "content_block_delta",
			data: {
				type: "content_block_delta",
				index: 2,
				delta: { type: "input_json_delta", partial_json: '{"query":' },
			},
		},
		{
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"test"}' } },
		},
		{ event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
		anthropicMessageDelta("tool_use"),
		{ event: "message_stop", data: { type: "message_stop" } },
	];
}

function anthropicMessageStart(): SseRecord {
	return {
		event: "message_start",
		data: {
			type: "message_start",
			message: {
				id: "message-1",
				type: "message",
				role: "assistant",
				content: [],
				model: anthropicModel.id,
				stop_reason: null,
				stop_sequence: null,
				usage: {
					input_tokens: 3,
					output_tokens: 0,
					cache_read_input_tokens: 4,
					cache_creation_input_tokens: 5,
				},
			},
		},
	};
}

function anthropicTextStart(index: number): SseRecord {
	return {
		event: "content_block_start",
		data: { type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } },
	};
}

function anthropicMessageDelta(stopReason: "end_turn" | "tool_use"): SseRecord {
	return {
		event: "message_delta",
		data: {
			type: "message_delta",
			delta: { stop_reason: stopReason, stop_sequence: null },
			usage: { output_tokens: 2 },
		},
	};
}

function anthropicSse(records: readonly SseRecord[]): Response {
	return sseResponse(records);
}

function bedrockSuccessfulEvents(): unknown[] {
	return [
		{ messageStart: { role: "assistant" } },
		{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "reason" } } } },
		{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "signature" } } } },
		{ contentBlockStop: { contentBlockIndex: 0 } },
		{ contentBlockDelta: { contentBlockIndex: 1, delta: { text: "hello" } } },
		{ contentBlockStop: { contentBlockIndex: 1 } },
		{ contentBlockStart: { contentBlockIndex: 2, start: { toolUse: { toolUseId: "call-1", name: "lookup" } } } },
		{ contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: '{"query":' } } } },
		{ contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: '"test"}' } } } },
		{ contentBlockStop: { contentBlockIndex: 2 } },
		{ messageStop: { stopReason: "tool_use" } },
		{
			metadata: {
				usage: {
					inputTokens: 3,
					outputTokens: 2,
					cacheReadInputTokens: 4,
					cacheWriteInputTokens: 5,
					totalTokens: 14,
				},
			},
		},
	];
}

function senderFor(events: readonly unknown[]): BedrockCommandSender {
	return async () => ({ stream: wireEvents(events) });
}

async function* wireEvents(events: readonly unknown[], onFirstEvent?: () => void): AsyncIterable<ConverseStreamOutput> {
	for (let index = 0; index < events.length; index++) {
		yield events[index] as ConverseStreamOutput;
		if (index === 0) onFirstEvent?.();
	}
}

function createModel<TApi extends "anthropic-messages" | "bedrock-converse-stream">(
	api: TApi,
	provider: string,
): Model<TApi> {
	return {
		id: "test-model",
		name: "Test Model",
		api,
		provider,
		baseUrl: "https://provider.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}
