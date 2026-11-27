import { contextCapacity, parseModelContext } from "../../shared/model-context.js";
import { getModelContextReference } from "../../shared/model-context-reference.js";
import type { ModelDefinition } from "./model-settings-service.js";

export function parseModelList(value: unknown): ModelDefinition[] {
	const entries = Array.isArray(value) ? value : [];
	return entries.slice(0, 10_000).flatMap((entry: unknown) => {
		const raw = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
		const id = typeof entry === "string" ? entry : (raw.id ?? raw.name ?? raw.model);
		if (typeof id !== "string" || !id.trim() || id.length > 1024) return [];
		const metadata = parseModelContext(raw);
		const modalities = raw.modalities;
		const output =
			raw.output_modalities ??
			raw.output ??
			(typeof modalities === "object" && modalities !== null && "output" in modalities
				? modalities.output
				: undefined);
		return [
			{
				id,
				name: id,
				input: ["text", "image"],
				...(Array.isArray(output) && output.every((value) => typeof value === "string") ? { output } : {}),
				...metadata,
				contextWindowSource: metadata.contextWindow === undefined ? ("unknown" as const) : ("api" as const),
			},
		];
	});
}

export function enrichModelContexts(models: ModelDefinition[], catalog: readonly ModelDefinition[]): ModelDefinition[] {
	return models.map((model) => {
		if (contextCapacity(model.contextWindow) !== undefined) return model;
		const matches = catalog.filter(
			(entry) =>
				(entry.id === model.id || entry.modelId === model.id) && contextCapacity(entry.contextWindow) !== undefined,
		);
		// Identical aliases may have different limits across catalog providers. Use
		// the smallest exact match, never infer an entire family from its name.
		const match = matches.sort((a, b) => (a.contextWindow ?? 0) - (b.contextWindow ?? 0))[0];
		const reference = getModelContextReference(model.id);
		const capacity = reference?.capacity ?? match?.contextWindow;
		return {
			...model,
			...(capacity ? { contextWindow: capacity } : {}),
			contextWindowSource: capacity ? "catalog" : "unknown",
			maxTokens: model.maxTokens ?? match?.maxTokens,
		};
	});
}
