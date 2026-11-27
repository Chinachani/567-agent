import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import {
	type Api,
	type AssistantMessage,
	type Context,
	type LanguageModelStreamEvent,
	type Model,
	type ModelStreamResponse,
	streamSimple,
} from "../src/index.js";
import { AI_ERROR_CODES, type AIError, createAssistantMessage } from "../src/protocol/index.js";
import { createGoogleAdapter, type GoogleContentSender } from "../src/providers/google.js";
import { googleGeminiCliAdapter } from "../src/providers/google-gemini-cli.js";
import { SKIP_THOUGHT_SIGNATURE_VALIDATOR } from "../src/providers/google-shared.js";
import { createGoogleVertexAdapter, type GoogleVertexContentSender } from "../src/providers/google-vertex.js";
import { AdapterRegistry } from "../src/runtime/adapter-registry.js";
import { streamModel } from "../src/runtime/stream-model.js";
import { createProviderTestTransport, errorResponse } from "../src/testing/provider-test-transport.js";

const context: Context = {
	systemPrompt: "Be concise.",
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
	tools: [{ name: "lookup", description: "Lookup data", parameters: Type.Object({ query: Type.String() }) }],
};

const googleModel = createModel("google-generative-ai", "google");
const vertexModel = createModel("google-vertex", "google-vertex");
const cliModel = createModel("google-gemini-cli", "google-gemini-cli");
const cliApiKey = JSON.stringify({ token: "test-token", projectId: "test-project" });

const signedGemini = { ...googleModel, id: "gemini-3-pro-preview" };
const staleSignature = "c3RhbGU=";
const freshSignature = "ZnJlc2g=";
const invalidThoughtSignature = "Unable to validate the thought signature in the request.";

function geminiRequestError(message: string) {
	return { error: { code: 400, status: "INVALID_ARGUMENT", message } };
}

function geminiToolHistory(model: Model<Api>, signature = staleSignature): Context {
	const assistant = createAssistantMessage({ ...model, model: model.id }, { stopReason: "toolUse" });
	assistant.content = [
		{ type: "thinking", thinking: "old reasoning", thinkingSignature: signature },
		{ type: "text", text: "previous answer", textSignature: signature },
		{ type: "toolCall", id: "first", name: "lookup", arguments: { query: "one" }, thoughtSignature: signature },
		{ type: "toolCall", id: "second", name: "lookup", arguments: { query: "two" } },
	];
	return {
		...context,
		messages: [
			...context.messages,
			assistant,
			...["first", "second"].map((toolCallId) => ({
				role: "toolResult" as const,
				toolCallId,
				toolName: "lookup",
				isError: false,
				timestamp: 3,
				content: [{ type: "text" as const, text: `result for ${toolCallId}` }],
			})),
		],
	};
}

function geminiReply() {
	return [
		{ candidates: [{ content: { role: "model", parts: [{ text: "answer", thoughtSignature: freshSignature }] } }] },
		{ candidates: [{ finishReason: "STOP" }], usageMetadata: { totalTokenCount: 3 } },
	];
}

