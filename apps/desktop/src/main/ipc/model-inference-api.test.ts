import type { IpcRenderer, WebContents, WebUtils } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { createSystemApi } from "../../preload/apis/system.js";
import { MODEL_CONTEXT_SET_CHANNEL } from "../../shared/model-context.js";
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
	const owner = { mainFrame: {}, isDestroyed: () => false } as unknown as WebContents;
	const valid = { sender: owner, senderFrame: owner.mainFrame };
	const dispose = registerSettingsIpc(owner);
	const api = createSystemApi(
		{
			invoke: async (channel: string, ...args: unknown[]) => state.handlers.get(channel)!(valid, ...args),
		} as IpcRenderer,
		{} as WebUtils,
	);
	try {
		await api.models.setInferenceApi("custom", "codex", "openai-completions");
		expect(config.providers.custom.modelOverrides).toEqual({ codex: { api: "openai-completions" } });
		const saved = structuredClone(config);
		expect(() => state.handlers.get(MODEL_INFERENCE_API_SET_CHANNEL)!(valid, "custom", "codex", "invalid")).toThrow();
		expect(config).toEqual(saved);
		await api.models.setInferenceApi("custom", "codex", null);
		expect(config.providers.custom.modelOverrides).toEqual({});
	} finally {
		dispose();
	}
	expect(state.handlers.has(MODEL_INFERENCE_API_SET_CHANNEL)).toBe(false);
});

it("rejects other windows, child frames, detached frames and destroyed owners on every settings channel", async () => {
	let config: ModelsConfig = { providers: { custom: { api: "custom-plugin-wire", models: [{ id: "model" }] } } };
	state.service = new ModelSettingsService({
		readConfig: async () => config,
		writeConfig: async (value) => {
			config = value;
		},
		refreshRegistry: async () => {},
		credentials: { isAvailable: () => true, has: () => false, get: () => undefined, set: () => {}, remove: () => {} },
	});
	let destroyed = false;
	const owner = { mainFrame: {}, isDestroyed: () => destroyed } as unknown as WebContents;
	const valid = { sender: owner, senderFrame: owner.mainFrame };
	const { registerSettingsIpc } = await import("./settings.js");
	const dispose = registerSettingsIpc(owner);
	const channels: [string, unknown[]][] = [
		[MODEL_INFERENCE_API_SET_CHANNEL, ["custom", "model", "openai-responses"]],
		[MODEL_CONTEXT_SET_CHANNEL, ["custom", "model", 32000]],
		["vetta:settings:get-server-url", []],
		["vetta:models:list-presets", []],
		["vetta:models:refresh-preset-models", ["custom", undefined]],
		["vetta:models:refresh-preset-catalog", []],
	];
	try {
		for (const [channel, args] of channels) {
			const handler = state.handlers.get(channel)!;
			const before = structuredClone(config);
			for (const event of [
				{ sender: {}, senderFrame: owner.mainFrame },
				{ sender: owner, senderFrame: {} },
				{ sender: owner, senderFrame: null },
			])
				await expect(Promise.resolve().then(() => handler(event, ...args))).rejects.toThrow(/Untrusted/);
			destroyed = true;
			await expect(Promise.resolve().then(() => handler(valid, ...args))).rejects.toThrow(/Untrusted/);
			destroyed = false;
			expect(config).toEqual(before);
			await handler(valid, ...args);
		}
		expect(config.providers.custom.api).toBe("custom-plugin-wire");
		expect(config.providers.custom.modelOverrides?.model).toEqual({ api: "openai-responses", contextWindow: 32000 });
	} finally {
		dispose();
	}
	expect(state.handlers.size).toBe(0);
});
