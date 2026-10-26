import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createCodingAgentModelRuntime } from "@567agent/coding-agent/host-services";
import { RuntimeModel } from "@567agent/runtime-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewApiService } from "./newapi-service.js";

const state = vi.hoisted(() => ({
	home: "",
	calls: [] as { url: string; auth?: string; cookie?: string }[],
	response: { status: 200, success: true, data: undefined as unknown },
	pause: undefined as undefined | (() => Promise<void>),
	refresh: () => {},
}));
vi.mock("@567agent/action-rpc", () => ({ getAgent567HomePath: () => state.home }));
vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => [] },
	safeStorage: {
		isEncryptionAvailable: () => true,
		getSelectedStorageBackend: () => "gnome_libsecret",
		encryptString: (s: string) => Buffer.from(s),
		decryptString: (s: Buffer) => s.toString(),
	},
}));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock("../agent-runtime/host-services.js", () => ({ refreshSharedModelRouting: () => state.refresh() }));
vi.mock("../models/model-settings-host.js", () => ({
	getDesktopModelSettingsService: () => ({
		getConfig: async () => ({ providers: {} }),
		replaceConfig: async () => {},
	}),
}));
vi.mock("node:https", () => ({
	default: {
		request(
			url: URL,
			options: { headers: Record<string, string>; signal?: AbortSignal },
			receive: (res: IncomingMessage) => void,
		) {
			const req = new EventEmitter();
			return Object.assign(req, {
				write() {},
				destroy(error: Error) {
					req.emit("error", error);
				},
				end() {
					state.calls.push({ url: url.href, auth: options.headers.Authorization, cookie: options.headers.Cookie });
					const response = { ...state.response };
					const pause = state.pause;
					void (async () => {
						await pause?.();
						if (options.signal?.aborted) {
							req.emit("error", new Error("aborted"));
							return;
						}
						const stream = Object.assign(new PassThrough(), { statusCode: response.status, headers: {} });
						receive(stream as unknown as IncomingMessage);
						stream.end(JSON.stringify({ success: response.success, data: response.data ?? { quota: 500000 } }));
					})();
				},
			});
		},
	},
}));

let service: NewApiService;
beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	state.home = mkdtempSync(join(tmpdir(), "567-route-flow-"));
	state.calls = [];
	state.response = { status: 200, success: true, data: undefined };
	state.pause = undefined;
	state.refresh = () => {};
	writeFileSync(
		join(state.home, "567api-session.json"),
		JSON.stringify({
			isLoggedIn: true,
			accessToken: "account-token",
			cookie: "session=shared",
			username: "user",
			groups: [],
		}),
	);
	service = (await import("./newapi-service.js")).NewApiService.getInstance();
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	rmSync(state.home, { recursive: true, force: true });
});

