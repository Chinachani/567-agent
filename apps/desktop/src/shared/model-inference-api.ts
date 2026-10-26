export const MODEL_INFERENCE_API_SET_CHANNEL = "agent567:models:set-inference-api";
export type ModelInferenceApi = "openai-completions" | "openai-responses";

export function isModelInferenceApi(value: unknown): value is ModelInferenceApi {
	return value === "openai-completions" || value === "openai-responses";
}

export function defaultManagedInferenceApi(modelId: string, group: string, fallback?: string): string {
	let name = group;
	try {
		name = decodeURIComponent(group);
	} catch {
		/* Keep a malformed legacy label readable. */
	}
	return /(?:^|[^a-z0-9])codex(?=$|[^a-z0-9])/i.test(`${modelId} ${name}`)
		? "openai-responses"
		: (fallback ?? "openai-completions");
}
