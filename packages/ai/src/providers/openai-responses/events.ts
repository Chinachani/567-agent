import type OpenAI from "openai";
import type { ResponseCreateParamsStreaming, ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { calculateCost } from "../../models.js";
import { EmptyProviderStreamError } from "../../provider-kit/index.js";
import type { LanguageModelStreamEvent } from "../../runtime/language-model-adapter.js";
import type {
	Api,
	AssistantMessage,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	ToolCall,
	Usage,
} from "../../types.js";
import { parseStreamingJson } from "../../utils/json-parse.js";
import { type ItemState, protocolError, ResponsesItemTracker } from "./item-tracker.js";
import { validateResponsesStreamEvent } from "./response-schema.js";

export interface OpenAIResponsesStreamOptions {
	serviceTier?: ResponseCreateParamsStreaming["service_tier"];
	applyServiceTierPricing?: (
		usage: Usage,
		serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
	) => void;
}

export interface ResponsesEventSink {
	push(event: LanguageModelStreamEvent): void;
}

export async function processResponsesStream<TApi extends Api>(
	openaiStream: AsyncIterable<unknown>,
	output: AssistantMessage,
	stream: ResponsesEventSink,
	model: Model<TApi>,
	options?: OpenAIResponsesStreamOptions,
): Promise<void> {
	const itemTracker = new ResponsesItemTracker(model);
	let receivedProviderEvent = false;
	let receivedTerminalEvent = false;

	for await (const value of openaiStream) {
		if (receivedTerminalEvent) throw protocolError(model, "Provider emitted an event after its terminal response");
		receivedProviderEvent = true;
		const event = validateResponsesStreamEvent(value, model.provider);

		if (event.type === "response.output_item.added") {
			const item = event.item;
			if (item.type === "reasoning") {
				const block: ThinkingContent = { type: "thinking", thinking: "" };
				output.content.push(block);
				itemTracker.add(event, { kind: "reasoning", blockIndex: output.content.length - 1 });
				stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
			} else if (item.type === "message") {
				const block: TextContent = { type: "text", text: "" };
				output.content.push(block);
				itemTracker.add(event, { kind: "message", blockIndex: output.content.length - 1 });
				stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
			} else if (item.type === "function_call") {
				const block: ToolCall = {
					type: "toolCall",
					id: `${item.call_id}|${item.id}`,
					name: item.name,
					arguments: parseStreamingJson(item.arguments || ""),
				};
				output.content.push(block);
				itemTracker.add(event, {
					kind: "function_call",
					blockIndex: output.content.length - 1,
					partialJson: item.arguments || "",
				});
				stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
			}
		} else if (event.type === "response.reasoning_summary_text.delta") {
			const state = itemTracker.require(event, "reasoning");
			const block = output.content[state.blockIndex];
			if (block?.type !== "thinking") throw protocolError(model, "Reasoning block state is inconsistent");
			block.thinking += event.delta;
			stream.push({
				type: "thinking_delta",
				contentIndex: state.blockIndex,
				delta: event.delta,
				partial: output,
			});
		} else if (event.type === "response.reasoning_summary_part.done") {
			const state = itemTracker.require(event, "reasoning");
			const block = output.content[state.blockIndex];
			if (block?.type !== "thinking") throw protocolError(model, "Reasoning block state is inconsistent");
			block.thinking += "\n\n";
			stream.push({
				type: "thinking_delta",
				contentIndex: state.blockIndex,
				delta: "\n\n",
				partial: output,
			});
		} else if (event.type === "response.content_part.added") {
			itemTracker.require(event, "message");
		} else if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
			const state = itemTracker.require(event, "message");
			const block = output.content[state.blockIndex];
			if (block?.type !== "text") throw protocolError(model, "Text block state is inconsistent");
			block.text += event.delta;
			stream.push({ type: "text_delta", contentIndex: state.blockIndex, delta: event.delta, partial: output });
		} else if (event.type === "response.function_call_arguments.delta") {
			const state = itemTracker.require(event, "function_call");
			state.partialJson += event.delta;
			const block = output.content[state.blockIndex];
			if (block?.type !== "toolCall") throw protocolError(model, "Tool call block state is inconsistent");
			block.arguments = parseStreamingJson(state.partialJson);
			stream.push({
				type: "toolcall_delta",
				contentIndex: state.blockIndex,
				delta: event.delta,
				partial: output,
			});
		} else if (event.type === "response.function_call_arguments.done") {
			const state = itemTracker.require(event, "function_call");
			state.partialJson = event.arguments;
			const block = output.content[state.blockIndex];
			if (block?.type !== "toolCall") throw protocolError(model, "Tool call block state is inconsistent");
			block.arguments = parseStreamingJson(event.arguments);
		} else if (event.type === "response.output_item.done") {
			const state = itemTracker.take(event);
			finalizeOutputItem(event, state, output, stream, model);
		} else if (event.type === "response.completed" || event.type === "response.incomplete") {
			if (model.provider === "ollama" && event.type === "response.completed") {
				completeOllamaTextItems(event.response, itemTracker, output, stream, model);
			}
			if (itemTracker.size > 0) {
				throw protocolError(model, "Response completed with unfinished output items", {
					outputIndexes: itemTracker.outputIndexes,
				});
			}
			applyCompletedResponse(event.response, output, model, options);
			receivedTerminalEvent = true;
		} else if (event.type === "error") {
			throw Object.assign(new Error(event.message), {
				...(event.code ? { code: event.code } : {}),
				responseBody: { error: { code: event.code, message: event.message, param: event.param } },
			});
		} else if (event.type === "response.failed") {
			const providerError = event.response.error;
			throw Object.assign(new Error(providerError?.message || "OpenAI Responses request failed"), {
				...(providerError?.code ? { code: providerError.code } : {}),
				...(providerError ? { responseBody: { error: providerError } } : {}),
			});
		}
	}

	if (!receivedProviderEvent) throw new EmptyProviderStreamError();
	if (!receivedTerminalEvent) throw protocolError(model, "Stream ended without a terminal response event");
}

