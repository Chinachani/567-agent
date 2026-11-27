import {
	AI_ERROR_CODES,
	AIAbortedError,
	AIError,
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	createAIErrorFromDetails,
	getAIErrorDetails,
	isAIError,
} from "../protocol/index.js";
import { projectSignedReasoningHistory, repairSignedReasoningHistory } from "../providers/signed-reasoning-history.js";
import type { Model, StreamOptions } from "../types.js";
import { createLinkedAbortSignal, type LinkedAbortSignal } from "../utils/linked-abort-signal.js";
import {
	failLanguageModelStream,
	LanguageModelStream,
	type ModelCallRequest,
	type ModelStreamResponse,
} from "./language-model-adapter.js";
import { normalizeAssistantMessageError, normalizeLegacyProviderError } from "./legacy-error-classifier.js";
import { createModelCallMetadataFromMessage, type ModelCallMetadata } from "./model-call-result.js";

const FIRST_EVENT_TIMEOUT_MS = 120_000;
const IDLE_EVENT_TIMEOUT_MS = 90_000;
const EMPTY_RESPONSE_RETRIES = 1;
const EMPTY_RESPONSE_BACKOFF_MS = 250;

type OpenModelStream = (signal: AbortSignal, context: Context) => ModelStreamResponse | Promise<ModelStreamResponse>;
type AttemptDecision = "failed" | "terminal" | "retry" | "repair";

interface SignatureRecovery {
	repairedSignature: boolean;
	tryRepairSignature(failure: AIError): boolean;
}

interface AttemptRecovery extends Readonly<SignatureRecovery> {
	readonly canRetryEmpty: boolean;
	readonly exhaustedEmpty: boolean;
}

interface StreamAttempt {
	readonly source: ModelStreamResponse;
	readonly abort: LinkedAbortSignal;
	readonly firstDeadline: number | undefined;
	readonly firstTimeout: AIError;
}

export async function openProtectedModelStream(
	{ model, context, options }: ModelCallRequest,
	open: OpenModelStream,
): Promise<ModelStreamResponse> {
	const target = new LanguageModelStream();
	let projectedContext = projectSignedReasoningHistory(context, model);
	const signatureRecovery: SignatureRecovery = {
		repairedSignature: false,
		tryRepairSignature(failure) {
			if (signatureRecovery.repairedSignature || options?.signal?.aborted) return false;
			const repairedContext = repairSignedReasoningHistory(projectedContext, model, failure);
			if (repairedContext === projectedContext) return false;
			projectedContext = repairedContext;
			signatureRecovery.repairedSignature = true;
			return true;
		},
	};
	const start = () => startAttempt(model, options, (signal) => open(signal, projectedContext));
	const openAttempt = async () => {
		try {
			return await start();
		} catch (error) {
			if (isAIError(error) && signatureRecovery.tryRepairSignature(error)) return start();
			throw error;
		}
	};
	let metadata: Promise<ModelCallMetadata>;
	try {
		const firstAttempt = await openAttempt();
		metadata = forwardAttempts(model, options, openAttempt, firstAttempt, target, signatureRecovery);
	} catch (error) {
		if (!isAIError(error) || error.code !== AI_ERROR_CODES.ABORTED) {
			throw stopRetryAfterRepair(error, model, signatureRecovery.repairedSignature);
		}
		failLanguageModelStream(target, model, error);
		metadata = Promise.resolve({});
	}
	void metadata.catch(() => undefined);
	return { events: target, result: target.result(), metadata };
}

async function startAttempt(
	model: Model<Api>,
	options: StreamOptions | undefined,
	open: (signal: AbortSignal) => ReturnType<OpenModelStream>,
): Promise<StreamAttempt> {
	const abort = createLinkedAbortSignal(options?.signal);
	const { signal } = abort;
	const firstDeadline = deadlineAfter(options?.firstEventTimeoutMs ?? FIRST_EVENT_TIMEOUT_MS);
	const firstTimeout = timeoutError(model, "first", true);
	const pending = Promise.resolve()
		.then(() => {
			if (signal.aborted) throw abortedError(model);
			return open(signal);
		})
		.then((source) => {
			void source.result.catch(() => undefined);
			void source.metadata?.catch(() => undefined);
			if (signal.aborted) discardSource(source);
			return source;
		});
	try {
		const source = await waitForStreamActivity(pending, model, signal, firstDeadline, firstTimeout);
		return { source, abort, firstDeadline, firstTimeout };
	} catch (error) {
		abort.abort(error);
		abort.dispose();
		throw normalizeLegacyProviderError(error, model);
	}
}

