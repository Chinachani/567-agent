import { beforeEach, expect, it, vi } from "vitest";
import type { ModelsConfig } from "../model-settings-service.js";

const external = vi.hoisted(() => ({ config: { providers: {} } as ModelsConfig, fetch: vi.fn() }));
vi.mock("electron", () => ({ net: { fetch: external.fetch }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("../../logger.js", () => ({ getAppLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));
vi.mock("../model-settings-host.js", () => ({
	getDesktopModelSettingsService: () => ({ getConfig: async () => external.config }),
}));
vi.mock("../../567api/service-route-store.js", () => ({
	getApi567RouteStore: () => ({ origin: "https://api567.example" }),
}));

import { refreshPresetModels } from "./sync.js";

beforeEach(() => {
	external.config = {
		providers: {
			magpie: { baseUrl: "http://127.0.0.1:4321/v1", apiKey: "local-proxy" },
			openai: { apiKey: "cloud-key" },
			"567api": { baseUrl: "https://api567.example/v1", apiKey: "route-key" },
		},
	};
	external.fetch
		.mockReset()
		.mockResolvedValue(
			new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
		);
});
it("only fetches approved local Magpie addresses with the saved credential", async () => {
	expect((await refreshPresetModels("magpie", undefined, "https://remote.example/v1")).error?.code).toBe(
		"invalid-base-url",
	);
	expect((await refreshPresetModels("openai", undefined, "https://remote.example/v1")).error?.code).toBe(
		"invalid-base-url",
	);
	expect(external.fetch).not.toHaveBeenCalled();
	await refreshPresetModels("magpie", undefined, "http://127.0.0.1:5678/v1");
	expect(external.fetch).toHaveBeenCalledWith(
		"http://127.0.0.1:5678/v1/models",
		expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer local-proxy" }) }),
	);
	external.config.providers.magpie.baseUrl = "http://remote.example/v1";
	external.fetch.mockClear();
	expect((await refreshPresetModels("magpie")).error?.code).toBe("invalid-base-url");
	expect(external.fetch).not.toHaveBeenCalled();
});
it("preserves the active 567 API route when refreshing its preset", async () => {
	await refreshPresetModels("567api", undefined, "https://api567.example/v1");
	expect(external.fetch).toHaveBeenCalledWith(
		"https://api567.example/v1/models",
		expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer route-key" }) }),
	);
});