describe("user switches desktop service route", () => {
	it("starts a fresh install on Germany, discovers its catalog and signs in without contacting mainland", async () => {
		rmSync(join(state.home, "567api-session.json"));
		vi.clearAllTimers();
		vi.resetModules();
		service = (await import("./newapi-service.js")).NewApiService.getInstance();
		expect(await service.getStatus()).toMatchObject({ isLoggedIn: false, serviceRoute: "germany" });
		state.response.data = {
			api_info_enabled: true,
			api_info: [{ url: "https://api.567.wiki", route: "德国" }],
		};
		expect((await service.refreshServiceRoutes(true)).routes.map((route) => route.id)).toEqual(["germany"]);
		state.response.data = { id: 7, username: "new-user", quota: 500000 };
		state.pause = async () => {
			state.response.data = {};
		};
		expect(await service.loginWithAccessToken("new-account-token")).toEqual({ success: true });
		expect(await service.getStatus()).toMatchObject({
			isLoggedIn: true,
			serviceRoute: "germany",
			username: "new-user",
		});
		expect(state.calls.map((call) => new URL(call.url).origin)).toEqual(
			state.calls.map(() => "https://api.567.wiki"),
		);
		expect(state.calls).toContainEqual({
			url: "https://api.567.wiki/api/status",
			auth: undefined,
			cookie: undefined,
		});
		expect(state.calls).toContainEqual({
			url: "https://api.567.wiki/api/user/self",
			auth: "Bearer new-account-token",
			cookie: undefined,
		});
	});

	it("loads nodes from the primary, switches a discovered node, and keeps it after invalid or failed refresh", async () => {
		state.response.data = { api_info_enabled: true, api_info: [{ url: "https://node3.567.wiki", route: "节点三" }] };
		expect((await service.refreshServiceRoutes(true)).routes).toContainEqual({
			id: "https://node3.567.wiki",
			origin: "https://node3.567.wiki",
			name: "节点三",
		});
		expect(state.calls[0]).toEqual({ url: "https://api.567.wiki/api/status", auth: undefined, cookie: undefined });
		expect((await service.getStatus()).serviceRoute).toBe("germany");
		expect((await service.selectServiceRoute("https://node3.567.wiki")).ok).toBe(true);
		expect(state.calls.at(-1)).toMatchObject({
			url: "https://node3.567.wiki/api/user/self",
			auth: "Bearer account-token",
		});
		state.response.data = { api_info: [] };
		expect(await service.refreshServiceRoutes(true)).toMatchObject({ refreshFailed: true });
		expect(service.getServiceOrigin()).toBe("https://node3.567.wiki");
		state.response.status = 302;
		expect(await service.refreshServiceRoutes(true)).toMatchObject({ refreshFailed: true });
		const count = state.calls.length;
		expect((await service.selectServiceRoute("https://unknown.567.wiki")).ok).toBe(false);
		expect(state.calls).toHaveLength(count);
	});

	it("probes anonymously, validates the account, keeps login and sends subsequent balance requests to mainland", async () => {
		expect((await service.getStatus()).serviceRoute).toBe("germany");
		expect(await service.selectServiceRoute("mainland")).toMatchObject({ ok: true, route: "mainland" });
		expect(state.calls[0]).toEqual({ url: "https://a.567.wiki/api/status", auth: undefined, cookie: undefined });
		expect(state.calls[1]).toMatchObject({ url: "https://a.567.wiki/api/user/self", auth: "Bearer account-token" });
		expect(service.getRawSession()).toMatchObject({
			isLoggedIn: true,
			accessToken: "account-token",
			cookie: "session=shared",
		});
		await service.refreshQuota(true);
		expect(state.calls.at(-1)?.url).toBe("https://a.567.wiki/api/user/self");
		expect(JSON.parse(readFileSync(join(state.home, "service-route.json"), "utf8")).route).toBe("mainland");
	});
	it("does not change routes or clear login after rejected account validation", async () => {
		let count = 0;
		state.pause = async () => {
			if (++count === 1) state.response = { status: 401, success: false, data: undefined };
		};
		expect(await service.selectServiceRoute("mainland")).toMatchObject({ ok: false, error: "account-rejected" });
		expect((await service.getStatus()).serviceRoute).toBe("germany");
		expect(service.getRawSession().accessToken).toBe("account-token");
	});
	it("cancels pending validation without changing the saved route", async () => {
		let release!: () => void;
		state.pause = () =>
			new Promise<void>((r) => {
				release = r;
			});
		const controller = new AbortController();
		const pending = service.selectServiceRoute("mainland", controller.signal);
		controller.abort();
		release();
		expect((await pending).ok).toBe(false);
		expect((await service.getStatus()).serviceRoute).toBe("germany");
	});
	it("applies the route at the next runtime turn while preserving model options, custom servers and the bound turn", async () => {
		vi.useRealTimers();
		const { normalizeModelsConfig } = await import("../models/model-settings-service.js");
		const config = {
			providers: {
				"567api": {
					api: "openai-completions",
					baseUrl: "https://api.567.wiki/v1",
					apiKey: "model-key",
					models: [{ id: "test", contextWindow: 64000, maxTokens: 1000 }],
					modelOverrides: { test: { contextWindow: 128000 } },
				},
				"567api_custom": { baseUrl: "https://private.test/v1", apiKey: "custom-key" },
			},
		};
		const auth = {
			setFallbackResolver() {},
			getApiKey: async () => "model-key",
			hasAuth: () => true,
			get: () => undefined,
			getOAuthProviders: () => [],
		};
		const registry = createCodingAgentModelRuntime(auth, {
			modelsJsonPath: "memory.json",
			configFileSource: { exists: () => true, read: () => JSON.stringify(normalizeModelsConfig(config)) },
			builtInModels: [],
		});
		const model = registry.find("567api", "test")!;
		const runtime = new RuntimeModel({
			initialModel: model,
			initialThinkingLevel: "off",
			catalog: {
				refresh: () => registry.refresh(),
				find: (p, m) => registry.find(p, m),
				listAvailable: () => registry.getAvailable(),
			},
			credentials: { resolve: (m) => registry.getApiKey(m), refreshAuth: async () => {} },
		});
		const before = await runtime.bind();
		state.refresh = () => registry.refresh();
		expect((await service.selectServiceRoute("mainland")).ok).toBe(true);
		const after = await runtime.bind();
		expect(before.model.baseUrl).toBe("https://api.567.wiki/v1");
		expect(after.model.baseUrl).toBe("https://a.567.wiki/v1");
		expect(after.model.contextWindow).toBe(128000);
		expect(after.model.maxTokens).toBe(1000);
		expect(normalizeModelsConfig(config).providers["567api_custom"].baseUrl).toBe("https://private.test/v1");
		expect(await before.credential?.resolve()).toBe("model-key");
	});
});