async function forwardAttempts(
	model: Model<Api>,
	options: StreamOptions | undefined,
	openAttempt: () => Promise<StreamAttempt>,
	firstAttempt: StreamAttempt,
	target: LanguageModelStream,
	signatureRecovery: Readonly<SignatureRecovery>,
): Promise<ModelCallMetadata> {
	const retries = options?.emptyResponseRetries ?? EMPTY_RESPONSE_RETRIES;
	const backoff = options?.emptyResponseBackoffMs ?? EMPTY_RESPONSE_BACKOFF_MS;
	const idleTimeout = options?.idleEventTimeoutMs ?? IDLE_EVENT_TIMEOUT_MS;
	let attempt = firstAttempt;
	let completedRetries = 0;
	while (true) {
		const decision = await forwardAttempt(model, attempt, target, idleTimeout, {
			...signatureRecovery,
			canRetryEmpty:
				!signatureRecovery.repairedSignature && Number.isSafeInteger(retries) && completedRetries < retries,
			exhaustedEmpty: completedRetries > 0,
		});
		if (decision === "failed") return {};
		if (decision === "terminal") {
			return attempt.source.metadata
				? attempt.source.metadata.catch((error) => {
						throw normalizeLegacyProviderError(error, model);
					})
				: target.result().then(createModelCallMetadataFromMessage, () => ({}));
		}
		try {
			if (decision === "retry") {
				completedRetries += 1;
				await waitForRetry(model, backoff, options?.signal);
			}
			attempt = await openAttempt();
		} catch (error) {
			failLanguageModelStream(
				target,
				model,
				stopRetryAfterRepair(error, model, signatureRecovery.repairedSignature),
			);
			return {};
		}
	}
}

async function forwardAttempt(
	model: Model<Api>,
	attempt: StreamAttempt,
	target: LanguageModelStream,
	idleTimeoutMs: number,
	recovery: AttemptRecovery,
): Promise<AttemptDecision> {
	const { signal } = attempt.abort;
	let iterator: AsyncIterator<AssistantMessageEvent> | undefined;
	let partial: AssistantMessage | undefined;
	let bufferedStart: Extract<AssistantMessageEvent, { type: "start" }> | undefined;
	let committed = false;
	const idleTimeout = timeoutError(model, "idle", false);
	const flushStart = () => {
		if (bufferedStart) target.push(bufferedStart);
		bufferedStart = undefined;
	};
	try {
		iterator = attempt.source.events[Symbol.asyncIterator]();
		while (true) {
			if (signal.aborted) throw abortedError(model);
			const next = await waitForStreamActivity(
				Promise.resolve(iterator.next()),
				model,
				signal,
				committed ? deadlineAfter(idleTimeoutMs) : attempt.firstDeadline,
				committed ? idleTimeout : attempt.firstTimeout,
			);
			if (next.done) {
				throw new AIError(AI_ERROR_CODES.STREAM_PROTOCOL_FAILED, "Model stream ended without a terminal event", {
					provider: model.provider,
					modelId: model.id,
				});
			}

			const event = next.value;
			if (event.type === "done" || event.type === "error") {
				const message = event.type === "done" ? event.message : event.error;
				const failure = event.type === "error" ? readEventFailure(event, model) : undefined;
				const replayUnsafe =
					committed || hasResponseOutput(message) || (partial !== undefined && hasResponseOutput(partial));
				const empty = !replayUnsafe && isEmptyTermination(event, failure);
				if (
					!replayUnsafe &&
					event.type === "error" &&
					event.reason === "error" &&
					failure &&
					!signal.aborted &&
					recovery.tryRepairSignature(failure)
				) {
					attempt.abort.abort();
					return "repair";
				}
				if (empty && recovery.canRetryEmpty) {
					attempt.abort.abort();
					return "retry";
				}
				flushStart();
				if (event.type === "error" && failure) {
					const terminalFailure =
						failure.retryable &&
						(recovery.repairedSignature || replayUnsafe || (empty && recovery.exhaustedEmpty))
							? stopRetrying(failure)
							: failure;
					failLanguageModelStream(target, model, terminalFailure, event.reason, event.error);
				} else if (event.type === "done" && recovery.repairedSignature && !empty) {
					target.push({ ...event, message: { ...event.message, signedReasoningReset: true } });
				} else {
					target.push(event);
				}
				return "terminal";
			}

			partial = event.partial;
			if (!committed && event.type === "start" && !hasResponseOutput(partial)) {
				bufferedStart ??= event;
				continue;
			}
			committed = true;
			flushStart();
			target.push(event);
		}
	} catch (error) {
		const normalized = normalizeLegacyProviderError(error, model);
		if (
			!committed &&
			!(partial && hasResponseOutput(partial)) &&
			!signal.aborted &&
			recovery.tryRepairSignature(normalized)
		) {
			attempt.abort.abort();
			return "repair";
		}
		const failure =
			normalized.retryable && (recovery.repairedSignature || committed || (partial && hasResponseOutput(partial)))
				? stopRetrying(normalized)
				: normalized;
		const reason = failure.code === AI_ERROR_CODES.ABORTED ? "aborted" : "error";
		flushStart();
		failLanguageModelStream(
			target,
			model,
			failure,
			reason,
			partial && {
				...partial,
				content: partial.content.map((block) => ({ ...block })),
				usage: { ...partial.usage, cost: { ...partial.usage.cost } },
				stopReason: reason,
				errorMessage: failure.message,
			},
		);
		attempt.abort.abort(failure);
		return "failed";
	} finally {
		attempt.abort.dispose();
		if (iterator) discardIterator(iterator);
	}
}

