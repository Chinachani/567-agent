import {
	AI_ERROR_CODES,
	type Api,
	type AssistantMessageEvent,
	type Context,
	getAIErrorDetails,
	isAIError,
	isAssistantMessageTerminalEvent,
} from "../protocol/index.js";
import { createCompatibilityErrorMessage, type LanguageModelAdapter } from "../runtime/language-model-adapter.js";
import { openProtectedModelStream } from "../runtime/stream-resilience.js";
import type { Model, SimpleStreamOptions, StreamOptions } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";

export function projectLegacyProviderStream(
	model: Model<Api>,
	context: Context,
	options: StreamOptions | undefined,
	open: (signal: AbortSignal, context: Context) => AssistantMessageEventStream,
): AssistantMessageEventStream {
	return projectResponse(model, () =>
		openProtectedModelStream({ model, context, options }, (signal, projectedContext) => {
			const source = open(signal, projectedContext);
			return { events: readLegacyEvents(source), result: source.result() };
		}),
	);
}

async function* readLegacyEvents(source: AssistantMessageEventStream): AsyncIterable<AssistantMessageEvent> {
	for await (const event of source) {
		yield event;
		if (isAssistantMessageTerminalEvent(event)) return;
	}
	const message = await source.result();
	const reason = message.stopReason;
	if (reason === "error" || reason === "aborted") yield { type: "error", reason, error: message };
	else yield { type: "done", reason, message };
}

export function projectLanguageModelAdapter<TApi extends Api, TOptions extends StreamOptions>(
	adapter: LanguageModelAdapter<TApi, TOptions>,
	model: Model<TApi>,
	context: Context,
	options?: TOptions,
): AssistantMessageEventStream {
	return projectResponse(model, () => adapter.stream({ model, context, options }));
}

export function projectLanguageModelSimpleAdapter<TApi extends Api>(
	adapter: LanguageModelAdapter<TApi>,
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	return projectResponse(model, () => {
		if (!adapter.streamSimple) throw new Error(`Adapter does not support simple streaming: ${adapter.api}`);
		return adapter.streamSimple({ model, context, options });
	});
}

function projectResponse(
	model: Model<Api>,
	open: () => ReturnType<LanguageModelAdapter["stream"]>,
): AssistantMessageEventStream {
	const target = new AssistantMessageEventStream();
	void forwardResponse(model, open, target);
	return target;
}

async function forwardResponse(
	model: Model<Api>,
	open: () => ReturnType<LanguageModelAdapter["stream"]>,
	target: AssistantMessageEventStream,
): Promise<void> {
	try {
		const response = await open();
		for await (const event of response.events) {
			target.push(event);
			if (event.type === "done" || event.type === "error") return;
		}
	} catch (error) {
		const reason = isAIError(error) && error.code === AI_ERROR_CODES.ABORTED ? "aborted" : "error";
		target.push({
			type: "error",
			reason,
			error: createCompatibilityErrorMessage(model, error, reason),
			...(isAIError(error) ? { failure: getAIErrorDetails(error) } : {}),
		});
	}
}
