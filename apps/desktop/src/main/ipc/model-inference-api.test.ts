import type { IpcRenderer, WebUtils } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { createSystemApi } from "../../preload/apis/system.js";
import { MODEL_INFERENCE_API_SET_CHANNEL } from "../../shared/model-inference-api.js";
import { ModelSettingsService, type ModelsConfig } from "../models/model-settings-service.js";

const state = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	service: undefined as ModelSettingsService | undefined,
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (key: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(key, handler),
		removeHandler: (key: string) => state.handlers.delete(key),
	},
}));
vi.mock("../models/model-settings-host.js", () => ({ getDesktopModelSettingsService: () => state.service }));
vi.mock("../agent-settings/settings-document-store.js", () => ({
	readAgentSettingsDocument: () => ({}),
	updateAgentSettingsDocument: () => {},
}));
vi.mock("../models/presets/sync.js", () => ({
	listPresetProviders: () => ({}),
	refreshPresetCatalog: () => ({}),
	refreshPresetModels: () => [],
	startPresetModelsAutoSync: () => () => {},
}));
beforeEach(() => state.handlers.clear());
it("validates protocol IPC and persists only the selected model through the real settings service", async () => {
	let config: ModelsConfig = {
		providers: { custom: { api: "openai-responses", models: [{ id: "codex" }, { id: "other" }] } },
	};
	state.service = new ModelSettingsService({
		readConfig: async () => config,
		writeConfig: async (value) => {
			config = value;
		},
		refreshRegistry: async () => {},
		credentials: { isAvailable: () => true, has: () => false, get: () => undefined, set: () => {}, remove: () => {} },
	});
	const { registerSettingsIpc } = await import("./settings.js");
	const dispose = registerSettingsIpc();
	const api = createSystemApi(
		{
			invoke: async (channel: string, ...args: unknown[]) => state.handlers.get(channel)!({}, ...args),
		} as IpcRenderer,
		{} as WebUtils,
	);
	try {
		await api.models.setInferenceApi("custom", "codex", "openai-completions");
		expect(config.providers.custom.modelOverrides).toEqual({ codex: { api: "openai-completions" } });
		const saved = structuredClone(config);
		expect(() => state.handlers.get(MODEL_INFERENCE_API_SET_CHANNEL)!({}, "custom", "codex", "invalid")).toThrow();
		expect(config).toEqual(saved);
		await api.models.setInferenceApi("custom", "codex", null);
		expect(config.providers.custom.modelOverrides).toEqual({});
	} finally {
		dispose();
	}
	expect(state.handlers.has(MODEL_INFERENCE_API_SET_CHANNEL)).toBe(false);
});