function readEventFailure(event: Extract<AssistantMessageEvent, { type: "error" }>, model: Model<Api>): AIError {
	return event.failure ? createAIErrorFromDetails(event.failure) : normalizeAssistantMessageError(event.error, model);
}

export function hasResponseOutput(message: AssistantMessage): boolean {
	const usage = message.usage;
	return (
		message.content.length > 0 ||
		usage.input !== 0 ||
		usage.output !== 0 ||
		usage.cacheRead !== 0 ||
		usage.cacheWrite !== 0 ||
		usage.totalTokens !== 0 ||
		Object.values(usage.cost).some((cost) => cost !== 0)
	);
}

function isEmptyTermination(event: AssistantMessageEvent, failure: AIError | undefined): boolean {
	if (event.type === "done") return event.reason === "stop" && event.message.stopReason === "stop";
	return (
		event.type === "error" &&
		event.reason === "error" &&
		failure?.code === AI_ERROR_CODES.STREAM_PROTOCOL_FAILED &&
		(failure.providerCode === "empty_completion" || failure.providerCode === "empty_provider_stream")
	);
}

function stopRetrying(error: AIError): AIError {
	return createAIErrorFromDetails({ ...getAIErrorDetails(error), retryable: false });
}

function stopRetryAfterRepair(error: unknown, model: Model<Api>, repairedSignature: boolean): unknown {
	if (!repairedSignature) return error;
	// An outer turn retry would start over with the rejected history and repeat the repair.
	const failure = normalizeLegacyProviderError(error, model);
	return failure.retryable ? stopRetrying(failure) : failure;
}

function isTimeoutEnabled(timeoutMs: number): boolean {
	return Number.isFinite(timeoutMs) && timeoutMs > 0;
}

function deadlineAfter(timeoutMs: number): number | undefined {
	return isTimeoutEnabled(timeoutMs) ? performance.now() + timeoutMs : undefined;
}

function timeoutError(model: Model<Api>, stage: "first" | "idle", retryable: boolean): AIError {
	return new AIError(
		AI_ERROR_CODES.TIMEOUT,
		stage === "first" ? "Timed out waiting for the model to respond" : "The model stopped sending stream events",
		{ provider: model.provider, modelId: model.id, phase: "stream", retryable, metadata: { stage } },
	);
}

function abortedError(model: Model<Api>): AIAbortedError {
	return new AIAbortedError(undefined, { provider: model.provider, modelId: model.id, phase: "stream" });
}

async function waitForStreamActivity<T>(
	pending: Promise<T>,
	model: Model<Api>,
	signal: AbortSignal,
	deadline: number | undefined,
	timeoutError: AIError,
): Promise<T> {
	let onAbort: (() => void) | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await new Promise<T>((resolve, reject) => {
			onAbort = () => reject(abortedError(model));
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
			if (deadline !== undefined) {
				timer = setTimeout(() => reject(timeoutError), Math.max(0, deadline - performance.now()));
			}
			void pending.then(resolve, reject);
		});
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}

function waitForRetry(model: Model<Api>, delayMs: number, signal: AbortSignal | undefined): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortedError(model));
	if (!isTimeoutEnabled(delayMs)) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortedError(model));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function discardSource(source: ModelStreamResponse): void {
	try {
		discardIterator(source.events[Symbol.asyncIterator]());
	} catch {
		return;
	}
}

function discardIterator(iterator: AsyncIterator<AssistantMessageEvent>): void {
	void Promise.resolve()
		.then(() => iterator.return?.())
		.catch(() => undefined);
}