function finalizeOutputItem<TApi extends Api>(
	event: Extract<ResponseStreamEvent, { type: "response.output_item.done" }>,
	state: ItemState,
	output: AssistantMessage,
	stream: ResponsesEventSink,
	model: Model<TApi>,
): void {
	const item = event.item;
	if (item.type === "reasoning" && state.kind === "reasoning") {
		const block = output.content[state.blockIndex];
		if (block?.type !== "thinking") throw protocolError(model, "Reasoning block state is inconsistent");
		block.thinking = item.summary?.map((summary) => summary.text).join("\n\n") || block.thinking;
		block.thinkingSignature = JSON.stringify(item);
		stream.push({ type: "thinking_end", contentIndex: state.blockIndex, content: block.thinking, partial: output });
		return;
	}
	if (item.type === "message" && state.kind === "message") {
		const block = output.content[state.blockIndex];
		if (block?.type !== "text") throw protocolError(model, "Text block state is inconsistent");
		block.text = item.content
			.map((content) =>
				content.type === "output_text" ? content.text : content.type === "refusal" ? content.refusal : "",
			)
			.join("");
		block.textSignature = item.id;
		stream.push({ type: "text_end", contentIndex: state.blockIndex, content: block.text, partial: output });
		return;
	}
	if (item.type === "function_call" && state.kind === "function_call") {
		const toolCall: ToolCall = {
			type: "toolCall",
			id: `${item.call_id}|${item.id}`,
			name: item.name,
			arguments: parseStreamingJson(state.partialJson || item.arguments || "{}"),
		};
		output.content[state.blockIndex] = toolCall;
		stream.push({ type: "toolcall_end", contentIndex: state.blockIndex, toolCall, partial: output });
		return;
	}
	throw protocolError(model, "Output item type changed while streaming", {
		expected: state.kind,
		actual: item.type,
	});
}

// Ollama 0.40.2 omits message.done when text precedes tool calls. Recover
// only an already-streamed text item whose unique terminal snapshot agrees.
// Never synthesize a tool call or accept a truncated stream as completed.
function completeOllamaTextItems<TApi extends Api>(
	response: Extract<ResponseStreamEvent, { type: "response.completed" }>["response"],
	tracker: ResponsesItemTracker<TApi>,
	output: AssistantMessage,
	stream: ResponsesEventSink,
	model: Model<TApi>,
): void {
	if (response.status !== "completed" || !Array.isArray(response.output)) return;
	for (const state of tracker.items) {
		if (state.kind !== "message" || !state.itemId) continue;
		const matches = response.output.filter((item) => item && item.id === state.itemId);
		if (matches.length !== 1) continue;
		const item = matches[0];
		if (item?.type !== "message" || item.status !== "completed" || item.role !== "assistant") continue;
		const done = validateResponsesStreamEvent(
			{ type: "response.output_item.done", output_index: state.outputIndex, item },
			model.provider,
		);
		if (done.type !== "response.output_item.done" || done.item.type !== "message") continue;
		const block = output.content[state.blockIndex];
		const text = done.item.content
			.map((part) => (part.type === "output_text" ? part.text : part.type === "refusal" ? part.refusal : ""))
			.join("");
		if (block?.type !== "text" || block.text !== text) continue;
		finalizeOutputItem(done, tracker.take(done), output, stream, model);
	}
}

function applyCompletedResponse<TApi extends Api>(
	response: Extract<ResponseStreamEvent, { type: "response.completed" | "response.incomplete" }>["response"],
	output: AssistantMessage,
	model: Model<TApi>,
	options?: OpenAIResponsesStreamOptions,
): void {
	if (response.usage) {
		const reportedCachedTokens = response.usage.input_tokens_details?.cached_tokens;
		const cachedTokens = reportedCachedTokens || 0;
		output.usage = {
			input: (response.usage.input_tokens || 0) - cachedTokens,
			output: response.usage.output_tokens || 0,
			cacheRead: cachedTokens,
			cacheWrite: 0,
			totalTokens: response.usage.total_tokens || 0,
			cacheUsageReporting: reportedCachedTokens === undefined ? "unavailable" : "read-only",
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
	}
	calculateCost(model, output.usage);
	options?.applyServiceTierPricing?.(output.usage, response.service_tier ?? options.serviceTier);
	output.stopReason = mapStopReason(response.status);
	if (output.content.some((block) => block.type === "toolCall") && output.stopReason === "stop") {
		output.stopReason = "toolUse";
	}
}

function mapStopReason(status: OpenAI.Responses.ResponseStatus | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
		case "in_progress":
		case "queued":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		default: {
			const exhaustive: never = status;
			throw new Error(`Unhandled stop reason: ${exhaustive}`);
		}
	}
}
