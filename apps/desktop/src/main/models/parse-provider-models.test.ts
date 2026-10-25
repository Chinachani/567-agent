import { describe, expect, it } from "vitest";
import { parseProviderModels } from "./parse-provider-models.js";

describe("custom provider metadata", () => {
	it("retains explicit capacities, vision and ordered reasoning levels without guessing missing capabilities", () => {
		const models = parseProviderModels({
			data: [
				{
					id: "vision",
					context_length: "131072",
					max_tokens: 8192,
					architecture: { input_modalities: ["text", "image"] },
					supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
					default_reasoning_level: "high",
				},
				{ id: "unknown", max_tokens: 4096 },
				{ id: "vision", context_length: 999999 },
				{
					id: "bad",
					context_length: Infinity,
					max_tokens: -1,
					reasoning_options: [{ type: "effort", values: ["none", "medium", "medium"] }],
				},
			],
		});
		expect(models).toHaveLength(3);
		expect(models.find((m) => m.id === "vision")).toMatchObject({
			contextWindow: 131072,
			contextWindowSource: "api",
			maxTokens: 8192,
			input: ["text", "image"],
			reasoningLevels: ["low", "high"],
			defaultReasoningLevel: "high",
		});
		expect(models.find((m) => m.id === "unknown")).toEqual({
			id: "unknown",
			contextWindowSource: "unknown",
			maxTokens: 4096,
		});
		expect(models.find((m) => m.id === "bad")).toMatchObject({
			reasoningLevels: ["none", "medium"],
			contextWindowSource: "unknown",
		});
	});
	it("accepts legacy strings and Ollama names, bounds untrusted fields", () => {
		expect(
			parseProviderModels({
				models: ["z", { name: "a", n_ctx: 32768, capabilities: ["thinking"] }, { id: "x".repeat(1025) }, null],
			}),
		).toEqual([
			{ id: "a", contextWindow: 32768, contextWindowSource: "api", reasoning: true },
			{ id: "z", contextWindowSource: "unknown" },
		]);
	});
});
