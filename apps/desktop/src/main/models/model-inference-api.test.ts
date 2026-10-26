import { describe, expect, it } from "vitest";
import { ModelSettingsService, type ModelsConfig, normalizeModelsConfig } from "./model-settings-service.js";

describe("per-model inference protocol", () => {
	it("defaults only trusted managed Codex models or groups to Responses", () => {
		const config: ModelsConfig = {
			providers: {
				"567api": {
					api: "openai-completions",
					baseUrl: "https://api.567.wiki/v1",
					headers: { "X-567-Group": "default" },
					models: [{ id: "gpt-5.3-codex" }, { id: "gemini-3.8-flash" }],
				},
				"567api_codex": {
					api: "openai-completions",
					baseUrl: "https://api.567.wiki/v1",
					headers: { "X-567-Group": encodeURIComponent("Codex 专线") },
					models: [{ id: "gpt-5.4" }],
				},
				"567api_custom": {
					api: "openai-completions",
					baseUrl: "https://private.test/v1",
					headers: { "X-567-Group": "Codex" },
					models: [{ id: "gpt-5.3-codex" }],
				},
				custom: { api: "openai-completions", baseUrl: "https://other.test/v1", models: [{ id: "gpt-5.3-codex" }] },
			},
		};
		const result = normalizeModelsConfig(config, "https://api.567.wiki", []);
		expect(result.providers["567api"].models?.map((model) => model.api)).toEqual([
			"openai-responses",
			"openai-completions",
		]);
		expect(result.providers["567api_codex"].models?.[0].api).toBe("openai-responses");
		expect(result.providers["567api_custom"].models?.[0].api).toBeUndefined();
		expect(result.providers.custom.models?.[0].api).toBeUndefined();
		expect(config.providers["567api"].models?.[0].api).toBeUndefined();
	});

	it("keeps a saved protocol across stale catalog writes and restart, then restores automatic without reviving it", async () => {
		let config: ModelsConfig = {
			providers: {
				custom: {
					api: "openai-responses",
					models: [{ id: "codex" }],
					modelOverrides: { codex: { contextWindow: 64000 } },
				},
			},
		};
		const options = {
			readConfig: async () => config,
			writeConfig: async (next: ModelsConfig) => {
				config = next;
			},
			refreshRegistry: async () => {},
			credentials: {
				isAvailable: () => true,
				has: () => false,
				get: () => undefined,
				set: () => {},
				remove: () => {},
			},
		};
		const service = new ModelSettingsService(options);
		const stale = await service.getRendererConfig();
		await service.setInferenceApi("custom", "codex", "openai-completions");
		await service.replaceConfig(stale);
		const restarted = new ModelSettingsService(options);
		const saved = await restarted.getRendererConfig();
		expect(saved.providers.custom.modelOverrides?.codex).toEqual({ contextWindow: 64000, api: "openai-completions" });
		await restarted.setInferenceApi("custom", "codex", null);
		await restarted.replaceConfig(saved);
		expect((await restarted.getRendererConfig()).providers.custom.modelOverrides?.codex).toEqual({
			contextWindow: 64000,
		});
		await expect(restarted.setInferenceApi("custom", "missing", "openai-responses")).rejects.toThrow();
	});
});
