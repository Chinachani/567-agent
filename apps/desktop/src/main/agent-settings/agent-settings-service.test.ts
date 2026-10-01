import { describe, expect, it } from "vitest";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import { AgentSettingsService } from "./agent-settings-service.js";

function createConfig(): DesktopConfig {
	return {
		projects: [],
		archivedProjects: [],
		workspacePath: "C:\\workspace",
		defaultExecutionMode: "full-access",
		notificationsEnabled: true,
		experimental: { vettaCli: false, promptPrediction: false, agentSkills: true },
		imageGeneration: {},
	};
}

function createConfigStore(initial: DesktopConfig) {
	let config = initial;
	return {
		readConfig: async () => config,
		updateConfig: async (mutate: (config: DesktopConfig) => DesktopConfig | Promise<DesktopConfig>) => {
			config = await mutate(config);
			return config;
		},
		getConfig: () => config,
	};
}

describe("AgentSettingsService", () => {
	it("returns normalized experimental defaults", async () => {
		const store = createConfigStore({ ...createConfig(), experimental: undefined });
		const service = new AgentSettingsService({
			...store,
		});

		await expect(service.getExperimental()).resolves.toEqual({
			vettaCli: true,
			promptPrediction: false,
			agentSkills: true,
		});
	});

	it("atomically merges a partial update without dropping adjacent config", async () => {
		const store = createConfigStore(createConfig());
		const service = new AgentSettingsService({
			...store,
		});

		await expect(service.setExperimental({ promptPrediction: true })).resolves.toEqual({
			vettaCli: false,
			promptPrediction: true,
			agentSkills: true,
		});
		expect(store.getConfig()).toEqual({
			...createConfig(),
			experimental: { vettaCli: false, promptPrediction: true, agentSkills: true },
		});
	});

	it("merges and clears image provider preferences without dropping other settings", async () => {
		const store = createConfigStore({
			...createConfig(),
			imageGeneration: { textToImageProviderId: "remote:images" },
		});
		const service = new AgentSettingsService({
			...store,
		});

		await expect(service.setImageGeneration({ imageToImageProviderId: "remote:edit" })).resolves.toEqual({
			textToImageProviderId: "remote:images",
			imageToImageProviderId: "remote:edit",
		});
		await expect(service.setImageGeneration({ textToImageProviderId: null })).resolves.toEqual({
			imageToImageProviderId: "remote:edit",
		});
		expect(store.getConfig()).toEqual({
			...createConfig(),
			imageGeneration: { imageToImageProviderId: "remote:edit" },
		});
	});

	it("stores model preferences with their provider and clears stale models when the provider changes", async () => {
		const store = createConfigStore({
			...createConfig(),
			imageGeneration: {
				textToImageProviderId: "cpa:images",
				textToImageModelId: "codex/gpt-image-2",
			},
		});
		const service = new AgentSettingsService({
			...store,
		});

		await expect(
			service.setImageGeneration({
				textToImageProviderId: "other:images",
			}),
		).resolves.toEqual({ textToImageProviderId: "other:images" });
		await expect(
			service.setImageGeneration({
				textToImageProviderId: "cpa:images",
				textToImageModelId: "antigravity/gemini-image",
			}),
		).resolves.toEqual({
			textToImageProviderId: "cpa:images",
			textToImageModelId: "antigravity/gemini-image",
		});
	});
});
