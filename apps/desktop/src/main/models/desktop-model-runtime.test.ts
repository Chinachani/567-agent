import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgentAuthRuntime } from "@567agent/coding-agent/host-services";
import { RuntimeModel } from "@567agent/runtime-core";
import { NodeTransactionalTextStorage } from "@567agent/runtime-node/host";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ home: "" }));
vi.mock("@567agent/action-rpc", () => ({ getAgent567HomePath: () => state.home }));
afterEach(() => {
	if (state.home) rmSync(state.home, { force: true, recursive: true });
});

it("keeps a discovered node for a bound turn and routes its saved model to another node after cache cleanup", async () => {
	vi.resetModules();
	state.home = mkdtempSync(join(tmpdir(), "567-rpc-discovery-"));
	mkdirSync(join(state.home, "agent"));
	const path = join(state.home, "agent/models.json");
	writeFileSync(
		path,
		JSON.stringify({
			providers: {
				"567api": {
					baseUrl: "https://node3.567.wiki/v1",
					headers: { "X-567-Group": "default", "X-567-Nonce": "stale-proof" },
					api: "openai-completions",
					models: [{ id: "model", contextWindow: 128000, maxTokens: 1024 }],
				},
				"567api_custom": { baseUrl: "https://private.test/v1" },
			},
		}),
	);
	const { Api567RouteStore } = await import("../567api/service-route-store.js");
	const routes = new Api567RouteStore(state.home);
	await routes.saveCatalog([
		{ id: "https://node3.567.wiki", origin: "https://node3.567.wiki" },
		{ id: "germany", origin: "https://api.567.wiki" },
	]);
	await routes.select("https://node3.567.wiki");
	const auth = createCodingAgentAuthRuntime(new NodeTransactionalTextStorage(join(state.home, "auth.json")));
	auth.setRuntimeApiKey("567api", "model-key");
	const { createDesktopModelRuntime } = await import("./desktop-model-runtime.js");
	const catalog = createDesktopModelRuntime(auth, path);
	const session = new RuntimeModel({
		initialModel: catalog.find("567api", "model")!,
		initialThinkingLevel: "off",
		catalog: {
			refresh: () => catalog.refresh(),
			find: (p, m) => catalog.find(p, m),
			listAvailable: () => catalog.getAvailable(),
		},
		credentials: { resolve: (m) => catalog.getApiKey(m), refreshAuth: async () => {} },
	});
	const running = await session.bind();
	await routes.select("germany");
	rmSync(join(state.home, "cache"), { force: true, recursive: true });
	const next = await session.bind();
	expect(running.model.baseUrl).toBe("https://node3.567.wiki/v1");
	expect(running.model.headers).toEqual({ "X-567-Group": "default" });
	expect(next.model.baseUrl).toBe("https://api.567.wiki/v1");
	expect(next.model.contextWindow).toBe(128000);
	expect(running.credential?.resolve()).toBe("model-key");
});

it("an existing Electron RPC runtime picks up an external route change on its next turn", async () => {
	vi.resetModules();
	state.home = mkdtempSync(join(tmpdir(), "567-rpc-routes-"));
	mkdirSync(join(state.home, "agent"));
	const path = join(state.home, "agent/models.json");
	writeFileSync(
		path,
		JSON.stringify({
			providers: {
				"567api": {
					baseUrl: "https://api.567.wiki/v1",
					api: "openai-completions",
					models: [{ id: "model", contextWindow: 128000, maxTokens: 1024 }],
				},
			},
		}),
	);
	const auth = createCodingAgentAuthRuntime(new NodeTransactionalTextStorage(join(state.home, "auth.json")));
	auth.setRuntimeApiKey("567api", "model-key");
	const { createDesktopModelRuntime } = await import("./desktop-model-runtime.js");
	const catalog = createDesktopModelRuntime(auth, path);
	const session = new RuntimeModel({
		initialModel: catalog.find("567api", "model")!,
		initialThinkingLevel: "off",
		catalog: {
			refresh: () => catalog.refresh(),
			find: (p, m) => catalog.find(p, m),
			listAvailable: () => catalog.getAvailable(),
		},
		credentials: { resolve: (m) => catalog.getApiKey(m), refreshAuth: async () => {} },
	});
	const running = await session.bind();
	writeFileSync(join(state.home, "service-route.json"), JSON.stringify({ schemaVersion: 1, route: "mainland" }));
	const next = await session.bind();
	expect(running.model.baseUrl).toBe("https://api.567.wiki/v1");
	expect(next.model.baseUrl).toBe("https://a.567.wiki/v1");
	expect(next.model.id).toBe("model");
	expect(next.model.contextWindow).toBe(128000);
	expect(running.credential?.resolve()).toBe("model-key");
});

it("opens with an unreadable route without silently selecting a new API origin, and recovers after repair", async () => {
	vi.resetModules();
	state.home = mkdtempSync(join(tmpdir(), "567-damaged-route-"));
	mkdirSync(join(state.home, "agent"));
	const path = join(state.home, "agent/models.json");
	writeFileSync(
		path,
		JSON.stringify({
			providers: {
				"567api": {
					baseUrl: "https://api.567.wiki/v1",
					api: "openai-completions",
					models: [{ id: "model", contextWindow: 128000, maxTokens: 1024 }],
				},
			},
		}),
	);
	writeFileSync(join(state.home, "service-route.json"), "damaged");
	const auth = createCodingAgentAuthRuntime(new NodeTransactionalTextStorage(join(state.home, "auth.json")));
	const { createDesktopModelRuntime } = await import("./desktop-model-runtime.js");
	const catalog = createDesktopModelRuntime(auth, path);
	expect(catalog.find("567api", "model")).toBeUndefined();
	expect(catalog.getError()).toBeTruthy();
	const { getApi567RouteStore } = await import("../567api/service-route-store.js");
	await getApi567RouteStore().select("germany");
	expect(catalog.find("567api", "model")?.baseUrl).toBe("https://api.567.wiki/v1");
});