describe("Gemini signed history through the registered chat stream", () => {
	it("recovers an explicit Developer API HTTP 400 through the default chat entry point", async () => {
		const rejection = "Invalid value at 'contents[1].parts[0].thought_signature'.";
		const transport = createProviderTestTransport([
			errorResponse(400, geminiRequestError(rejection)),
			sseResponse(geminiReply()),
		]);
		vi.stubGlobal("fetch", transport.fetch);
		try {
			const result = await streamSimple(signedGemini, geminiToolHistory(signedGemini), {
				apiKey: "test-key",
			}).result();
			expect(result).toMatchObject({ stopReason: "stop", signedReasoningReset: true });
			expect(transport.requests).toHaveLength(2);
			expect(transport.requests[0].body).toContain(staleSignature);
			expect(transport.requests[1].body).not.toContain(staleSignature);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it.each([
		{ create: createGoogleAdapter, model: signedGemini },
		{ create: createGoogleVertexAdapter, model: { ...vertexModel, id: signedGemini.id } },
	])("repairs and reuses the repaired prefix for $model.api", async ({ create, model }) => {
		const registry = new AdapterRegistry();
		const sent: Parameters<GoogleContentSender>[0][] = [];
		const send = async (params: Parameters<GoogleContentSender>[0]) => {
			sent.push(params);
			if (sent.length === 1)
				throw Object.assign(new Error(JSON.stringify(geminiRequestError(invalidThoughtSignature))), {
					status: 400,
				});
			return chunks(geminiReply());
		};
		registry.register(create({ send }));
		const history = geminiToolHistory(model);
		const original = structuredClone(history.messages);
		const { events, result } = await collectNative(await streamModel({ model, context: history }, registry));
		expect(result).toMatchObject({ stopReason: "stop", signedReasoningReset: true });
		expect(
			events.filter((event) => ["start", "error", "done"].includes(event.type)).map((event) => event.type),
		).toEqual(["start", "done"]);
		expect(history.messages).toEqual(original);
		const [first, repaired] = sent.map(({ contents }) => contents);
		if (!Array.isArray(first) || !Array.isArray(repaired)) throw new Error("Expected Gemini message arrays");
		expect(first).toMatchObject([
			{},
			{
				parts: [
					{ thoughtSignature: staleSignature },
					{ thoughtSignature: staleSignature },
					{ thoughtSignature: staleSignature },
					{},
				],
			},
			{},
		]);
		expect(repaired).toMatchObject([
			{},
			{
				parts: [
					{ text: "previous answer" },
					{
						functionCall: { name: "lookup", args: { query: "one" } },
						thoughtSignature: SKIP_THOUGHT_SIGNATURE_VALIDATOR,
					},
					{ functionCall: { name: "lookup", args: { query: "two" } } },
				],
			},
			{},
		]);
		expect(JSON.stringify(repaired)).not.toContain(staleSignature);
		expect(repaired[2]).toEqual(first[2]);

		await collectNative(
			await streamModel(
				{
					model,
					context: {
						...history,
						messages: [
							...history.messages,
							JSON.parse(JSON.stringify(result)),
							{ role: "user", content: "follow up", timestamp: 4 },
						],
					},
				},
				registry,
			),
		);
		const followup = sent[2].contents;
		if (!Array.isArray(followup)) throw new Error("Expected Gemini follow-up messages");
		expect(followup.slice(0, 3)).toEqual(repaired);
		expect(followup[3]).toMatchObject({ parts: [{ text: "answer", thoughtSignature: freshSignature }] });
	});

	it.each(["HTTP 400", "SSE error"])("recovers a Code Assist %s", async (source) => {
		const model = { ...cliModel, id: signedGemini.id };
		const rejection = geminiRequestError(invalidThoughtSignature);
		const transport = createProviderTestTransport([
			source === "HTTP 400" ? errorResponse(400, rejection) : sseResponse([rejection]),
			sseResponse(geminiReply().map((response) => ({ response }))),
		]);
		const result = await (
			await streamModel({
				model,
				context: geminiToolHistory(model),
				options: { apiKey: cliApiKey, fetch: transport.fetch },
			})
		).result;
		expect(result).toMatchObject({ signedReasoningReset: true });
		expect(transport.requests).toHaveLength(2);
		expect(transport.requests[0].body).toContain(staleSignature);
		expect(transport.requests[1].body).not.toContain(staleSignature);
	});

	it.each([
		{ label: "an unsigned history already using the sentinel", signature: "", error: invalidThoughtSignature },
		{
			label: "a missing signature",
			signature: staleSignature,
			error: "Function call is missing a thought_signature.",
		},
		{ label: "a generic invalid argument", signature: staleSignature, error: "Invalid thinkingBudget" },
	])("surfaces $label without resending", async ({ signature, error }) => {
		const registry = new AdapterRegistry();
		const send = vi.fn(async () => {
			throw Object.assign(new Error(JSON.stringify(geminiRequestError(error))), { status: 400 });
		});
		registry.register(createGoogleAdapter({ send }));
		const response = await streamModel(
			{ model: signedGemini, context: geminiToolHistory(signedGemini, signature) },
			registry,
		);
		await expect(response.result).rejects.toMatchObject({ statusCode: 400, message: error });
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("does not reuse or repair a signature after the user switches Gemini models", async () => {
		const registry = new AdapterRegistry();
		const send = vi.fn<GoogleContentSender>(async () => chunks(geminiReply()));
		registry.register(createGoogleAdapter({ send }));
		const model = { ...signedGemini, id: "gemini-3-flash-preview" };
		const result = await (await streamModel({ model, context: geminiToolHistory(signedGemini) }, registry)).result;
		expect(result).not.toHaveProperty("signedReasoningReset");
		expect(send).toHaveBeenCalledTimes(1);
		const payload = send.mock.calls[0][0].contents;
		expect(JSON.stringify(payload)).not.toContain(staleSignature);
		expect(payload).toMatchObject([
			{},
			{
				parts: [
					{ text: "old reasoning" },
					{ text: "previous answer" },
					{ functionCall: { name: "lookup" }, thoughtSignature: SKIP_THOUGHT_SIGNATURE_VALIDATOR },
					{ functionCall: { name: "lookup" } },
				],
			},
			{},
		]);
	});

	it("preserves reported usage when a Gemini stream rejects a signature after the request was metered", async () => {
		const registry = new AdapterRegistry();
		const send = vi.fn<GoogleContentSender>(async () =>
			chunks([
				{ usageMetadata: { promptTokenCount: 4, totalTokenCount: 4 } },
				geminiRequestError(invalidThoughtSignature),
			]),
		);
		registry.register(createGoogleAdapter({ send }));
		const reply = await streamModel({ model: signedGemini, context: geminiToolHistory(signedGemini) }, registry);
		const events: LanguageModelStreamEvent[] = [];
		await expect(
			(async () => {
				for await (const event of reply.events) events.push(event);
			})(),
		).rejects.toMatchObject({ statusCode: 400 });
		expect(events.at(-1)).toMatchObject({ type: "error", error: { usage: { input: 4 } } });
		expect(send).toHaveBeenCalledTimes(1);
	});
});

describe("Google Generative AI native adapter", () => {
	it("uses the normalized provider message in the terminal error event", async () => {
		const payload = {
			error: {
				code: 503,
				message: "No capacity available for model gpt-oss-120b-medium",
				details: [{ reason: "MODEL_CAPACITY_EXHAUSTED" }],
			},
		};
		const source = Object.assign(new Error(JSON.stringify(payload)), { status: 503 });
		const adapter = createGoogleAdapter({
			send: async () => {
				throw source;
			},
		});
		const response = await adapter.stream({ model: googleModel, context });
		const iterator = response.events[Symbol.asyncIterator]();
		const terminal = await iterator.next();

		expect(terminal.value).toMatchObject({
			type: "error",
			error: { errorMessage: "No capacity available for model gpt-oss-120b-medium" },
			failure: {
				message: "No capacity available for model gpt-oss-120b-medium",
				statusCode: 503,
				providerCode: "MODEL_CAPACITY_EXHAUSTED",
			},
		});
		await expect(iterator.next()).rejects.toMatchObject({
			message: "No capacity available for model gpt-oss-120b-medium",
			statusCode: 503,
			providerCode: "MODEL_CAPACITY_EXHAUSTED",
		});
	});

	it("streams thinking, text, tools, signatures, usage, and request parameters", async () => {
		let observedParams: Parameters<GoogleContentSender>[0] | undefined;
		const send: GoogleContentSender = async (params) => {
			observedParams = params;
			return chunks(successfulChunks());
		};
		const adapter = createGoogleAdapter({ send });

		const { events, result } = await collectNative(
			await adapter.stream({
				model: googleModel,
				context,
				options: {
					apiKey: "test-key",
					maxTokens: 100,
					thinking: { enabled: true, budgetTokens: 32 },
					toolChoice: "auto",
				},
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
			"toolcall_end",
			"done",
		]);
		expect(result.content).toEqual([
			{ type: "thinking", thinking: "reason", thinkingSignature: "thought-sig" },
			{ type: "text", text: "hello", textSignature: "text-sig" },
			{
				type: "toolCall",
				id: "call-1",
				name: "lookup",
				arguments: { query: "test" },
				thoughtSignature: "tool-sig",
			},
		]);
		expect(result.stopReason).toBe("toolUse");
		expect(result.usage).toMatchObject({
			input: 7,
			output: 6,
			cacheRead: 3,
			totalTokens: 16,
			cacheUsageReporting: "read-only",
		});
		expect(observedParams).toMatchObject({
			model: googleModel.id,
			config: {
				maxOutputTokens: 100,
				systemInstruction: "Be concise.",
				thinkingConfig: { includeThoughts: true, thinkingBudget: 32 },
			},
		});
	});

	it.each([
		["empty stream", [], AI_ERROR_CODES.STREAM_PROTOCOL_FAILED],
		[
			"missing finishReason",
			[{ candidates: [{ content: { role: "model", parts: [{ text: "open" }] } }] }],
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"candidate after finishReason",
			[
				{ candidates: [{ finishReason: "STOP" }] },
				{ candidates: [{ content: { role: "model", parts: [{ text: "late" }] } }] },
			],
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"malformed wire chunk",
			[{ candidates: [{ content: { role: "model", parts: [{ text: 42 }] } }] }],
			AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED,
		],
		[
			"failed provider finish reason",
			[{ candidates: [{ finishReason: "SAFETY" }] }],
			AI_ERROR_CODES.TRANSPORT_FAILED,
		],
	] as const)("rejects %s", async (_name, values, code) => {
		const adapter = createGoogleAdapter({ send: async () => chunks(values) });
		await expectNativeFailure(adapter.stream({ model: googleModel, context }), code);
	});

	it("does not call the sender when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const send = vi.fn<GoogleContentSender>();
		const adapter = createGoogleAdapter({ send });

		await expectNativeFailure(
			adapter.stream({ model: googleModel, context, options: { signal: controller.signal } }),
			AI_ERROR_CODES.ABORTED,
		);
		expect(send).not.toHaveBeenCalled();
	});

	it("settles an abort observed while consuming provider chunks", async () => {
		const controller = new AbortController();
		const adapter = createGoogleAdapter({
			send: async () =>
				chunks([{ candidates: [{ finishReason: "STOP" }] }], () => {
					controller.abort();
				}),
		});

		await expectNativeFailure(
			adapter.stream({ model: googleModel, context, options: { signal: controller.signal } }),
			AI_ERROR_CODES.ABORTED,
		);
	});
});

describe("Google Vertex native adapter", () => {
	it("keeps Vertex identity options in transport while sharing the Gemini event reducer", async () => {
		let observedRequest: Parameters<GoogleVertexContentSender>[1] | undefined;
		const send: GoogleVertexContentSender = async (_params, request) => {
			observedRequest = request;
			return chunks([
				{ candidates: [{ content: { role: "model", parts: [{ text: "vertex" }] } }] },
				{ candidates: [{ finishReason: "MAX_TOKENS" }], usageMetadata: { totalTokenCount: 2 } },
			]);
		};
		const adapter = createGoogleVertexAdapter({ send });
		const { result } = await collectNative(
			await adapter.stream({
				model: vertexModel,
				context,
				options: { project: "project", location: "us-central1", thinking: { enabled: true, level: "HIGH" } },
			}),
		);

		expect(result.content).toEqual([{ type: "text", text: "vertex" }]);
		expect(result.stopReason).toBe("length");
		expect(observedRequest?.options).toMatchObject({ project: "project", location: "us-central1" });
	});
});

describe("Google Gemini CLI native adapter", () => {
	it("parses Cloud Code SSE through the shared reducer", async () => {
		const fetch = vi.fn(async () => sseResponse(successfulChunks().map((response) => ({ response }))));
		const { events, result } = await collectNative(
			await googleGeminiCliAdapter.stream({
				model: cliModel,
				context,
				options: { apiKey: cliApiKey, fetch: fetch as typeof globalThis.fetch },
			}),
		);

		expect(events.at(0)?.type).toBe("start");
		expect(events.at(-1)?.type).toBe("done");
		expect(result.content.at(-1)).toMatchObject({ type: "toolCall", name: "lookup" });
		expect(result.usage).toMatchObject({
			input: 7,
			output: 6,
			cacheRead: 3,
			totalTokens: 16,
			cacheUsageReporting: "read-only",
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it.each([
		["malformed SSE JSON", rawSseResponse("data: {bad json}\n\n"), AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED],
		[
			"malformed Cloud Code wrapper",
			sseResponse([{ response: { candidates: [{ content: { parts: [{ text: 42 }] } }] } }]),
			AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED,
		],
		[
			"missing finishReason",
			sseResponse([{ response: { candidates: [{ content: { parts: [{ text: "open" }] } }] } }]),
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
	] as const)("rejects %s", async (_name, providerResponse, code) => {
		await expectNativeFailure(
			googleGeminiCliAdapter.stream({
				model: cliModel,
				context,
				options: {
					apiKey: cliApiKey,
					fetch: vi.fn(async () => providerResponse.clone()) as typeof globalThis.fetch,
				},
			}),
			code,
		);
	});

	it("maps authentication failures and does not retry non-retryable 4xx responses", async () => {
		const fetch = vi.fn(async () => new Response("unauthorized", { status: 401 }));

		await expectNativeFailure(
			googleGeminiCliAdapter.stream({
				model: cliModel,
				context,
				options: { apiKey: cliApiKey, fetch: fetch as typeof globalThis.fetch },
			}),
			AI_ERROR_CODES.AUTHENTICATION_FAILED,
		);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("does not start transport for a pre-aborted request", async () => {
		const controller = new AbortController();
		controller.abort();
		const fetch = vi.fn();

		await expectNativeFailure(
			googleGeminiCliAdapter.stream({
				model: cliModel,
				context,
				options: { apiKey: cliApiKey, signal: controller.signal, fetch: fetch as typeof globalThis.fetch },
			}),
			AI_ERROR_CODES.ABORTED,
		);
		expect(fetch).not.toHaveBeenCalled();
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

async function expectNativeFailure(
	responsePromise: Promise<ModelStreamResponse>,
	code: AIError["code"],
): Promise<void> {
	const response = await responsePromise;
	const settlement = Promise.all([collectEvents(response.events), response.result]);
	await expect(settlement).rejects.toMatchObject({ code } satisfies Partial<AIError>);
}

async function collectEvents(events: AsyncIterable<LanguageModelStreamEvent>): Promise<LanguageModelStreamEvent[]> {
	const result: LanguageModelStreamEvent[] = [];
	for await (const event of events) result.push(event);
	return result;
}

async function* chunks(values: readonly unknown[], onFirstChunk?: () => void): AsyncIterable<unknown> {
	for (let index = 0; index < values.length; index++) {
		yield values[index];
		if (index === 0) onFirstChunk?.();
	}
}

function successfulChunks(): unknown[] {
	return [
		{
			candidates: [
				{ content: { role: "model", parts: [{ text: "reason", thought: true, thoughtSignature: "thought-sig" }] } },
			],
		},
		{
			candidates: [{ content: { role: "model", parts: [{ text: "hello", thoughtSignature: "text-sig" }] } }],
		},
		{
			candidates: [
				{
					content: {
						role: "model",
						parts: [
							{
								functionCall: { id: "call-1", name: "lookup", args: { query: "test" } },
								thoughtSignature: "tool-sig",
							},
						],
					},
				},
			],
		},
		{
			candidates: [{ finishReason: "STOP" }],
			usageMetadata: {
				promptTokenCount: 10,
				cachedContentTokenCount: 3,
				candidatesTokenCount: 2,
				thoughtsTokenCount: 4,
				totalTokenCount: 16,
			},
		},
	];
}

function sseResponse(values: readonly unknown[]): Response {
	return rawSseResponse(values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join(""));
}

function rawSseResponse(body: string): Response {
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function createModel<TApi extends "google-generative-ai" | "google-gemini-cli" | "google-vertex">(
	api: TApi,
	provider: string,
): Model<TApi> {
	return {
		id: "gemini-2.5-pro",
		name: "Gemini Test",
		api,
		provider,
		baseUrl: "https://provider.test",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}
