import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcRenderer } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Api567Api } from "../../preload/api-types/567api.js";

const state = vi.hoisted(() => ({
	home: "",
	listedModels: ["gemini-3.8-flash-high", "gemini-3-flash"],
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("node:https", async () => {
	const { EventEmitter } = await import("node:events");
	const { PassThrough } = await import("node:stream");
	return {
		default: {
			request: (url: URL, _options: unknown, receive: (response: unknown) => void) => {
				const request = new EventEmitter();
				return Object.assign(request, {
					write() {},
					destroy(error: Error) {
						request.emit("error", error);
					},
					end() {
						const data = url.pathname.startsWith("/api/token")
							? {
									items: [
										{
											id: 1,
											status: 1,
											name: "567 Agent [反重力Gemini]",
											group: "反重力Gemini",
											key: "sk-fixture-model-key-long-enough",
										},
									],
								}
							: state.listedModels.map((id) => ({ id, context_window: 64000 }));
						const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
						queueMicrotask(() => {
							receive(response);
							response.end(JSON.stringify({ success: true, data }));
						});
					},
				});
			},
		},
	};
});
vi.mock("../models/presets/sync.js", () => ({ listPresetProviders: async () => ({ providers: [] }) }));
vi.mock("@567agent/action-rpc", () => ({ getAgent567HomePath: () => state.home }));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(channel, handler),
		removeHandler: (channel: string) => state.handlers.delete(channel),
	},
	BrowserWindow: { getAllWindows: () => [] },
	safeStorage: {
		isEncryptionAvailable: () => true,
		getSelectedStorageBackend: () => "gnome_libsecret",
		encryptString: (value: string) => Buffer.from(value),
		decryptString: (value: Buffer) => value.toString(),
	},
}));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock("../models/model-settings-host.js", () => ({
	getDesktopModelSettingsService: () => ({
		getConfig: async () => JSON.parse(readFileSync(join(state.home, "models.json"), "utf8")),
		replaceConfig: async (config: unknown) => writeFileSync(join(state.home, "models.json"), JSON.stringify(config)),
	}),
}));

let api: Api567Api;
beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	state.home = mkdtempSync(join(tmpdir(), "567-active-model-"));
	state.handlers.clear();
	state.listedModels = ["gemini-3.8-flash-high", "gemini-3-flash"];
	writeFileSync(
		join(state.home, "567api-session.json"),
		JSON.stringify({
			isLoggedIn: true,
			accessToken: "fixture-account",
			username: "fixture-user",
			groups: [
				{ name: "反重力Gemini", ratio: 1 },
				{ name: "chat GPT pro", ratio: 1 },
			],
		}),
	);
	writeFileSync(
		join(state.home, "models.json"),
		JSON.stringify({
			defaultModel: "567api_gpt_pro/gpt-test",
			providers: {
				"567api_gpt_pro": { apiKey: "fixture-gpt", models: [{ id: "gpt-test" }] },
				"567api_gemini_sale": {
					apiKey: "fixture-gemini",
					modelOverrides: { "gemini-3-flash": { contextWindow: 64000, api: "openai-responses" } },
					models: [{ id: "gemini-3.8-flash-high" }, { id: "gemini-3-flash" }],
				},
			},
		}),
	);
	const { register567ApiIpc } = await import("./ipc.js");
	const { create567Api } = await import("../../preload/apis/567api.js");
	register567ApiIpc();
	api = create567Api({
		invoke: async (channel: string, ...args: unknown[]) => state.handlers.get(channel)!({}, ...args),
	} as IpcRenderer).api567;
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	rmSync(state.home, { recursive: true, force: true });
});

it("selects the exact primary model through preload and IPC, persists it and reports it after a reload", async () => {
	expect(await api.setActiveGroup("反重力Gemini", "gemini-3-flash")).toMatchObject({ success: true });
	const saved = JSON.parse(readFileSync(join(state.home, "models.json"), "utf8"));
	expect(saved.defaultModel).toBe("567api_gemini_sale/gemini-3-flash");
	expect(saved.providers["567api_gemini_sale"].modelOverrides["gemini-3-flash"].contextWindow).toBe(64000);
	expect(await api.getStatus()).toMatchObject({ activeGroup: "反重力Gemini", activeModel: "gemini-3-flash" });
	vi.resetModules();
	const restored = (await import("./newapi-service.js")).NewApiService.getInstance();
	expect(await restored.getStatus()).toMatchObject({ activeGroup: "反重力Gemini", activeModel: "gemini-3-flash" });
});

it("rejects a model outside the chosen group without changing the saved default", async () => {
	expect(await api.setActiveGroup("反重力Gemini", "gpt-test")).toMatchObject({ success: false });
	expect(JSON.parse(readFileSync(join(state.home, "models.json"), "utf8"))).toMatchObject({
		defaultModel: "567api_gpt_pro/gpt-test",
	});
});

it("keeps primary and image choices independent across a reload", async () => {
	await api.setActiveGroup("反重力Gemini", "gemini-3-flash");
	await api.setImageGroup("画图");
	await api.setImageModel("fixture-image");
	vi.resetModules();
	const restored = (await import("./newapi-service.js")).NewApiService.getInstance();
	expect(await restored.getStatus()).toMatchObject({
		activeGroup: "反重力Gemini",
		activeModel: "gemini-3-flash",
		imageGroup: "画图",
		imageModel: "fixture-image",
	});
});

it("preserves a selected model on refresh and replaces it only when that model is removed", async () => {
	await api.setActiveGroup("反重力Gemini", "gemini-3-flash");
	expect(await api.syncGroup("反重力Gemini")).toMatchObject({ success: true });
	expect((await api.getStatus()).activeModel).toBe("gemini-3-flash");
	state.listedModels = ["gemini-3.8-flash-high"];
	expect(await api.syncGroup("反重力Gemini")).toMatchObject({ success: true });
	expect((await api.getStatus()).activeModel).toBe("gemini-3.8-flash-high");
});

it("keeps model protocol and provider protocol across group selection and catalog refresh", async () => {
	const config = JSON.parse(readFileSync(join(state.home, "models.json"), "utf8"));
	config.providers["567api_gemini_sale"].api = "openai-responses";
	writeFileSync(join(state.home, "models.json"), JSON.stringify(config));
	await api.setActiveGroup("反重力Gemini", "gemini-3-flash");
	expect(await api.syncGroup("反重力Gemini")).toMatchObject({ success: true });
	const saved = JSON.parse(readFileSync(join(state.home, "models.json"), "utf8"));
	expect(saved.providers["567api_gemini_sale"].api).toBe("openai-responses");
	expect(saved.providers["567api_gemini_sale"].modelOverrides["gemini-3-flash"]).toEqual({
		contextWindow: 64000,
		api: "openai-responses",
	});
});

it("does not switch the primary group when refreshing another group", async () => {
	expect(await api.syncGroup("反重力Gemini")).toMatchObject({ success: true });
	expect(await api.getStatus()).toMatchObject({ activeGroup: "chat GPT pro", activeModel: "gpt-test" });
});

it("keeps group-only callers selecting the recommended model and rejects malformed explicit models", async () => {
	expect(await api.setActiveGroup("反重力Gemini")).toMatchObject({ success: true });
	expect(JSON.parse(readFileSync(join(state.home, "models.json"), "utf8"))).toMatchObject({
		defaultModel: "567api_gemini_sale/gemini-3.8-flash-high",
	});
	expect(await state.handlers.get("vetta:567api:set-active-group")!({}, "反重力Gemini", 42)).toMatchObject({
		success: false,
	});
});
