import {
	AI_ERROR_CODES,
	AIError,
	type AIErrorCode,
	type Api,
	type AssistantMessageEvent,
	createAIErrorFromDetails,
} from "../protocol/index.js";
import type { Model } from "../types.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import { getDefaultAdapterRegistry } from "./default-adapter-registry.js";
import type { ModelCallRequest, ModelGenerateResponse, ModelStreamResponse } from "./language-model-adapter.js";
import { normalizeLegacyProviderError } from "./legacy-error-classifier.js";
import { collectModelCallResult } from "./model-call-result.js";
import { resolveEffectiveModelCapabilities } from "./model-capabilities.js";
import { hasResponseOutput } from "./stream-resilience.js";

export interface ModelRouteCandidate {
	readonly model: Model<Api>;
	readonly reason?: string;
}

export interface ModelRoutePolicy {
	readonly fallbackCodes?: readonly AIErrorCode[];
	readonly maxCandidates?: number;
	/** Overrides the connection and first model output deadline. */
	readonly firstEventTimeoutMs?: number;
	/** Optional watchdog between provider events after the stream starts. */
	readonly idleEventTimeoutMs?: number;
	/** Retries only a terminal empty response with no usage or content. */
	readonly emptyResponseRetries?: number;
	/** Base delay between empty-response recovery attempts. */
	readonly emptyResponseBackoffMs?: number;
}

export interface ModelRouteResult {
	readonly model: Model<Api>;
	readonly response: ModelStreamResponse;
}

export class ModelRouter {
	readonly #registry: AdapterRegistry;

	constructor(registry: AdapterRegistry = getDefaultAdapterRegistry()) {
		this.#registry = registry;
	}

	resolve(
		candidates: readonly ModelRouteCandidate[],
		policy: ModelRoutePolicy = {},
		mode: "stream" | "generate" = "stream",
	): ModelRouteCandidate[] {
		const limit = policy.maxCandidates ?? candidates.length;
		return candidates
			.filter(({ model }) => this.#registry.get(model.api) !== undefined)
			.filter(({ model }) => {
				const adapter = this.#registry.get(model.api);
				return mode === "generate" || resolveEffectiveModelCapabilities(model, adapter?.capabilities).streaming;
			})
			.slice(0, limit);
	}

	async stream(
		request: ModelCallRequest,
		alternatives: readonly ModelRouteCandidate[] = [],
		policy: ModelRoutePolicy = {},
	): Promise<ModelRouteResult> {
		const candidates = this.resolve([{ model: request.model }, ...alternatives], policy, "stream");
		if (candidates.length === 0) throw this.noCandidate(request.model);

		let lastError: unknown;
		for (const candidate of candidates) {
			try {
				const source = await this.#registry.get(candidate.model.api)!.stream({
					...request,
					model: candidate.model,
					options: {
						...request.options,
						firstEventTimeoutMs: policy.firstEventTimeoutMs ?? request.options?.firstEventTimeoutMs,
						idleEventTimeoutMs: policy.idleEventTimeoutMs ?? request.options?.idleEventTimeoutMs,
						emptyResponseRetries: policy.emptyResponseRetries ?? request.options?.emptyResponseRetries,
						emptyResponseBackoffMs: policy.emptyResponseBackoffMs ?? request.options?.emptyResponseBackoffMs,
					},
				});
				const response = await prepareRoutedStream(candidate.model, source);
				return { model: candidate.model, response };
			} catch (error) {
				lastError = error;
				if (!isFallbackError(error, policy)) throw error;
			}
		}
		throw lastError ?? this.noCandidate(request.model);
	}

	async generate(
		request: ModelCallRequest,
		alternatives: readonly ModelRouteCandidate[] = [],
		policy: ModelRoutePolicy = {},
	): Promise<{ model: Model<Api>; response: ModelGenerateResponse }> {
		const candidates = this.resolve([{ model: request.model }, ...alternatives], policy, "generate");
		if (candidates.length === 0) throw this.noCandidate(request.model);

		let lastError: unknown;
		for (const candidate of candidates) {
			try {
				const adapter = this.#registry.get(candidate.model.api)!;
				if (adapter.generate) {
					const response = await adapter.generate({ ...request, model: candidate.model });
					await response.result;
					return { model: candidate.model, response };
				}
				const stream = await adapter.stream({ ...request, model: candidate.model });
				const response = { result: collectModelCallResult(stream) };
				await response.result;
				return { model: candidate.model, response };
			} catch (error) {
				lastError = error;
				if (!isFallbackError(error, policy)) throw error;
			}
		}
		throw lastError ?? this.noCandidate(request.model);
	}

	private noCandidate(model: Model<Api>): AIError {
		return new AIError(
			AI_ERROR_CODES.UNSUPPORTED_CAPABILITY,
			`No usable model route for ${model.provider}/${model.id}`,
			{
				provider: model.provider,
				modelId: model.id,
				metadata: { api: model.api },
			},
		);
	}
}

/**
 * Holds lifecycle-only events until a candidate either emits model output or
 * fails. This is the routing commit point: after output is visible, switching
 * providers would duplicate or splice one assistant response across models.
 */
async function prepareRoutedStream(model: Model<Api>, source: ModelStreamResponse): Promise<ModelStreamResponse> {
	const iterator = source.events[Symbol.asyncIterator]();
	const buffered: AssistantMessageEvent[] = [];
	void source.result.catch(() => undefined);

	try {
		while (true) {
			const next = await iterator.next();
			if (next.done) {
				throw new AIError(AI_ERROR_CODES.STREAM_PROTOCOL_FAILED, "Model stream ended without a terminal event", {
					provider: model.provider,
					modelId: model.id,
				});
			}
			const event = next.value;
			if (event.type === "error" && !hasResponseOutput(event.error)) {
				throw event.failure
					? createAIErrorFromDetails(event.failure)
					: normalizeLegacyProviderError(new Error(event.error.errorMessage || "Model call failed"), model);
			}
			buffered.push(event);
			if (event.type !== "start" || hasResponseOutput(event.partial)) {
				return { ...source, events: resumeRoutedStream(buffered, iterator) };
			}
		}
	} catch (error) {
		await iterator.return?.();
		throw error;
	}
}

async function* resumeRoutedStream(
	buffered: readonly AssistantMessageEvent[],
	iterator: AsyncIterator<AssistantMessageEvent>,
): AsyncIterable<AssistantMessageEvent> {
	try {
		yield* buffered;
		while (true) {
			const next = await iterator.next();
			if (next.done) return;
			yield next.value;
		}
	} finally {
		await iterator.return?.();
	}
}

function isFallbackError(error: unknown, policy: ModelRoutePolicy): boolean {
	if (!policy.fallbackCodes || policy.fallbackCodes.length === 0) return false;
	return (
		error instanceof AIError && error.code !== AI_ERROR_CODES.ABORTED && policy.fallbackCodes.includes(error.code)
	);
}
