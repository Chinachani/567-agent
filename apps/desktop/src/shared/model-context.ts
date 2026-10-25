import { getModelContextReference } from "./model-context-reference.js";

export const MODEL_CONTEXT_SET_CHANNEL = "agent567:models:set-context-window";
export const MAX_CONTEXT_WINDOW = 10_000_000;
export type ModelContextSource = "manual" | "api" | "catalog" | "unknown";

export function contextCapacity(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1024 && value <= MAX_CONTEXT_WINDOW
		? value
		: undefined;
}

export function parseContextCapacityInput(value: string): number | undefined {
	const match = /^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(ki|mi|k|m)?$/i.exec(value.trim().replaceAll("，", ","));
	if (!match) return undefined;
	const multiplier = { k: 1_000, m: 1_000_000, ki: 1024, mi: 1048576 }[match[2]?.toLowerCase() ?? ""] ?? 1;
	return contextCapacity(Number(match[1].replaceAll(",", "")) * multiplier);
}

interface ContextModel {
	id: string;
	contextWindow?: number;
	contextWindowSource?: ModelContextSource;
}

export function resolveModelContext(
	model: ContextModel | undefined,
	override?: Record<string, unknown>,
): { capacity?: number; source: ModelContextSource; manual?: number } {
	const manual = contextCapacity(override?.contextWindow);
	if (manual !== undefined) return { capacity: manual, source: "manual", manual };
	const capacity = contextCapacity(model?.contextWindow);
	if (capacity === undefined || model?.contextWindowSource === "unknown") {
		const reference = model && getModelContextReference(model.id);
		return reference?.capacity ? { capacity: reference.capacity, source: "catalog" } : { source: "unknown" };
	}
	return { capacity, source: model?.contextWindowSource ?? "manual" };
}

function object(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function tokenLimit(value: unknown): number | undefined {
	const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
	return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_CONTEXT_WINDOW
		? parsed
		: undefined;
}

/** Only explicit input/context fields count; max_tokens alone describes output. */
export function parseModelContext(value: unknown): { contextWindow?: number; maxTokens?: number } {
	const raw = object(value);
	const info = object(raw.model_info);
	const top = object(raw.top_provider);
	const limit = object(raw.limit);
	const candidates = [
		raw.context_window,
		raw.contextWindow,
		raw.context_length,
		raw.max_context_length,
		raw.max_model_len,
		raw.context_size,
		raw.n_ctx,
		raw.max_input_tokens,
		raw.inputTokenLimit,
		top.context_length,
		info.max_input_tokens,
		limit.context,
	];
	const contextWindow = candidates
		.map((value) => contextCapacity(tokenLimit(value)))
		.find((item) => item !== undefined);
	const output = [raw.max_output_tokens, raw.outputTokenLimit, info.max_output_tokens, limit.output]
		.map(tokenLimit)
		.find((item) => item !== undefined);
	return {
		...(contextWindow === undefined ? {} : { contextWindow }),
		...(output === undefined ? {} : { maxTokens: output }),
	};
}
