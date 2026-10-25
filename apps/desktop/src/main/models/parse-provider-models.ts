import type { FetchedProviderModel } from "../../preload/api-types/models.js";
import { MAX_CONTEXT_WINDOW, parseModelContext } from "../../shared/model-context.js";

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() && value.length <= 1024 ? value.trim() : undefined;
}
function capability(raw: Record<string, unknown>, flags: string[], aliases: string[]): boolean {
	if (flags.some((key) => raw[key] === true)) return true;
	const architecture = record(raw.architecture);
	const modalities = record(raw.modalities);
	const values = [raw.capabilities, raw.input_modalities, architecture.input_modalities, modalities.input];
	return values.some((value) =>
		Array.isArray(value)
			? value.some((item) => typeof item === "string" && aliases.includes(item.toLowerCase()))
			: aliases.some((alias) => record(value)[alias] === true),
	);
}
function levels(raw: Record<string, unknown>): string[] {
	const entries = raw.supported_reasoning_levels ?? raw.reasoning_levels ?? raw.reasoning_options;
	if (!Array.isArray(entries)) return [];
	const result: string[] = [];
	const push = (value: unknown) => {
		const name = text(value);
		if (name && name.length <= 64 && !result.includes(name) && result.length < 32) result.push(name);
	};
	for (const entry of entries.slice(0, 64)) {
		if (typeof entry === "string") push(entry);
		else {
			const item = record(entry);
			if (item.type !== undefined && item.type !== "effort") continue;
			push(item.effort ?? item.level ?? item.name ?? item.value);
			if (Array.isArray(item.values)) item.values.slice(0, 32).forEach(push);
		}
	}
	return result;
}

/** Adapt upstream model metadata to our existing model/config contract; unknown capabilities stay unknown. */
export function parseProviderModels(body: unknown): FetchedProviderModel[] {
	const raw = record(body);
	const list = Array.isArray(raw.data) ? raw.data : Array.isArray(raw.models) ? raw.models : [];
	const models = new Map<string, FetchedProviderModel>();
	for (const value of list.slice(0, 10_000)) {
		const entry = record(value);
		const id = text(typeof value === "string" ? value : (entry.id ?? entry.name ?? entry.model));
		if (!id || models.has(id)) continue;
		const model: FetchedProviderModel = { id };
		const name = text(entry.display_name ?? entry.name);
		if (name && name !== id) model.name = name;
		const metadata = parseModelContext(entry);
		Object.assign(model, metadata);
		model.contextWindowSource = metadata.contextWindow ? "api" : "unknown";
		const output = Number(entry.max_tokens ?? entry.max_completion_tokens ?? entry.n_predict);
		if (model.maxTokens === undefined && Number.isSafeInteger(output) && output > 0 && output <= MAX_CONTEXT_WINDOW)
			model.maxTokens = output;
		if (capability(entry, ["vision", "supports_vision"], ["vision", "image", "image-input", "multimodal"]))
			model.input = ["text", "image"];
		if (capability(entry, ["reasoning", "supports_reasoning", "thinking"], ["reasoning", "thinking"]))
			model.reasoning = true;
		const reasoningLevels = levels(entry);
		if (reasoningLevels.length) {
			model.reasoning = true;
			model.reasoningLevels = reasoningLevels;
			const defaultLevel = text(entry.default_reasoning_level ?? entry.defaultReasoningLevel);
			if (defaultLevel && reasoningLevels.includes(defaultLevel)) model.defaultReasoningLevel = defaultLevel;
		}
		models.set(id, model);
	}
	return [...models.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
